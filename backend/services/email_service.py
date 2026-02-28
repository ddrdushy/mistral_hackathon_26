"""Email fetching and parsing service."""
import json
from typing import List
import imaplib
import email as email_lib
from email.header import decode_header
from pathlib import Path
from datetime import datetime
from sqlalchemy.orm import Session
from models import Email


SAMPLE_EMAILS_PATH = Path(__file__).parent.parent / "seed" / "sample_emails.json"


def load_sample_inbox(db: Session) -> List[Email]:
    """Load sample emails from JSON file into the database."""
    if not SAMPLE_EMAILS_PATH.exists():
        return []

    with open(SAMPLE_EMAILS_PATH) as f:
        emails_data = json.load(f)

    created = []
    for data in emails_data:
        existing = db.query(Email).filter(Email.message_id == data.get("message_id")).first()
        if existing:
            continue

        email_obj = Email(
            message_id=data.get("message_id"),
            from_address=data["from_address"],
            from_name=data.get("from_name", ""),
            subject=data.get("subject", ""),
            body_snippet=data.get("body_snippet", "")[:500],
            body_full=data.get("body_full", data.get("body_snippet", "")),
            attachments=json.dumps(data.get("attachments", [])),
            received_at=datetime.fromisoformat(data["received_at"]) if data.get("received_at") else datetime.utcnow(),
        )
        db.add(email_obj)
        created.append(email_obj)

    db.commit()
    for e in created:
        db.refresh(e)
    return created


def fetch_imap_emails(
    host: str, port: int, user: str, password: str, ssl: bool = True, limit: int = 50
) -> List[dict]:
    """Fetch emails from an IMAP server."""
    if ssl:
        mail = imaplib.IMAP4_SSL(host, port)
    else:
        mail = imaplib.IMAP4(host, port)

    mail.login(user, password)
    mail.select("INBOX")

    _, message_numbers = mail.search(None, "ALL")
    nums = message_numbers[0].split()
    nums = nums[-limit:]  # Get latest N

    emails = []
    for num in nums:
        _, msg_data = mail.fetch(num, "(RFC822)")
        raw_email = msg_data[0][1]
        msg = email_lib.message_from_bytes(raw_email)

        subject = ""
        decoded_subject = decode_header(msg["Subject"])
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
                    attachments.append({
                        "filename": filename,
                        "content_type": content_type,
                        "size": len(part.get_payload(decode=True) or b""),
                    })
                elif content_type == "text/plain":
                    payload = part.get_payload(decode=True)
                    if payload:
                        body = payload.decode("utf-8", errors="replace")
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode("utf-8", errors="replace")

        date_str = msg["Date"]
        received_at = None
        if date_str:
            try:
                received_at = email_lib.utils.parsedate_to_datetime(date_str).isoformat()
            except Exception:
                pass

        emails.append({
            "message_id": msg["Message-ID"],
            "from_address": from_address,
            "from_name": from_name,
            "subject": subject,
            "body_snippet": body[:500],
            "body_full": body,
            "attachments": attachments,
            "received_at": received_at,
        })

    mail.logout()
    return emails


def sync_imap_emails(db: Session, emails_data: List[dict]) -> List[Email]:
    """Store fetched IMAP emails into the database."""
    created = []
    for data in emails_data:
        existing = db.query(Email).filter(Email.message_id == data.get("message_id")).first()
        if existing:
            continue

        email_obj = Email(
            message_id=data.get("message_id"),
            from_address=data["from_address"],
            from_name=data.get("from_name", ""),
            subject=data.get("subject", ""),
            body_snippet=data.get("body_snippet", ""),
            body_full=data.get("body_full", ""),
            attachments=json.dumps(data.get("attachments", [])),
            received_at=datetime.fromisoformat(data["received_at"]) if data.get("received_at") else None,
        )
        db.add(email_obj)
        created.append(email_obj)

    db.commit()
    for e in created:
        db.refresh(e)
    return created
