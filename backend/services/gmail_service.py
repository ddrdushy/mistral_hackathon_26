"""
Gmail Integration Service
- Connects via IMAP (App Password)
- IMAP IDLE listener for real-time email notifications
- Triggers auto-workflow instantly when new email arrives
- Persists credentials in DB — auto-reconnects on restart
"""
import asyncio
import base64
import json
import logging
import imaplib
import select
import threading
import email as email_lib
from email.header import decode_header
from datetime import datetime
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Email, Setting

logger = logging.getLogger("hireops.gmail")


def _save_setting(key: str, value: str):
    """Save a key-value pair to the settings table."""
    db = SessionLocal()
    try:
        setting = db.query(Setting).filter(Setting.key == key).first()
        if setting:
            setting.value = value
        else:
            setting = Setting(key=key, value=value)
            db.add(setting)
        db.commit()
    finally:
        db.close()


def _load_setting(key: str) -> Optional[str]:
    """Load a value from the settings table."""
    db = SessionLocal()
    try:
        setting = db.query(Setting).filter(Setting.key == key).first()
        return setting.value if setting else None
    finally:
        db.close()


def _delete_setting(key: str):
    """Delete a key from the settings table."""
    db = SessionLocal()
    try:
        db.query(Setting).filter(Setting.key == key).delete()
        db.commit()
    finally:
        db.close()


