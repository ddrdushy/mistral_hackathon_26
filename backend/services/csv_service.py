"""CSV export service."""
import csv
import io
from typing import List


def generate_applications_csv(applications: List[dict]) -> str:
    """Generate CSV string from application data."""
    output = io.StringIO()
    fieldnames = [
        "Candidate Name", "Email", "Phone", "Job Code", "Job Title",
        "Stage", "Resume Score", "Interview Score", "Recommendation",
        "Next Action", "Last Updated"
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()

    for app in applications:
        writer.writerow({
            "Candidate Name": app.get("candidate_name", ""),
            "Email": app.get("candidate_email", ""),
            "Phone": app.get("candidate_phone", ""),
            "Job Code": app.get("job_code", ""),
            "Job Title": app.get("job_title", ""),
            "Stage": app.get("stage", ""),
            "Resume Score": app.get("resume_score", ""),
            "Interview Score": app.get("interview_score", ""),
            "Recommendation": app.get("recommendation", ""),
            "Next Action": app.get("ai_next_action", ""),
            "Last Updated": app.get("updated_at", ""),
        })

    return output.getvalue()
