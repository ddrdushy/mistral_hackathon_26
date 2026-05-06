"""Per-MailAccount background poller.

Replaces the manual Sync buttons. For every MailAccount with status=connected
we run a long-lived asyncio task that:

  1. fetches new emails via the existing IMAP adapter (mail_account_service.sync_account)
  2. runs run_email_workflow on every new email (classifier + downstream)
  3. updates the account's last_sync_at / last_synced_count
  4. sleeps POLL_INTERVAL_SECONDS and loops

True IMAP IDLE is a follow-up — for the hackathon a 20s poll feels real-time
to the user and avoids the "open IDLE socket per tenant" infrastructure
question. The listener auto-restarts on transient errors with exponential
backoff capped at 5 minutes.

Lifecycle:
  - main.py startup → start_all_existing()
  - main.py shutdown → stop_all()
  - new MailAccount created → start_for_account(id)
  - MailAccount deleted → stop_for_account(id)

The task registry is module-level (asyncio is per-process, fine for our
single-uvicorn-worker deploy). For multi-worker deploys we'd switch to a
DB-elected leader or move polling to a separate worker process.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict

from billing.cost_guard import set_active_tenant
from database import SessionLocal
from models import Email, MailAccount
from services import mail_account_service
from services.workflow_service import run_email_workflow

logger = logging.getLogger("hireops.mailbox_listener")

POLL_INTERVAL_SECONDS = 20
MAX_BACKOFF_SECONDS = 300

# account_id → asyncio.Task
_tasks: Dict[int, asyncio.Task] = {}
_started: bool = False


async def _poll_loop(account_id: int) -> None:
    """One iteration per POLL_INTERVAL_SECONDS until cancelled.

    The whole body is wrapped so that a transient DB/import error never
    silently kills the asyncio task — without this, a single hiccup leaves
    the UI showing LISTENING forever while no mail is pulled.
    """
    backoff = POLL_INTERVAL_SECONDS
    while True:
        try:
            db = SessionLocal()
            try:
                account = (
                    db.query(MailAccount)
                    .filter(MailAccount.id == account_id)
                    .first()
                )
                if not account:
                    logger.info("Account %s gone, stopping listener", account_id)
                    return
                if account.status == "disconnected" or not account.listener_enabled:
                    # Either the user paused this mailbox (cost control) or the
                    # account is disconnected. Either way, idle the task so we
                    # don't burn classifier LLM tokens until they re-enable.
                    await asyncio.sleep(POLL_INTERVAL_SECONDS)
                    continue

                # Tag every LLM call made inside this iteration with the tenant
                # so cost_guard.record_llm_usage attributes it correctly. Without
                # this, the mailbox listener (which runs outside an HTTP request)
                # would produce LlmUsage rows with tenant_id=NULL — and the tenant
                # usage meter would always read $0 for auto-pickup work.
                set_active_tenant(account.tenant_id)

                # 1) Pull new emails. sync_account already commits and tags tenant_id.
                try:
                    new_emails = mail_account_service.sync_account(
                        db, account, limit=50
                    )
                except Exception as e:
                    logger.warning(
                        "Listener pull failed for account %s (%s) — backoff %ds: %s",
                        account_id, account.email_address, backoff, e,
                    )
                    await asyncio.sleep(backoff)
                    backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
                    continue

                # 2) Run the workflow on each new email. Failures are per-email,
                # so one bad message doesn't stop the rest of the batch.
                for em in new_emails:
                    try:
                        await run_email_workflow(em.id, db)
                    except Exception as e:
                        logger.exception(
                            "Workflow failed for email %s in listener for account %s: %s",
                            em.id, account_id, e,
                        )

                if new_emails:
                    print(
                        f"[mailbox_listener] Auto-classified {len(new_emails)} new "
                        f"emails for {account.email_address}",
                        flush=True,
                    )

                backoff = POLL_INTERVAL_SECONDS  # reset on success
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception(
                "Listener iteration crashed for account %s — backoff %ds: %s",
                account_id, backoff, e,
            )
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            continue

        await asyncio.sleep(POLL_INTERVAL_SECONDS)


def start_for_account(account_id: int) -> None:
    """Spawn (or replace) the listener for a single account."""
    existing = _tasks.get(account_id)
    if existing and not existing.done():
        return

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # No running loop yet (called outside a request/startup context).
        # Caller should retry from the FastAPI lifespan.
        logger.warning("start_for_account(%s) called with no running loop", account_id)
        return

    task = loop.create_task(_poll_loop(account_id), name=f"mailbox-{account_id}")
    _tasks[account_id] = task
    print(f"[mailbox_listener] Started loop for account {account_id}", flush=True)


def stop_for_account(account_id: int) -> None:
    task = _tasks.pop(account_id, None)
    if task and not task.done():
        task.cancel()
        logger.info("Stopped listener for MailAccount %s", account_id)


async def start_all_existing() -> None:
    """Called from FastAPI startup — boot a listener per connected account."""
    global _started
    if _started:
        return
    _started = True

    db = SessionLocal()
    try:
        accounts = (
            db.query(MailAccount)
            .filter(MailAccount.status != "disconnected")
            .all()
        )
        for a in accounts:
            start_for_account(a.id)
        logger.info("Mailbox listener: started %d account loop(s)", len(accounts))
    finally:
        db.close()


async def stop_all() -> None:
    for account_id, task in list(_tasks.items()):
        if not task.done():
            task.cancel()
    if _tasks:
        await asyncio.gather(*_tasks.values(), return_exceptions=True)
    _tasks.clear()
    logger.info("Mailbox listener: stopped all loops")


# ─── Backfill helper ──────────────────────────────────────────────────────


async def backfill_unclassified(tenant_id: int | None = None, limit: int = 100) -> int:
    """One-shot helper: classify any existing emails that never got processed.

    Useful for the user's case where mail arrived via the legacy Gmail OAuth
    path before the listener existed. Filters by tenant_id when provided.

    Sets the cost_guard active-tenant context per email so the resulting
    LlmUsage rows attribute to the right tenant (mirrors the listener fix).
    """
    db = SessionLocal()
    try:
        q = db.query(Email).filter(Email.processed == 0)
        if tenant_id is not None:
            q = q.filter(Email.tenant_id == tenant_id)
        rows = q.order_by(Email.created_at.desc()).limit(limit).all()
        for em in rows:
            try:
                set_active_tenant(em.tenant_id)
                await run_email_workflow(em.id, db)
            except Exception as e:
                logger.warning("Backfill workflow failed for email %s: %s", em.id, e)
        return len(rows)
    finally:
        set_active_tenant(None)
        db.close()
