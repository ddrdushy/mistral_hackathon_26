"""Job-board multi-poster API.

Two URL spaces:

  /api/v1/job-boards/...        per-tenant connection management +
                                OAuth flow for providers that support it
  /api/v1/jobs/{job_id}/boards/... per-job publishing / status

The router only handles persistence + audit. The actual provider work
(HTTP calls, payload translation) lives in services/job_boards/.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.dependencies import current_session, require_owner, CurrentSession
from database import get_db
from models import Job, JobBoardConnection, JobBoardPosting
from services.audit import write_audit
from services.job_boards import (
    available_providers,
    get_adapter,
    get_adapter_for_provider,
)
from services.job_boards.base import JobPostDraft
from services.job_boards import oauth as oauth_helper
from services.secrets_crypto import encrypt

logger = logging.getLogger("hireops.job_boards")

router = APIRouter(prefix="/api/v1/job-boards", tags=["job-boards"])
jobs_router = APIRouter(prefix="/api/v1/jobs", tags=["job-boards"])


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _connection_to_response(row: JobBoardConnection) -> dict:
    try:
        settings = json.loads(row.settings_json or "{}")
    except Exception:
        settings = {}
    return {
        "id": row.id,
        "provider": row.provider,
        "enabled": bool(row.enabled),
        "last_error": row.last_error or "",
        "settings": settings,
        "connected_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _posting_to_response(p: JobBoardPosting) -> dict:
    return {
        "id": p.id,
        "job_id": p.job_id,
        "provider": p.provider,
        "external_id": p.external_id or "",
        "external_url": p.external_url or "",
        "status": p.status,
        "last_error": p.last_error or "",
        "posted_at": p.posted_at.isoformat() if p.posted_at else None,
        "unposted_at": p.unposted_at.isoformat() if p.unposted_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _build_draft(job: Job) -> JobPostDraft:
    return JobPostDraft(
        internal_job_id=job.id,
        job_id=job.job_id,
        title=job.title or "",
        description=job.description or "",
        department=job.department or "",
        location=job.location or "",
        seniority=job.seniority or "",
        skills=json.loads(job.skills) if job.skills else [],
        responsibilities=json.loads(job.responsibilities) if job.responsibilities else [],
        qualifications=json.loads(job.qualifications) if job.qualifications else [],
    )


# ─── Catalog + per-tenant connections ───────────────────────────────────────


@router.get("/available")
def list_available(_: CurrentSession = Depends(current_session)):
    return {"providers": available_providers()}


@router.get("")
def list_connections(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    rows = db.query(JobBoardConnection).filter(
        JobBoardConnection.tenant_id == session.tenant.id,
    ).order_by(JobBoardConnection.provider.asc()).all()
    return {"connections": [_connection_to_response(r) for r in rows]}


class ConnectRequest(BaseModel):
    # Adapter-specific credentials — the registry knows which fields each
    # provider needs.
    api_key: Optional[str] = None
    access_token: Optional[str] = None
    page_access_token: Optional[str] = None
    page_id: Optional[str] = None
    organization_id: Optional[str] = None
    employer_id: Optional[str] = None
    company_id: Optional[str] = None
    seed: Optional[str] = None  # mock
    settings: dict = Field(default_factory=dict)


@router.post("/connect/{provider}", status_code=201)
async def connect(
    provider: str,
    req: ConnectRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    catalog = {p["id"]: p for p in available_providers()}
    if provider not in catalog:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")
    if not catalog[provider]["enabled"]:
        raise HTTPException(
            status_code=400,
            detail=(
                f"{catalog[provider]['name']} is not yet enabled on this platform. "
                "Only the Mock provider works in v1; others require partner setup."
            ),
        )

    credentials = {
        k: v for k, v in {
            "api_key": req.api_key,
            "access_token": req.access_token,
            "page_access_token": req.page_access_token,
            "page_id": req.page_id,
            "organization_id": req.organization_id,
            "employer_id": req.employer_id,
            "company_id": req.company_id,
            "seed": req.seed,
        }.items() if v is not None
    }

    row = db.query(JobBoardConnection).filter(
        JobBoardConnection.tenant_id == session.tenant.id,
        JobBoardConnection.provider == provider,
    ).first()

    if row:
        row.encrypted_credentials = encrypt(json.dumps(credentials))
        row.settings_json = json.dumps(req.settings or {})
        row.enabled = True
        row.last_error = ""
    else:
        row = JobBoardConnection(
            tenant_id=session.tenant.id,
            provider=provider,
            encrypted_credentials=encrypt(json.dumps(credentials)),
            settings_json=json.dumps(req.settings or {}),
            enabled=True,
        )
        db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already connected — same provider already exists.")

    # Probe the connection so the UI shows an immediate failure if creds
    # are wrong. Don't roll back the save — tenant can fix and retry.
    try:
        adapter = get_adapter(row)
        ok = await adapter.test_connection()
        if not ok:
            row.last_error = "test_connection returned False"
    except NotImplementedError as e:
        row.last_error = str(e)
    except Exception as e:
        row.last_error = str(e)[:500]
    db.commit()

    write_audit(
        db, action="job_board.connect", actor=session.user,
        tenant_id=session.tenant.id, resource_type="job_board_connection",
        resource_id=row.id,
        payload={
            "provider": provider,
            "credential_keys": sorted(credentials.keys()),
        },
        severity="warning", request=request,
    )
    return _connection_to_response(row)


@router.delete("/{connection_id}")
def disconnect(
    connection_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    row = db.query(JobBoardConnection).filter(
        JobBoardConnection.id == connection_id,
        JobBoardConnection.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    provider = row.provider
    db.delete(row)
    db.commit()
    write_audit(
        db, action="job_board.disconnect", actor=session.user,
        tenant_id=session.tenant.id, resource_type="job_board_connection",
        resource_id=connection_id,
        payload={"provider": provider},
        severity="warning", request=request,
    )
    return {"deleted": True}


# ─── Tenant OAuth flow (LinkedIn, Facebook) ─────────────────────────────────
#
# The tenant clicks "Connect with X" in the UI. We sign a state JWT and
# redirect them to the provider. The provider redirects back to /callback
# with ?code + ?state, we exchange the code, and persist the access_token
# (+ chosen Page / Organization id) into JobBoardConnection.


@router.get("/{provider}/oauth/start")
def oauth_start(
    provider: str,
    session: CurrentSession = Depends(require_owner),
):
    """Returns the provider's authorize URL. Frontend redirects the
    browser there. Tenant OAuth is owner-only — wiring up paid
    distribution is a billing-relevant action.
    """
    state = oauth_helper.issue_state(
        tenant_id=session.tenant.id,
        user_id=session.user.id,
        provider=provider,
    )
    try:
        if provider == "linkedin":
            url = oauth_helper.linkedin_authorize_url(state)
        elif provider == "facebook":
            url = oauth_helper.facebook_authorize_url(state)
        else:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Provider '{provider}' doesn't support OAuth — use POST "
                    f"/api/v1/job-boards/connect/{provider} with manual credentials."
                ),
            )
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return {"authorize_url": url}


def _redirect_to_settings(qs: str = "") -> RedirectResponse:
    base = oauth_helper.frontend_url()
    return RedirectResponse(url=f"{base}/settings/job-boards{qs}", status_code=303)


@router.get("/linkedin/oauth/callback")
async def linkedin_oauth_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_description: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    if error:
        logger.warning("linkedin oauth user-cancel: %s — %s", error, error_description)
        return _redirect_to_settings(f"?oauth=linkedin&error={error}")
    if not code or not state:
        return _redirect_to_settings("?oauth=linkedin&error=missing_params")

    payload = oauth_helper.verify_state(state, "linkedin")
    if not payload:
        return _redirect_to_settings("?oauth=linkedin&error=invalid_state")
    tenant_id = int(payload["tid"])
    user_id = int(payload["sub"])

    client_id, client_secret = oauth_helper.linkedin_app()
    if not client_id or not client_secret:
        return _redirect_to_settings("?oauth=linkedin&error=app_not_configured")

    # Exchange code → access_token
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            "https://www.linkedin.com/oauth/v2/accessToken",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": oauth_helper.redirect_uri("linkedin"),
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if resp.status_code != 200:
            logger.warning("linkedin token exchange %s: %s", resp.status_code, resp.text[:300])
            return _redirect_to_settings(f"?oauth=linkedin&error=token_exchange_{resp.status_code}")
        tok = resp.json()

        access_token = tok.get("access_token", "")
        expires_in = int(tok.get("expires_in", 0) or 0)

        # Best-effort fetch of the Pages this user admins, so the
        # tenant can pick one later via the UI. If this 403s
        # (`r_organization_admin` not approved yet) we still save the
        # token and let the publish flow ask for an organization_id.
        pages: list[dict] = []
        try:
            org_resp = await client.get(
                "https://api.linkedin.com/v2/organizationAcls",
                params={"q": "roleAssignee", "role": "ADMINISTRATOR", "state": "APPROVED"},
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
            if org_resp.status_code == 200:
                for el in (org_resp.json() or {}).get("elements", []):
                    org_urn = el.get("organization")
                    if org_urn:
                        pages.append({"urn": org_urn})
        except Exception as e:
            logger.warning("linkedin org list fetch failed: %s", e)

    credentials = {
        "access_token": access_token,
        "expires_in": expires_in,
        "obtained_at": datetime.utcnow().isoformat(),
        "pages": pages,
    }
    settings_payload = {
        # Tenant picks which Page/Org to publish under via a follow-up
        # PATCH to /api/v1/job-boards/{id}; until then we'll prompt them
        # on first publish.
        "organization_urn": pages[0]["urn"] if pages else "",
    }

    row = db.query(JobBoardConnection).filter(
        JobBoardConnection.tenant_id == tenant_id,
        JobBoardConnection.provider == "linkedin",
    ).first()
    if row:
        row.encrypted_credentials = encrypt(json.dumps(credentials))
        row.settings_json = json.dumps(settings_payload)
        row.enabled = True
        row.last_error = ""
    else:
        row = JobBoardConnection(
            tenant_id=tenant_id,
            provider="linkedin",
            encrypted_credentials=encrypt(json.dumps(credentials)),
            settings_json=json.dumps(settings_payload),
            enabled=True,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    write_audit(
        db, action="job_board.oauth_connect", actor=None,
        tenant_id=tenant_id, resource_type="job_board_connection",
        resource_id=row.id,
        payload={"provider": "linkedin", "pages_count": len(pages), "user_id": user_id},
        severity="warning", request=request,
    )
    return _redirect_to_settings("?oauth=linkedin&ok=1")


@router.get("/facebook/oauth/callback")
async def facebook_oauth_callback(
    request: Request,
    code: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    error: Optional[str] = Query(default=None),
    error_reason: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    if error:
        logger.warning("facebook oauth user-cancel: %s — %s", error, error_reason)
        return _redirect_to_settings(f"?oauth=facebook&error={error}")
    if not code or not state:
        return _redirect_to_settings("?oauth=facebook&error=missing_params")

    payload = oauth_helper.verify_state(state, "facebook")
    if not payload:
        return _redirect_to_settings("?oauth=facebook&error=invalid_state")
    tenant_id = int(payload["tid"])
    user_id = int(payload["sub"])

    client_id, client_secret = oauth_helper.facebook_app()
    if not client_id or not client_secret:
        return _redirect_to_settings("?oauth=facebook&error=app_not_configured")

    async with httpx.AsyncClient(timeout=20) as client:
        # 1. Exchange short-lived code for short-lived user access token.
        resp = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": oauth_helper.redirect_uri("facebook"),
                "code": code,
            },
        )
        if resp.status_code != 200:
            logger.warning("facebook token exchange %s: %s", resp.status_code, resp.text[:300])
            return _redirect_to_settings(f"?oauth=facebook&error=token_exchange_{resp.status_code}")
        short_lived = resp.json().get("access_token", "")

        # 2. Upgrade to a long-lived user token (~60 days).
        ll = await client.get(
            "https://graph.facebook.com/v18.0/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "fb_exchange_token": short_lived,
            },
        )
        user_token = (ll.json() or {}).get("access_token", short_lived) if ll.status_code == 200 else short_lived

        # 3. List the Pages this user manages so the tenant can pick
        # which Page to post to. Each Page comes with its OWN
        # access_token (never-expiring as long as the user-token is
        # alive) — that's what we actually use for posting.
        pages: list[dict] = []
        try:
            page_resp = await client.get(
                "https://graph.facebook.com/v18.0/me/accounts",
                params={"access_token": user_token, "fields": "id,name,access_token"},
            )
            if page_resp.status_code == 200:
                for p in (page_resp.json() or {}).get("data", []):
                    pages.append({
                        "id": p.get("id", ""),
                        "name": p.get("name", ""),
                        "access_token": p.get("access_token", ""),
                    })
        except Exception as e:
            logger.warning("facebook /me/accounts failed: %s", e)

    if not pages:
        return _redirect_to_settings("?oauth=facebook&error=no_pages")

    # Default to the first Page; tenant can change via UI later.
    default_page = pages[0]
    credentials = {
        "user_access_token": user_token,
        "pages": pages,
        "obtained_at": datetime.utcnow().isoformat(),
    }
    settings_payload = {
        "page_id": default_page["id"],
        "page_name": default_page["name"],
    }

    row = db.query(JobBoardConnection).filter(
        JobBoardConnection.tenant_id == tenant_id,
        JobBoardConnection.provider == "facebook",
    ).first()
    if row:
        row.encrypted_credentials = encrypt(json.dumps(credentials))
        row.settings_json = json.dumps(settings_payload)
        row.enabled = True
        row.last_error = ""
    else:
        row = JobBoardConnection(
            tenant_id=tenant_id,
            provider="facebook",
            encrypted_credentials=encrypt(json.dumps(credentials)),
            settings_json=json.dumps(settings_payload),
            enabled=True,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    write_audit(
        db, action="job_board.oauth_connect", actor=None,
        tenant_id=tenant_id, resource_type="job_board_connection",
        resource_id=row.id,
        payload={"provider": "facebook", "pages_count": len(pages), "user_id": user_id},
        severity="warning", request=request,
    )
    return _redirect_to_settings("?oauth=facebook&ok=1")


class UpdateSettingsRequest(BaseModel):
    settings: dict


@router.patch("/{connection_id}/settings")
def update_settings(
    connection_id: int,
    req: UpdateSettingsRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Lets the tenant pick which Page / Organization to publish under
    after OAuth granted access to several. Settings JSON is plaintext
    metadata — never put credentials in it."""
    row = db.query(JobBoardConnection).filter(
        JobBoardConnection.id == connection_id,
        JobBoardConnection.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Connection not found")
    row.settings_json = json.dumps(req.settings or {})
    db.commit()
    return _connection_to_response(row)


# ─── Per-job publishing ─────────────────────────────────────────────────────


@jobs_router.get("/{job_id}/boards")
def list_postings(
    job_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    rows = db.query(JobBoardPosting).filter(
        JobBoardPosting.job_id == job_id,
        JobBoardPosting.tenant_id == session.tenant.id,
    ).order_by(JobBoardPosting.provider.asc()).all()
    return {"postings": [_posting_to_response(r) for r in rows]}


class PublishRequest(BaseModel):
    # One or more provider ids. The tenant must already have a
    # connection for each.
    providers: list[str] = Field(min_length=1)


@jobs_router.post("/{job_id}/boards/publish")
async def publish_to_boards(
    job_id: int,
    req: PublishRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """One-click publish to every selected board.

    Per-board results come back in `results`. Some can succeed while
    others fail — we record an audit row + JobBoardPosting per board
    regardless so the UI can show 'LinkedIn ✓ / FB ✗'.
    """
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    requested = list(dict.fromkeys(req.providers))  # dedupe, preserve order
    connections = {
        c.provider: c
        for c in db.query(JobBoardConnection).filter(
            JobBoardConnection.tenant_id == session.tenant.id,
            JobBoardConnection.provider.in_(requested),
        ).all()
    }

    draft = _build_draft(job)
    results: list[dict] = []

    for provider in requested:
        conn = connections.get(provider)
        if not conn:
            results.append({
                "provider": provider,
                "ok": False,
                "error": f"No active connection for '{provider}'. Connect it under Settings → Job boards.",
            })
            continue
        if not conn.enabled:
            results.append({
                "provider": provider,
                "ok": False,
                "error": "Connection is disabled.",
            })
            continue

        posting = db.query(JobBoardPosting).filter(
            JobBoardPosting.job_id == job_id,
            JobBoardPosting.provider == provider,
        ).first()
        if not posting:
            posting = JobBoardPosting(
                tenant_id=session.tenant.id,
                job_id=job_id,
                provider=provider,
                status="pending",
            )
            db.add(posting)
            db.flush()

        try:
            adapter = get_adapter(conn)
            outcome = await adapter.publish(draft)
            if outcome.ok:
                posting.status = "published"
                posting.external_id = outcome.external_id or ""
                posting.external_url = outcome.external_url or ""
                posting.last_error = ""
                posting.posted_at = datetime.utcnow()
                posting.unposted_at = None
                results.append({
                    "provider": provider,
                    "ok": True,
                    "external_id": posting.external_id,
                    "external_url": posting.external_url,
                })
            else:
                posting.status = "failed"
                posting.last_error = outcome.error or "publish returned ok=False"
                results.append({
                    "provider": provider,
                    "ok": False,
                    "error": posting.last_error,
                })
        except NotImplementedError as e:
            posting.status = "failed"
            posting.last_error = f"not_implemented: {e}"
            results.append({"provider": provider, "ok": False, "error": str(e)})
        except Exception as e:
            logger.exception("publish failed for %s/%s", provider, job_id)
            posting.status = "failed"
            posting.last_error = str(e)[:500]
            results.append({"provider": provider, "ok": False, "error": str(e)[:200]})

    db.commit()

    write_audit(
        db, action="job_board.publish", actor=session.user,
        tenant_id=session.tenant.id, resource_type="job",
        resource_id=job_id,
        payload={
            "providers": requested,
            "ok_count": sum(1 for r in results if r["ok"]),
            "fail_count": sum(1 for r in results if not r["ok"]),
        },
        severity="info", request=request,
    )
    return {"results": results}


@jobs_router.post("/{job_id}/boards/{provider}/unpublish")
async def unpublish_from_board(
    job_id: int,
    provider: str,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    posting = db.query(JobBoardPosting).filter(
        JobBoardPosting.job_id == job_id,
        JobBoardPosting.provider == provider,
        JobBoardPosting.tenant_id == session.tenant.id,
    ).first()
    if not posting:
        raise HTTPException(status_code=404, detail="No posting on that board")
    if not posting.external_id:
        # Never made it live; just mark as unposted.
        posting.status = "unpublished"
        posting.unposted_at = datetime.utcnow()
        db.commit()
        return _posting_to_response(posting)

    conn = db.query(JobBoardConnection).filter(
        JobBoardConnection.tenant_id == session.tenant.id,
        JobBoardConnection.provider == provider,
    ).first()
    if not conn:
        raise HTTPException(status_code=400, detail="Provider connection has been removed.")

    try:
        adapter = get_adapter(conn)
        await adapter.unpublish(posting.external_id)
        posting.status = "unpublished"
        posting.unposted_at = datetime.utcnow()
        posting.last_error = ""
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        posting.last_error = str(e)[:500]
        db.commit()
        raise HTTPException(status_code=502, detail=str(e))

    db.commit()
    write_audit(
        db, action="job_board.unpublish", actor=session.user,
        tenant_id=session.tenant.id, resource_type="job_board_posting",
        resource_id=posting.id,
        payload={"provider": provider, "external_id": posting.external_id},
        severity="info", request=request,
    )
    return _posting_to_response(posting)
