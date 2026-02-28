"""
Gmail Integration Service
- Connects via IMAP (App Password)
- Polls for new emails at configurable intervals
- Triggers auto-workflow for each new email
"""
import asyncio
import json
import logging
import imaplib
import email as email_lib
from email.header import decode_header
from datetime import datetime
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Email

logger = logging.getLogger("hireops.gmail")


class GmailManager:
    """Manages Gmail IMAP connection and background polling."""

    def __init__(self):
        self.connected = False
        self.email_address: str = ""
        self.app_password: str = ""
        self.imap_host: str = "imap.gmail.com"
        self.imap_port: int = 993
        self._poll_task: Optional[asyncio.Task] = None
        self._polling = False
        self._poll_interval: int = 30  # seconds
        self._last_sync_at: Optional[str] = None
        self._last_uid: Optional[str] = None
        self._workflow_results: List[Dict] = []
        self._total_processed: int = 0

    def connect(self, email_address: str, app_password: str) -> Dict:
        """Test connection to Gmail via IMAP."""
        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(email_address, app_password)
            mail.select("INBOX")

            # Get mailbox status
            status, data = mail.status("INBOX", "(MESSAGES UNSEEN)")
            mail.logout()

            self.email_address = email_address
            self.app_password = app_password
            self.connected = True

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

    def fetch_new_emails(self, db: Session, limit: int = 20) -> List[Email]:
        """Fetch new emails from Gmail that aren't already in our database."""
        if not self.connected:
            raise ValueError("Gmail not connected")

        try:
            mail = imaplib.IMAP4_SSL(self.imap_host, self.imap_port)
            mail.login(self.email_address, self.app_password)
            mail.select("INBOX")

            # Search for recent unseen emails, or all recent
            if self._last_uid:
                _, data = mail.uid("search", None, f"UID {self._last_uid}:*")
            else:
                _, data = mail.search(None, "ALL")

            nums = data[0].split()
            if not nums:
                mail.logout()
                return []

            nums = nums[-limit:]  # Latest N
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

                # Skip if already in DB
                msg_id = parsed.get("message_id")
                if msg_id:
                    existing = db.query(Email).filter(Email.message_id == msg_id).first()
                    if existing:
                        continue

                # Store in database
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

            # Update last UID
            if nums:
                self._last_uid = nums[-1].decode() if isinstance(nums[-1], bytes) else str(nums[-1])

            mail.logout()
            self._last_sync_at = datetime.utcnow().isoformat()
            return new_emails

        except Exception as e:
            logger.error(f"Gmail fetch error: {e}")
            raise

    def start_polling(self, interval: int = 30):
        """Start background polling for new emails."""
        if self._polling:
            return {"status": "already_polling", "interval": self._poll_interval}

        if not self.connected:
            raise ValueError("Gmail not connected. Call /gmail/connect first.")

        self._poll_interval = interval
        self._polling = True
        self._poll_task = asyncio.create_task(self._poll_loop())

        logger.info(f"Started Gmail polling (every {interval}s)")
        return {"status": "polling_started", "interval": interval}

    def stop_polling(self):
        """Stop background polling."""
        self._polling = False
        if self._poll_task:
            self._poll_task.cancel()
            self._poll_task = None

        logger.info("Stopped Gmail polling")
        return {"status": "polling_stopped"}

    def get_status(self) -> Dict:
        """Get current Gmail connection and polling status."""
        return {
            "connected": self.connected,
            "email": self.email_address if self.connected else None,
            "polling": self._polling,
            "poll_interval": self._poll_interval if self._polling else None,
            "last_sync_at": self._last_sync_at,
            "total_processed": self._total_processed,
            "recent_results": self._workflow_results[-10:],
        }

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
                                # Keep only last 50 results
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

            # Subject
            subject = ""
            decoded_subject = decode_header(msg["Subject"] or "")
            for part, charset in decoded_subject:
                if isinstance(part, bytes):
                    subject += part.decode(charset or "utf-8", errors="replace")
                else:
                    subject += part

            # From
            from_header = msg["From"] or ""
            from_name = ""
            from_address = from_header
            if "<" in from_header:
                parts = from_header.split("<")
                from_name = parts[0].strip().strip('"')
                from_address = parts[1].strip(">").strip()

            # Body + attachments
            body = ""
            attachments = []
            if msg.is_multipart():
                for part in msg.walk():
                    content_type = part.get_content_type()
                    disposition = str(part.get("Content-Disposition", ""))
                    if "attachment" in disposition:
                        filename = part.get_filename() or "unknown"
                        payload = part.get_payload(decode=True) or b""
                        attachments.append({
                            "filename": filename,
                            "content_type": content_type,
                            "size": len(payload),
                        })
                    elif content_type == "text/plain" and not body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            body = payload.decode("utf-8", errors="replace")
                    elif content_type == "text/html" and not body:
                        payload = part.get_payload(decode=True)
                        if payload:
                            # Basic HTML to text
                            import re
                            html = payload.decode("utf-8", errors="replace")
                            body = re.sub(r'<[^>]+>', ' ', html)
                            body = re.sub(r'\s+', ' ', body).strip()
            else:
                payload = msg.get_payload(decode=True)
                if payload:
                    body = payload.decode("utf-8", errors="replace")

            # Date
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
