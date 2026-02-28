"""
SMTP Email Sending Service
Reuses stored Gmail credentials (from IMAP connection) to send emails via SMTP.
"""
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from services.gmail_service import gmail_manager

logger = logging.getLogger("hireops.smtp")

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def _get_credentials() -> Optional[dict]:
    """Get stored Gmail credentials from the gmail_manager."""
    creds = gmail_manager._load_credentials()
    if not creds:
        logger.error("No Gmail credentials found — connect Gmail first")
        return None
    return creds


def send_email(
    to_email: str,
    subject: str,
    body_html: str,
    body_text: Optional[str] = None,
    ics_attachment: Optional[str] = None,
    ics_filename: str = "invite.ics",
) -> dict:
    """Send an email using stored Gmail SMTP credentials.

    Args:
        ics_attachment: Optional .ics calendar invite content to attach.
        ics_filename: Filename for the .ics attachment.

    Returns: {"success": True/False, "message": "..."}
    """
    creds = _get_credentials()
    if not creds:
        return {"success": False, "message": "Gmail not connected. Connect Gmail first."}

    from_email = creds["email"]
    password = creds["password"]

    # Build text/html body alternatives
    body_part = MIMEMultipart("alternative")
    if body_text:
        body_part.attach(MIMEText(body_text, "plain"))
    body_part.attach(MIMEText(body_html, "html"))

    if ics_attachment:
        # Wrap in "mixed" to hold body + .ics attachment
        msg = MIMEMultipart("mixed")
        msg.attach(body_part)

        # Add .ics as text/calendar attachment
        ics_part = MIMEText(ics_attachment, "calendar", "utf-8")
        ics_part.add_header("Content-Disposition", "attachment", filename=ics_filename)
        ics_part.set_param("method", "REQUEST")
        msg.attach(ics_part)
    else:
        msg = body_part

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as server:
            server.ehlo()
            server.starttls()
            server.ehlo()
            server.login(from_email, password)
            server.sendmail(from_email, to_email, msg.as_string())

        logger.info(f"Email sent to {to_email}: {subject}")
        return {"success": True, "message": f"Email sent to {to_email}"}

    except smtplib.SMTPAuthenticationError:
        logger.error("SMTP authentication failed — check Gmail App Password")
        return {"success": False, "message": "Gmail authentication failed. Check App Password."}
    except Exception as e:
        logger.error(f"SMTP send error: {e}")
        return {"success": False, "message": f"Failed to send email: {str(e)}"}


def send_interview_link_email(
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str,
    interview_url: str,
) -> dict:
    """Send interview link email to candidate."""
    subject = f"Interview Invitation — {job_title} at {company_name}"

    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">{company_name}</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Interview Invitation</p>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Hi {candidate_name},
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Thank you for applying for the <strong>{job_title}</strong> position at {company_name}.
                We were impressed by your background and would like to invite you to a short screening interview.
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                This is an AI-powered voice interview that takes approximately <strong>8–10 minutes</strong>.
                You'll need a working microphone and camera.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="{interview_url}"
                   style="background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px;
                          text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                    Start Your Interview
                </a>
            </div>
            <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
                This link is valid for 72 hours. Please complete the interview at your earliest convenience.
                Make sure you're in a quiet environment with good internet connectivity.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                This is an automated message from {company_name}'s recruitment system.
                If you did not apply for this position, please ignore this email.
            </p>
        </div>
    </div>
    """

    body_text = (
        f"Hi {candidate_name},\n\n"
        f"Thank you for applying for the {job_title} position at {company_name}.\n"
        f"We'd like to invite you to a short AI-powered screening interview (8-10 minutes).\n\n"
        f"Start your interview here: {interview_url}\n\n"
        f"This link is valid for 72 hours.\n\n"
        f"Best regards,\n{company_name} Recruitment Team"
    )

    return send_email(to_email, subject, body_html, body_text)


def send_rejection_email(
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str,
) -> dict:
    """Send a professional rejection email to candidate."""
    subject = f"Update on Your Application — {job_title} at {company_name}"

    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #334155; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">{company_name}</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Dear {candidate_name},
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Thank you for your interest in the <strong>{job_title}</strong> position at {company_name}
                and for taking the time to apply.
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                After careful review, we have decided to move forward with other candidates whose experience
                more closely aligns with the requirements for this particular role.
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                We encourage you to apply for future openings that match your skills and experience.
                We wish you the very best in your career journey.
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Best regards,<br>
                <strong>{company_name} Talent Acquisition Team</strong>
            </p>
        </div>
    </div>
    """

    body_text = (
        f"Dear {candidate_name},\n\n"
        f"Thank you for your interest in the {job_title} position at {company_name}.\n\n"
        f"After careful review, we have decided to move forward with other candidates.\n"
        f"We encourage you to apply for future openings.\n\n"
        f"Best regards,\n{company_name} Talent Acquisition Team"
    )

    return send_email(to_email, subject, body_html, body_text)


