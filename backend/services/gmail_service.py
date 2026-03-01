"""
Gmail Integration Service (Gmail API over HTTPS)
- Connects via Gmail API using OAuth2 refresh token from env vars
- Polls for new emails via Gmail API (HTTPS port 443 — works on HF Spaces)
- Triggers auto-workflow when new email arrives
- Persists connection state in DB — auto-reconnects on restart
"""
import asyncio
import base64
import json
import logging
import os
import re
from datetime import datetime
from typing import Optional, List, Dict

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from sqlalchemy.orm import Session
from database import SessionLocal
from models import Email, Setting

logger = logging.getLogger("hireops.gmail")

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]


# ═══════════════════════════════════════
# DB helpers (unchanged)
# ═══════════════════════════════════════

def _save_setting(key, value):
    # type: (str, str) -> None
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


def _load_setting(key):
    # type: (str) -> Optional[str]
    db = SessionLocal()
    try:
        setting = db.query(Setting).filter(Setting.key == key).first()
        return setting.value if setting else None
    finally:
        db.close()


def _delete_setting(key):
    # type: (str) -> None
    db = SessionLocal()
    try:
        db.query(Setting).filter(Setting.key == key).delete()
        db.commit()
    finally:
        db.close()


class GmailManager:
    """Manages Gmail API connection with polling-based listener."""

    def __init__(self):
        self.connected = False
        self.email_address = ""  # type: str
        self._credentials = None  # type: Optional[Credentials]
        self._service = None
        # Polling
        self._poll_task = None  # type: Optional[asyncio.Task]
        self._polling = False
        self._poll_interval = 30  # type: int
        # Shared state (same shape for frontend compat)
        self._last_sync_at = None  # type: Optional[str]
        self._workflow_results = []  # type: List[Dict]
        self._total_processed = 0  # type: int
        self._listener_mode = "off"  # type: str
        self._auto_start_listener = False  # type: bool

    # ═══════════════════════════════════════
    # Credentials & Service
    # ═══════════════════════════════════════

    def _build_credentials(self):
        # type: () -> Optional[Credentials]
        """Build OAuth2 credentials from env vars."""
        client_id = os.getenv("GMAIL_CLIENT_ID", "")
        client_secret = os.getenv("GMAIL_CLIENT_SECRET", "")
        refresh_token = os.getenv("GMAIL_REFRESH_TOKEN", "")

        if not all([client_id, client_secret, refresh_token]):
            return None

        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
        creds.refresh(Request())
        return creds

    def _get_service(self):
        """Get or create the Gmail API service, refreshing token if expired."""
        if self._credentials and self._credentials.expired:
            self._credentials.refresh(Request())
        if not self._service:
            self._service = build("gmail", "v1", credentials=self._credentials,
                                  cache_discovery=False)
        return self._service

    # ═══════════════════════════════════════
    # Connect / Disconnect
    # ═══════════════════════════════════════

    def connect(self, email_address, app_password="", persist=True):
        # type: (str, str, bool) -> Dict
        """Connect to Gmail via API. app_password is ignored (kept for router compat)."""
        try:
            creds = self._build_credentials()
            if not creds:
                raise ValueError(
                    "Gmail API credentials not configured. "
                    "Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN "
                    "environment variables. Run 'python scripts/setup_gmail_oauth.py' "
                    "locally to generate them."
                )

            self._credentials = creds
            service = self._get_service()

            # Verify access by getting profile
            profile = service.users().getProfile(userId="me").execute()
            api_email = profile.get("emailAddress", "")

            if email_address and api_email.lower() != email_address.lower():
                raise ValueError(
                    "OAuth credentials are for %s, but you entered %s. "
                    "Use the correct email or update OAuth credentials."
                    % (api_email, email_address)
                )

            self.email_address = api_email
            self.connected = True

            if persist:
                self._save_credentials(api_email)

            total = profile.get("messagesTotal", 0)
            return {
                "status": "connected",
                "email": api_email,
                "info": "INBOX (MESSAGES %d)" % total,
            }

        except ValueError:
            raise
        except Exception as e:
            raise ValueError("Gmail API connection failed: %s" % str(e))

    def _save_credentials(self, email_address):
        # type: (str) -> None
        """Save connection state to DB."""
        try:
            data = json.dumps({"email": email_address, "method": "gmail_api"})
            _save_setting("gmail_credentials", data)
            _save_setting("gmail_listener_enabled", "true")
            logger.info("Saved Gmail connection state for %s", email_address)
        except Exception as e:
            logger.warning("Failed to save Gmail credentials: %s", e)

    def _load_credentials(self):
        # type: () -> Optional[Dict]
        """Load saved connection info from DB."""
        try:
            raw = _load_setting("gmail_credentials")
            if not raw:
                return None
            data = json.loads(raw)
            # Backward compat: old IMAP format had "password" key
            if "password" in data and "method" not in data:
                data["method"] = "imap_legacy"
            return data
        except Exception as e:
            logger.warning("Failed to load Gmail credentials: %s", e)
            return None

    def restore_from_db(self):
        # type: () -> bool
        """Restore connection from saved state + env var credentials."""
        creds = self._load_credentials()
        if not creds:
            logger.info("No saved Gmail credentials found")
            return False

        try:
            email = creds.get("email", "")
            self.connect(email, persist=False)
            logger.info("Restored Gmail connection for %s", email)

            listener_enabled = _load_setting("gmail_listener_enabled")
            if listener_enabled == "true":
                self._auto_start_listener = True
            return True
        except Exception as e:
            logger.warning("Failed to restore Gmail connection: %s", e)
            return False

    def disconnect(self):
        # type: () -> None
        """Disconnect Gmail and clear saved state."""
        self.stop_all()
        self.connected = False
        self.email_address = ""
        self._credentials = None
        self._service = None
        _delete_setting("gmail_credentials")
        _delete_setting("gmail_listener_enabled")
        logger.info("Gmail disconnected and credentials cleared")

    # ═══════════════════════════════════════
    # Fetch & Parse Emails
    # ═══════════════════════════════════════

    def fetch_new_emails(self, db, limit=20):
        # type: (Session, int) -> List[Email]
        """Fetch new emails from Gmail API that aren't already in our database."""
        if not self.connected:
            raise ValueError("Gmail not connected")

        service = self._get_service()
        new_emails = []

        try:
            results = service.users().messages().list(
                userId="me",
                labelIds=["INBOX"],
                maxResults=limit,
            ).execute()

            messages = results.get("messages", [])

            for msg_meta in messages:
                msg_id = msg_meta["id"]

                existing = db.query(Email).filter(Email.message_id == msg_id).first()
                if existing:
                    continue

                msg = service.users().messages().get(
                    userId="me",
                    id=msg_id,
                    format="full",
                ).execute()

                parsed = self._parse_gmail_message(msg)
                if not parsed:
                    continue

                email_obj = Email(
                    message_id=msg_id,
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

            self._last_sync_at = datetime.utcnow().isoformat()
            return new_emails

        except Exception as e:
            logger.error("Gmail API fetch error: %s", e)
            raise

    def _parse_gmail_message(self, msg):
        # type: (Dict) -> Optional[Dict]
        """Parse a Gmail API message into the same dict format the app expects."""
        try:
            headers = {
                h["name"].lower(): h["value"]
                for h in msg.get("payload", {}).get("headers", [])
            }

            from_header = headers.get("from", "")
            from_name = ""
            from_address = from_header
            if "<" in from_header:
                parts = from_header.split("<")
                from_name = parts[0].strip().strip('"')
                from_address = parts[1].strip(">").strip()

            subject = headers.get("subject", "")

            body_parts = []  # type: List[str]
            attachments = []  # type: List[Dict]
            payload = msg.get("payload", {})
            self._extract_body_and_attachments(
                payload, msg["id"], body_parts, attachments
            )
            body = body_parts[0] if body_parts else msg.get("snippet", "")

            received_at = None
            internal_date = msg.get("internalDate")
            if internal_date:
                received_at = datetime.utcfromtimestamp(
                    int(internal_date) / 1000
                ).isoformat()

            return {
                "message_id": msg["id"],
                "from_address": from_address,
                "from_name": from_name,
                "subject": subject,
                "body_snippet": body[:500],
                "body_full": body,
                "attachments": attachments,
                "received_at": received_at,
            }
        except Exception as e:
            logger.error("Gmail message parse error: %s", e)
            return None

    def _extract_body_and_attachments(self, part, msg_id, body_out, attachments_out):
        # type: (Dict, str, List[str], List[Dict]) -> None
        """Recursively extract body text and attachment info from Gmail payload."""
        mime_type = part.get("mimeType", "")
        filename = part.get("filename", "")

        if filename and part.get("body", {}).get("attachmentId"):
            att_data = {
                "filename": filename,
                "content_type": mime_type,
                "size": part.get("body", {}).get("size", 0),
            }  # type: Dict
            # Fetch content for resume-like files
            if filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt', '.tex')):
                att_id = part["body"]["attachmentId"]
                try:
                    service = self._get_service()
                    att = service.users().messages().attachments().get(
                        userId="me",
                        messageId=msg_id,
                        id=att_id,
                    ).execute()
                    att_bytes = base64.urlsafe_b64decode(att["data"])
                    att_data["content_b64"] = base64.b64encode(att_bytes).decode()
                except Exception as e:
                    logger.warning("Failed to fetch attachment %s: %s", filename, e)
            attachments_out.append(att_data)

        elif mime_type == "text/plain" and not body_out:
            data = part.get("body", {}).get("data", "")
            if data:
                text = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                body_out.append(text)

        elif mime_type == "text/html" and not body_out:
            data = part.get("body", {}).get("data", "")
            if data:
                html = base64.urlsafe_b64decode(data).decode("utf-8", errors="replace")
                text = re.sub(r'<[^>]+>', ' ', html)
                text = re.sub(r'\s+', ' ', text).strip()
                body_out.append(text)

        for sub_part in part.get("parts", []):
            self._extract_body_and_attachments(sub_part, msg_id, body_out, attachments_out)

    # ═══════════════════════════════════════
    # Listener (Polling via Gmail API)
    # ═══════════════════════════════════════

    def start_idle_listener(self):
        """Start polling listener. Name kept for API compat (IDLE not available via Gmail API)."""
        return self.start_polling(interval=self._poll_interval)

    def stop_idle_listener(self):
        """Stop polling listener. Name kept for API compat."""
        return self.stop_polling()

    def start_polling(self, interval=30):
        # type: (int) -> Dict
        """Start background polling for new emails via Gmail API."""
        if self._polling:
            return {"status": "already_listening", "mode": "polling"}

        if not self.connected:
            raise ValueError("Gmail not connected. Call /gmail/connect first.")

        self._poll_interval = interval
        self._polling = True
        self._listener_mode = "polling"
        self._poll_task = asyncio.create_task(self._poll_loop())

        try:
            _save_setting("gmail_listener_enabled", "true")
        except Exception:
            pass

        logger.info("Started Gmail polling (every %ds)", interval)
        return {"status": "listening", "mode": "polling"}

    def stop_polling(self):
        # type: () -> Dict
        """Stop background polling."""
        self._polling = False
        self._listener_mode = "off"
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None

        try:
            _save_setting("gmail_listener_enabled", "false")
        except Exception:
            pass

        logger.info("Stopped Gmail polling")
        return {"status": "stopped"}

    def get_status(self):
        # type: () -> Dict
        """Get current status. Returns same shape as before for frontend compat."""
        return {
            "connected": self.connected,
            "email": self.email_address if self.connected else None,
            "polling": self._polling,
            "listener_mode": self._listener_mode,
            "idle_active": self._polling,  # Map to idle_active for frontend compat
            "poll_interval": self._poll_interval if self._polling else None,
            "last_sync_at": self._last_sync_at,
            "total_processed": self._total_processed,
            "recent_results": self._workflow_results[-10:],
        }

    def stop_all(self):
        # type: () -> Dict
        """Stop any active listener."""
        if self._polling:
            self.stop_polling()
        return {"status": "stopped"}

    async def _poll_loop(self):
        """Background loop: poll Gmail API for new emails and run workflow."""
        from services.workflow_service import run_email_workflow

        while self._polling:
            try:
                db = SessionLocal()
                try:
                    new_emails = self.fetch_new_emails(db, limit=10)

                    if new_emails:
                        logger.info("Found %d new Gmail emails", len(new_emails))
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
                                logger.error("Workflow error for email %d: %s", em.id, e)
                                self._workflow_results.append({
                                    "email_id": em.id,
                                    "error": str(e),
                                    "timestamp": datetime.utcnow().isoformat(),
                                })
                finally:
                    db.close()

            except Exception as e:
                logger.error("Gmail poll error: %s", e)

            await asyncio.sleep(self._poll_interval)


# Singleton instance
gmail_manager = GmailManager()
