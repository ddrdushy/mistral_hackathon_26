"""
Email Sending Service (Gmail API)
Uses Gmail API instead of SMTP — works on HF Spaces (HTTPS only, port 587 blocked).
"""
import base64
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from services.gmail_service import gmail_manager

logger = logging.getLogger("hireops.smtp")


def send_email(
    to_email,       # type: str
    subject,        # type: str
    body_html,      # type: str
    body_text=None,          # type: Optional[str]
    ics_attachment=None,     # type: Optional[str]
    ics_filename="invite.ics",  # type: str
):
    # type: (...) -> dict
    """Send an email using Gmail API."""
    if not gmail_manager.connected:
        return {"success": False, "message": "Gmail not connected. Connect Gmail first."}

    from_email = gmail_manager.email_address

    # Build MIME message (same structure as before)
    body_part = MIMEMultipart("alternative")
    if body_text:
        body_part.attach(MIMEText(body_text, "plain"))
    body_part.attach(MIMEText(body_html, "html"))

    if ics_attachment:
        msg = MIMEMultipart("mixed")
        msg.attach(body_part)
        ics_part = MIMEText(ics_attachment, "calendar", "utf-8")
        ics_part.add_header("Content-Disposition", "attachment", filename=ics_filename)
        ics_part.set_param("method", "REQUEST")
        msg.attach(ics_part)
    else:
        msg = body_part

    msg["to"] = to_email
    msg["from"] = from_email
    msg["subject"] = subject

    try:
        service = gmail_manager._get_service()
        raw_message = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")

        service.users().messages().send(
            userId="me",
            body={"raw": raw_message},
        ).execute()

        logger.info("Email sent via Gmail API to %s: %s", to_email, subject)
        return {"success": True, "message": "Email sent to %s" % to_email}

    except Exception as e:
        logger.error("Gmail API send error: %s", e)
        return {"success": False, "message": "Failed to send email: %s" % str(e)}


def send_interview_link_email(
    to_email,        # type: str
    candidate_name,  # type: str
    job_title,       # type: str
    company_name,    # type: str
    interview_url,   # type: str
):
    # type: (...) -> dict
    """Send interview link email to candidate."""
    subject = "Interview Invitation \u2014 %s at %s" % (job_title, company_name)

    body_html = """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">%(company)s</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Interview Invitation</p>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">Hi %(name)s,</p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Thank you for applying for the <strong>%(job)s</strong> position at %(company)s.
                We were impressed by your background and would like to invite you to a short screening interview.
            </p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                This is an AI-powered voice interview that takes approximately <strong>8\u201310 minutes</strong>.
                You'll need a working microphone and camera.
            </p>
            <div style="text-align: center; margin: 30px 0;">
                <a href="%(url)s"
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
                This is an automated message from %(company)s's recruitment system.
                If you did not apply for this position, please ignore this email.
            </p>
        </div>
    </div>
    """ % {"company": company_name, "name": candidate_name, "job": job_title, "url": interview_url}

    body_text = (
        "Hi %s,\n\n"
        "Thank you for applying for the %s position at %s.\n"
        "We'd like to invite you to a short AI-powered screening interview (8-10 minutes).\n\n"
        "Start your interview here: %s\n\n"
        "This link is valid for 72 hours.\n\n"
        "Best regards,\n%s Recruitment Team"
    ) % (candidate_name, job_title, company_name, interview_url, company_name)

    return send_email(to_email, subject, body_html, body_text)


def send_rejection_email(
    to_email,        # type: str
    candidate_name,  # type: str
    job_title,       # type: str
    company_name,    # type: str
):
    # type: (...) -> dict
    """Send a professional rejection email to candidate."""
    subject = "Update on Your Application \u2014 %s at %s" % (job_title, company_name)

    body_html = """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #334155; padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">%(company)s</h1>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">Dear %(name)s,</p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Thank you for your interest in the <strong>%(job)s</strong> position at %(company)s
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
                Best regards,<br><strong>%(company)s Talent Acquisition Team</strong>
            </p>
        </div>
    </div>
    """ % {"company": company_name, "name": candidate_name, "job": job_title}

    body_text = (
        "Dear %s,\n\n"
        "Thank you for your interest in the %s position at %s.\n\n"
        "After careful review, we have decided to move forward with other candidates.\n"
        "We encourage you to apply for future openings.\n\n"
        "Best regards,\n%s Talent Acquisition Team"
    ) % (candidate_name, job_title, company_name, company_name)

    return send_email(to_email, subject, body_html, body_text)