def send_scheduling_email(
    to_email: str,
    candidate_name: str,
    job_title: str,
    company_name: str,
    slot: str,
    email_draft: str = "",
    interview_url: str = "",
    ics_attachment: Optional[str] = None,
) -> dict:
    """Send interview scheduling confirmation email with calendar invite and interview room link."""
    subject = f"Interview Scheduled — {job_title} at {company_name}"

    draft_html = ""
    if email_draft:
        draft_html = f'<p style="color: #334155; font-size: 16px; line-height: 1.6;">{email_draft.replace(chr(10), "<br>")}</p>'

    interview_url_html = ""
    if interview_url:
        interview_url_html = f"""
            <div style="text-align: center; margin: 24px 0;">
                <p style="color: #334155; font-size: 14px; margin-bottom: 12px;">
                    Your interview will be conducted via our AI-powered interview platform.
                    Our AI assistant will join to take notes so the interviewer can focus on the conversation.
                </p>
                <a href="{interview_url}"
                   style="background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px;
                          text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                    Join Interview Room
                </a>
                <p style="color: #64748b; font-size: 12px; margin-top: 8px;">
                    Please have your webcam and microphone ready. This link will be active at your scheduled time.
                </p>
            </div>
        """

    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">{company_name}</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Interview Scheduled</p>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Hi {candidate_name},
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Great news! Your Round 2 interview for the <strong>{job_title}</strong> position
                has been scheduled.
            </p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <p style="color: #166534; font-size: 14px; font-weight: 600; margin: 0 0 4px 0;">Scheduled Time</p>
                <p style="color: #15803d; font-size: 18px; font-weight: 700; margin: 0;">{slot}</p>
            </div>
            {interview_url_html}
            {draft_html}
            <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
                A calendar invite is attached. Please confirm your attendance by replying to this email.
                If you need to reschedule, let us know at least 24 hours in advance.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                This is an automated message from {company_name}'s recruitment system.
            </p>
        </div>
    </div>
    """

    interview_text = ""
    if interview_url:
        interview_text = f"Join your interview room: {interview_url}\n\n"

    body_text = (
        f"Hi {candidate_name},\n\n"
        f"Your Round 2 interview for the {job_title} position has been scheduled.\n\n"
        f"Scheduled Time: {slot}\n\n"
        + interview_text
        + (f"{email_draft}\n\n" if email_draft else "")
        + f"A calendar invite is attached. Please confirm your attendance by replying to this email.\n\n"
        f"Best regards,\n{company_name} Recruitment Team"
    )

    return send_email(to_email, subject, body_html, body_text, ics_attachment=ics_attachment)


def send_custom_email(
    to_email: str,
    candidate_name: str,
    subject: str,
    body: str,
    company_name: str = "HireOps AI",
) -> dict:
    """Send a custom email (e.g., AI-generated follow-up draft)."""
    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px;">
            {body.replace(chr(10), '<br>')}
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                Sent via {company_name}
            </p>
        </div>
    </div>
    """

    return send_email(to_email, subject, body_html, body)