class GmailManager:
    """Manages Gmail IMAP connection with IDLE-based real-time listener."""

    def __init__(self):
        self.connected = False
        self.email_address: str = ""
        self.app_password: str = ""
        self.imap_host: str = "imap.gmail.com"
        self.imap_port: int = 993
        # Polling (legacy)
        self._poll_task: Optional[asyncio.Task] = None
        self._polling = False
        self._poll_interval: int = 30
        # IDLE listener
        self._idle_thread: Optional[threading.Thread] = None
        self._idle_running = False
        self._idle_mail: Optional[imaplib.IMAP4_SSL] = None
        self._event_loop: Optional[asyncio.AbstractEventLoop] = None
        # Shared state
        self._last_sync_at: Optional[str] = None
        self._last_uid: Optional[str] = None
        self._workflow_results: List[Dict] = []
        self._total_processed: int = 0
        self._listener_mode: str = "off"  # "off" | "idle" | "polling"
        self._auto_start_listener: bool = False  # Set by restore_from_db

    def connect(self, email_address: str, app_password: str, persist: bool = True) -> Dict:
        """Test connection to Gmail via IMAP. Optionally persist credentials."""
        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(email_address, app_password)
            mail.select("INBOX")

            status, data = mail.status("INBOX", "(MESSAGES UNSEEN)")
            mail.logout()

            self.email_address = email_address
            self.app_password = app_password
            self.connected = True

            # Persist credentials to DB so they survive restarts
            if persist:
                self._save_credentials(email_address, app_password)

            info = data[0].decode() if data[0] else ""
            return {
                "status": "connected",
                "email": email_address,
                "info": info,
            }

        except imaplib.IMAP4.error as e:
            error_msg = str(e)
            if "AUTHENTICATIONFAILED" in error_msg.upper():
                raise ValueError(
                    "Authentication failed. Make sure you're using an App Password "
                    "(not your regular password). Enable 2-Step Verification in your "
                    "Google Account, then create an App Password at "
                    "myaccount.google.com/apppasswords"
                )
            raise ValueError(f"IMAP connection failed: {error_msg}")

        except Exception as e:
            raise ValueError(f"Connection failed: {str(e)}")

    def _save_credentials(self, email_address: str, app_password: str):
        """Save Gmail credentials to the database (base64 encoded)."""
        try:
            creds = json.dumps({
                "email": email_address,
                "password": base64.b64encode(app_password.encode()).decode(),
            })
            _save_setting("gmail_credentials", creds)
            _save_setting("gmail_listener_enabled", "true")
            logger.info(f"Saved Gmail credentials for {email_address}")
        except Exception as e:
            logger.warning(f"Failed to save Gmail credentials: {e}")

    def _load_credentials(self) -> Optional[Dict]:
        """Load saved Gmail credentials from the database."""
        try:
            raw = _load_setting("gmail_credentials")
            if not raw:
                return None
            creds = json.loads(raw)
            creds["password"] = base64.b64decode(creds["password"].encode()).decode()
            return creds
        except Exception as e:
            logger.warning(f"Failed to load Gmail credentials: {e}")
            return None

    def restore_from_db(self) -> bool:
        """Try to restore Gmail connection from saved credentials. Returns True if restored."""
        creds = self._load_credentials()
        if not creds:
            logger.info("No saved Gmail credentials found")
            return False

        try:
            self.connect(creds["email"], creds["password"], persist=False)
            logger.info(f"Restored Gmail connection for {creds['email']}")

            # Auto-start IDLE listener if it was previously enabled
            listener_enabled = _load_setting("gmail_listener_enabled")
            if listener_enabled == "true":
                logger.info("Auto-starting IDLE listener (was previously enabled)")
                # Delayed start — needs to happen after event loop is running
                self._auto_start_listener = True
            return True
        except Exception as e:
            logger.warning(f"Failed to restore Gmail connection: {e}")
            # Credentials may be expired — clear them
            return False

    def disconnect(self):
        """Disconnect Gmail and clear saved credentials."""
        self.stop_all()
        self.connected = False
        self.email_address = ""
        self.app_password = ""
        _delete_setting("gmail_credentials")
        _delete_setting("gmail_listener_enabled")
        logger.info("Gmail disconnected and credentials cleared")

    def fetch_new_emails(self, db: Session, limit: int = 20) -> List[Email]:
        """Fetch new emails from Gmail that aren't already in our database."""
        if not self.connected:
            raise ValueError("Gmail not connected")

        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(self.email_address, self.app_password)
            mail.select("INBOX")

            if self._last_uid:
                _, data = mail.uid("search", None, f"UID {self._last_uid}:*")
            else:
                _, data = mail.search(None, "ALL")

            nums = data[0].split()
            if not nums:
                mail.logout()
                return []

            nums = nums[-limit:]
            new_emails = []

            for num in nums:
                if self._last_uid:
                    _, msg_data = mail.uid("fetch", num, "(RFC822)")
                else:
                    _, msg_data = mail.fetch(num, "(RFC822)")

                if not msg_data or not msg_data[0]:
                    continue

                raw_email = msg_data[0][1]
                parsed = self._parse_email(raw_email)

                if not parsed:
                    continue

                msg_id = parsed.get("message_id")
                if msg_id:
                    existing = db.query(Email).filter(Email.message_id == msg_id).first()
                    if existing:
                        continue

                email_obj = Email(
                    message_id=parsed.get("message_id"),
                    from_address=parsed["from_address"],
                    from_name=parsed.get("from_name", ""),
                    subject=parsed.get("subject", ""),
                    body_snippet=parsed.get("body_snippet", "")[:500],
                    body_full=parsed.get("body_full", ""),
                    attachments=json.dumps(parsed.get("attachments", [])),
                    received_at=(
                        datetime.fromisoformat(parsed["received_at"])
                        if parsed.get("received_at")
                        else datetime.utcnow()
                    ),
                )
                db.add(email_obj)
                new_emails.append(email_obj)

            db.commit()
            for e in new_emails:
                db.refresh(e)

            if nums:
                self._last_uid = nums[-1].decode() if isinstance(nums[-1], bytes) else str(nums[-1])

            mail.logout()
            self._last_sync_at = datetime.utcnow().isoformat()
            return new_emails

        except Exception as e:
            logger.error(f"Gmail fetch error: {e}")
            raise

    # ═══════════════════════════════════════
    # IMAP IDLE — Real-time listener
    # ═══════════════════════════════════════

    def _snapshot_latest_uid(self):
        """Record the latest UID so we only process emails received AFTER this point."""
        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(self.email_address, self.app_password)
            mail.select("INBOX")
            _, data = mail.search(None, "ALL")
            nums = data[0].split()
            if nums:
                # Fetch UID of the latest message
                latest_num = nums[-1]
                _, uid_data = mail.fetch(latest_num, "(UID)")
                if uid_data and uid_data[0]:
                    import re
                    match = re.search(rb"UID (\d+)", uid_data[0])
                    if match:
                        self._last_uid = match.group(1).decode()
                        logger.info(f"Snapshot: last UID = {self._last_uid}, skipping {len(nums)} existing emails")
            mail.logout()
        except Exception as e:
            logger.warning(f"Could not snapshot latest UID: {e}")

    def start_idle_listener(self):
        """Start IMAP IDLE listener for real-time email notifications."""
        if self._idle_running:
            return {"status": "already_listening", "mode": "idle"}

        if not self.connected:
            raise ValueError("Gmail not connected. Call /gmail/connect first.")

        # Snapshot current latest UID — only process emails AFTER this point
        self._snapshot_latest_uid()

        # Capture the current asyncio event loop for cross-thread callbacks
        self._event_loop = asyncio.get_event_loop()
        self._idle_running = True
        self._listener_mode = "idle"

        # Stop polling if active
        if self._polling:
            self.stop_polling()

        self._idle_thread = threading.Thread(
            target=self._idle_loop,
            name="gmail-idle-listener",
            daemon=True,
        )
        self._idle_thread.start()

        # Persist listener state
        try:
            _save_setting("gmail_listener_enabled", "true")
        except Exception:
            pass

        logger.info("Started IMAP IDLE listener (real-time)")
        return {"status": "listening", "mode": "idle"}

    def stop_idle_listener(self):
        """Stop the IMAP IDLE listener."""
        self._idle_running = False
        self._listener_mode = "off"

        # Save listener state as disabled
        try:
            _save_setting("gmail_listener_enabled", "false")
        except Exception:
            pass

        # Break the IDLE connection
        if self._idle_mail:
            try:
                self._idle_mail.close()
                self._idle_mail.logout()
            except Exception:
                pass
            self._idle_mail = None

        if self._idle_thread:
            self._idle_thread.join(timeout=5)
            self._idle_thread = None

        logger.info("Stopped IMAP IDLE listener")
        return {"status": "stopped"}

    def _idle_loop(self):
        """Background thread: maintain IMAP IDLE and trigger workflow on new mail."""
        while self._idle_running:
            try:
                # Open persistent IMAP connection
                mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
                mail.login(self.email_address, self.app_password)
                mail.select("INBOX")
                self._idle_mail = mail

                logger.info("IMAP IDLE connection established")

                while self._idle_running:
                    # Send IDLE command
                    tag = mail._new_tag()
                    idle_tag = tag
                    mail.send(b"%s IDLE\r\n" % idle_tag)

                    # Read the continuation response (+ idling)
                    response = mail.readline()
                    if not response or b"+" not in response:
                        logger.warning(f"Unexpected IDLE response: {response}")
                        break

                    logger.debug("IMAP IDLE: waiting for notifications...")

                    # Wait for server notification (EXISTS = new email)
                    # Timeout after 25 minutes (Gmail drops IDLE after ~29 min)
                    sock = mail.socket()
                    readable, _, _ = select.select([sock], [], [], 25 * 60)

                    if readable:
                        data = sock.recv(4096)
                        logger.info(f"IMAP IDLE notification: {data[:200]}")

                        # End IDLE
                        mail.send(b"DONE\r\n")
                        # Read tagged response
                        mail.readline()

                        if b"EXISTS" in data:
                            logger.info("New email detected via IMAP IDLE!")
                            self._handle_new_email_event()
                        else:
                            logger.debug(f"IMAP event (not EXISTS): {data[:100]}")
                    else:
                        # Timeout — re-IDLE to keep connection alive
                        mail.send(b"DONE\r\n")
                        mail.readline()
                        logger.debug("IMAP IDLE timeout, re-entering IDLE")
                        # NOOP to keep connection alive
                        mail.noop()

            except Exception as e:
                if self._idle_running:
                    logger.error(f"IMAP IDLE error: {e}, reconnecting in 5s...")
                    try:
                        if self._idle_mail:
                            self._idle_mail.logout()
                    except Exception:
                        pass
                    self._idle_mail = None
                    # Wait before reconnecting
                    import time
                    time.sleep(5)
                else:
                    break

        logger.info("IMAP IDLE loop exited")

    def _handle_new_email_event(self):
        """Called from IDLE thread when new email is detected. Dispatches to async workflow."""
        if self._event_loop and self._event_loop.is_running():
            asyncio.run_coroutine_threadsafe(
                self._process_new_emails(),
                self._event_loop,
            )
        else:
            logger.warning("No running event loop — cannot process new email")

    async def _process_new_emails(self):
        """Fetch new emails and run the workflow pipeline."""
        from services.workflow_service import run_email_workflow

        try:
            db = SessionLocal()
            try:
                new_emails = self.fetch_new_emails(db, limit=10)

                if new_emails:
                    logger.info(f"Processing {len(new_emails)} new email(s) via IDLE trigger")

                    for em in new_emails:
                        try:
                            result = await run_email_workflow(em.id, db)
                            self._workflow_results.append({
                                "email_id": em.id,
                                "subject": em.subject,
                                "from": em.from_address,
                                "result": result,
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                            self._total_processed += 1
                            if len(self._workflow_results) > 50:
                                self._workflow_results = self._workflow_results[-50:]
                        except Exception as e:
                            logger.error(f"Workflow error for email {em.id}: {e}")
                            self._workflow_results.append({
                                "email_id": em.id,
                                "error": str(e),
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                else:
                    logger.debug("IDLE triggered but no new emails found")
            finally:
                db.close()

        except Exception as e:
            logger.error(f"Error processing IDLE event: {e}")

    # ═══════════════════════════════════════
    # POLLING (legacy fallback)
    # ═══════════════════════════════════════

    def start_polling(self, interval: int = 30):
        """Start background polling for new emails (legacy fallback)."""
        if self._polling:
            return {"status": "already_polling", "interval": self._poll_interval}

        if not self.connected:
            raise ValueError("Gmail not connected. Call /gmail/connect first.")

        # Stop IDLE if active
        if self._idle_running:
            self.stop_idle_listener()

        self._poll_interval = interval
        self._polling = True
        self._listener_mode = "polling"
        self._poll_task = asyncio.create_task(self._poll_loop())

        logger.info(f"Started Gmail polling (every {interval}s)")
        return {"status": "polling_started", "interval": interval}

    def stop_polling(self):
        """Stop background polling."""
        self._polling = False
        self._listener_mode = "off"
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None

        logger.info("Stopped Gmail polling")
        return {"status": "polling_stopped"}

    def get_status(self) -> Dict:
        """Get current Gmail connection and listener status."""
        return {
            "connected": self.connected,
            "email": self.email_address if self.connected else None,
            "polling": self._polling or self._idle_running,  # backwards compat
            "listener_mode": self._listener_mode,
            "idle_active": self._idle_running,
            "poll_interval": self._poll_interval if self._polling else None,
            "last_sync_at": self._last_sync_at,
            "total_processed": self._total_processed,
            "recent_results": self._workflow_results[-10:],
        }

    def stop_all(self):
        """Stop any active listener (IDLE or polling)."""
        if self._idle_running:
            self.stop_idle_listener()
        if self._polling:
            self.stop_polling()
        return {"status": "stopped"}

    async def _poll_loop(self):
        """Background loop that checks for new emails and runs workflow."""
        from services.workflow_service import run_email_workflow

        while self._polling:
            try:
                db = SessionLocal()
                try:
                    new_emails = self.fetch_new_emails(db, limit=10)

                    if new_emails:
                        logger.info(f"Found {len(new_emails)} new Gmail emails")

                        for em in new_emails:
                            try:
                                result = await run_email_workflow(em.id, db)
                                self._workflow_results.append({
                                    "email_id": em.id,
                                    "subject": em.subject,
                                    "from": em.from_address,
                                    "result": result,
                                    "timestamp": datetime.utcnow().isoformat(),
                                })
                                self._total_processed += 1
                                if len(self._workflow_results) > 50:
                                    self._workflow_results = self._workflow_results[-50:]
                            except Exception as e:
                                logger.error(f"Workflow error for email {em.id}: {e}")
                                self._workflow_results.append({
                                    "email_id": em.id,
                                    "error": str(e),
                                    "timestamp": datetime.utcnow().isoformat(),
                                })

                finally:
                    db.close()

            except Exception as e:
                logger.error(f"Gmail poll error: {e}")

            await asyncio.sleep(self._poll_interval)

    def _parse_email(self, raw_email: bytes) -> Optional[Dict]:
        """Parse a raw email into a structured dict."""
        try:
            msg = email_lib.message_from_bytes(raw_email)

            subject = ""
            decoded_subject = decode_header(msg["Subject"] or "")
            for part, charset in decoded_subject:
                if isinstance(part, bytes):
                    subject += part.decode(charset or "utf-8", errors="replace")
                else:
                    subject += part

            from_header = msg["From"] or ""
            from_name = ""
            from_address = from_header
            if "<" in from_header:
                parts = from_header.split("<")
                from_name = parts[0].strip().strip('"')
                from_address = parts[1].strip(">").strip()

            body = ""
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    disposition = str(part.get("Content-Disposition", ""))
                    if "attachment" in disposition:
                        filename = part.get_filename() or "unknown"
                        payload = part.get_payload(decode=True) or b""
                        att_data = {
                            "filename": filename,
                            "content_type": content_type,
                            "size": len(payload),
                        }
                        # Store file bytes for resume-like attachments so we can extract text later
                        if filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt', '.tex')):
                            att_data["content_b64"] = base64.b64encode(payload).decode() if payload else ""
                        attachments.append(att_data)
                    elif content_type == "text/plain" and not body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            body = payload.decode("utf-8", errors="replace")
                    elif content_type == "text/html" and not body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            import re
                            html = payload.decode("utf-8", errors="replace")
                            body = re.sub(r'<[^>]+>', ' ', html)
                            body = re.sub(r'\s+', ' ', body).strip()
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode("utf-8", errors="replace")

            received_at = None
            date_str = msg["Date"]
            if date_str:
                try:
                    received_at = email_lib.utils.parsedate_to_datetime(date_str).isoformat()
                except Exception:
                    pass

            return {
                "message_id": msg["Message-ID"],
                "from_address": from_address,
                "from_name": from_name,
                "subject": subject,
                "body_snippet": body[:500],
                "body_full": body,
                "attachments": attachments,
                "received_at": received_at,
            }

        except Exception as e:
            logger.error(f"Email parse error: {e}")
            return None


# Singleton instance
gmail_manager = GmailManager()
