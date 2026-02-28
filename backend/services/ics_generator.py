"""
ICS Calendar Invite Generator (RFC 5545).
Generates .ics file content for interview scheduling.
No external dependencies — uses only Python stdlib.
"""
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional


def parse_slot_to_datetime(slot_text: str) -> datetime:
    """Parse a human-readable slot string into a UTC datetime.

    Handles formats like:
      - "Tuesday, March 4, 2025 at 2:00 PM"
      - "Monday, March 3rd, 10:00 AM"
      - "Tomorrow 3:00 PM"
      - "March 5, 2025 at 10:00 AM"

    Falls back to next business day at 10:00 AM UTC if parsing fails.
    """
    clean = slot_text.strip()
    # Strip ordinal suffixes (1st, 2nd, 3rd, 4th)
    clean = re.sub(r"(\d+)(st|nd|rd|th)", r"\1", clean)
    # Remove "at" keyword
    clean = clean.replace(" at ", " ")

    # Remove leading day-of-week (e.g. "Tuesday, ")
    clean = re.sub(
        r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s*",
        "",
        clean,
        flags=re.IGNORECASE,
    )

    now = datetime.utcnow()

    # Handle "Tomorrow"
    if clean.lower().startswith("tomorrow"):
        time_part = clean[len("tomorrow"):].strip()
        base_date = now + timedelta(days=1)
        try:
            t = datetime.strptime(time_part, "%I:%M %p")
            return base_date.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
        except ValueError:
            return base_date.replace(hour=10, minute=0, second=0, microsecond=0)

    # Handle "Today"
    if clean.lower().startswith("today"):
        time_part = clean[len("today"):].strip()
        try:
            t = datetime.strptime(time_part, "%I:%M %p")
            return now.replace(hour=t.hour, minute=t.minute, second=0, microsecond=0)
        except ValueError:
            return now.replace(hour=10, minute=0, second=0, microsecond=0)

    # Try common patterns
    patterns = [
        "%B %d, %Y %I:%M %p",      # "March 4, 2025 2:00 PM"
        "%B %d %Y %I:%M %p",       # "March 4 2025 2:00 PM"
        "%B %d, %I:%M %p",         # "March 4, 2:00 PM" (no year)
        "%B %d %I:%M %p",          # "March 4 2:00 PM"
        "%m/%d/%Y %I:%M %p",       # "03/04/2025 2:00 PM"
        "%B %d, %Y %I:%M%p",       # "March 4, 2025 2:00PM" (no space before AM/PM)
        "%B %d, %Y %H:%M",         # "March 4, 2025 14:00" (24h)
    ]

    # Also try with " - " range removed (e.g. "March 4, 10:00 AM - 11:00 AM")
    clean_no_range = re.sub(r"\s*-\s*\d{1,2}:\d{2}\s*(AM|PM|am|pm)?", "", clean)

    for text in [clean, clean_no_range]:
        for pattern in patterns:
            try:
                dt = datetime.strptime(text.strip(), pattern)
                if "%Y" not in pattern:
                    dt = dt.replace(year=now.year)
                    if dt < now:
                        dt = dt.replace(year=now.year + 1)
                return dt
            except ValueError:
                continue

    # Fallback: next business day at 10:00 AM
    fallback = now + timedelta(days=1)
    while fallback.weekday() >= 5:  # Skip Saturday/Sunday
        fallback += timedelta(days=1)
    return fallback.replace(hour=10, minute=0, second=0, microsecond=0)


def generate_ics(
    summary: str,
    dtstart: datetime,
    duration_minutes: int = 60,
    description: str = "",
    location: str = "",
    organizer_email: str = "",
    organizer_name: str = "HireOps AI",
    attendee_email: str = "",
    attendee_name: str = "",
    url: str = "",
) -> str:
    """Generate an RFC 5545 ICS calendar invite string.

    Args:
        summary: Event title
        dtstart: Event start time (UTC)
        duration_minutes: Duration in minutes (default 60)
        description: Event description
        location: Location or URL
        organizer_email: Organizer's email
        organizer_name: Organizer display name
        attendee_email: Attendee's email
        attendee_name: Attendee's display name
        url: URL to include in the event

    Returns:
        String containing the full .ics file content.
    """
    uid = str(uuid.uuid4())
    dtend = dtstart + timedelta(minutes=duration_minutes)
    dtstamp = datetime.utcnow()

    def fmt(dt: datetime) -> str:
        return dt.strftime("%Y%m%dT%H%M%SZ")

    def escape(text: str) -> str:
        return (
            text.replace("\\", "\\\\")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("\n", "\\n")
        )

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//HireOps AI//Interview Scheduler//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:REQUEST",
        "BEGIN:VEVENT",
        "UID:%s" % uid,
        "DTSTAMP:%s" % fmt(dtstamp),
        "DTSTART:%s" % fmt(dtstart),
        "DTEND:%s" % fmt(dtend),
        "SUMMARY:%s" % escape(summary),
    ]

    if description:
        lines.append("DESCRIPTION:%s" % escape(description))
    if location:
        lines.append("LOCATION:%s" % escape(location))
    if url:
        lines.append("URL:%s" % url)
    if organizer_email:
        lines.append("ORGANIZER;CN=%s:mailto:%s" % (escape(organizer_name), organizer_email))
    if attendee_email:
        lines.append(
            "ATTENDEE;CN=%s;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:%s"
            % (escape(attendee_name), attendee_email)
        )

    lines.extend([
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        "DESCRIPTION:Interview starting in 15 minutes",
        "END:VALARM",
        "END:VEVENT",
        "END:VCALENDAR",
    ])

    return "\r\n".join(lines)