def send_scheduling_email(
    to_email,         # type: str
    candidate_name,   # type: str
    job_title,        # type: str
    company_name,     # type: str
    slot,             # type: str
    email_draft="",          # type: str
    interview_url="",        # type: str
    ics_attachment=None,     # type: Optional[str]
):
    # type: (...) -> dict
    """Send interview scheduling confirmation email with calendar invite."""
    subject = "Interview Scheduled \u2014 %s at %s" % (job_title, company_name)

    draft_html = ""
    if email_draft:
        draft_html = '<p style="color: #334155; font-size: 16px; line-height: 1.6;">%s</p>' % email_draft.replace(chr(10), "<br>")

    interview_url_html = ""
    if interview_url:
        interview_url_html = """
            <div style="text-align: center; margin: 24px 0;">
                <p style="color: #334155; font-size: 14px; margin-bottom: 12px;">
                    Your interview will be conducted via our AI-powered interview platform.
                </p>
                <a href="%(url)s"
                   style="background: #6366f1; color: white; padding: 14px 32px; border-radius: 8px;
                          text-decoration: none; font-size: 16px; font-weight: 600; display: inline-block;">
                    Join Interview Room
                </a>
            </div>
        """ % {"url": interview_url}

    body_html = """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669, #10b981); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">%(company)s</h1>
            <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Interview Scheduled</p>
        </div>
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none;">
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">Hi %(name)s,</p>
            <p style="color: #334155; font-size: 16px; line-height: 1.6;">
                Great news! Your Round 2 interview for the <strong>%(job)s</strong> position has been scheduled.
            </p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                <p style="color: #166534; font-size: 14px; font-weight: 600; margin: 0 0 4px 0;">Scheduled Time</p>
                <p style="color: #15803d; font-size: 18px; font-weight: 700; margin: 0;">%(slot)s</p>
            </div>
            %(interview_url_html)s
            %(draft_html)s
            <p style="color: #64748b; font-size: 14px; line-height: 1.6;">
                A calendar invite is attached. Please confirm your attendance by replying to this email.
            </p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">
                This is an automated message from %(company)s's recruitment system.
            </p>
        </div>
    </div>
    """ % {
        "company": company_name, "name": candidate_name, "job": job_title,
        "slot": slot, "interview_url_html": interview_url_html, "draft_html": draft_html,
    }

    interview_text = "Join your interview room: %s\n\n" % interview_url if interview_url else ""
    body_text = (
        "Hi %s,\n\nYour Round 2 interview for the %s position has been scheduled.\n\n"
        "Scheduled Time: %s\n\n%s%s"
        "A calendar invite is attached.\n\nBest regards,\n%s Recruitment Team"
    ) % (candidate_name, job_title, slot, interview_text,
         ("%s\n\n" % email_draft if email_draft else ""), company_name)

    return send_email(to_email, subject, body_html, body_text, ics_attachment=ics_attachment)


def send_custom_email(
    to_email,        # type: str
    candidate_name,  # type: str
    subject,         # type: str
    body,            # type: str
    company_name="HireOps AI",  # type: str
):
    # type: (...) -> dict
    """Send a custom email (e.g., AI-generated follow-up draft)."""
    body_html = """
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-radius: 12px;">
            %s
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
            <p style="color: #94a3b8; font-size: 12px; text-align: center;">Sent via %s</p>
        </div>
    </div>
    """ % (body.replace(chr(10), '<br>'), company_name)

    return send_email(to_email, subject, body_html, body)
