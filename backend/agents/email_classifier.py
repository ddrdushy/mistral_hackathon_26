"""
Email Classifier Agent
Mistral Agent ID: ag_019ca2d9a7a0773cb0104da31ed35b09

Purpose: Classify incoming emails as candidate applications vs general emails.

INPUT: subject, from_name, from_email, attachment_names, body_text
OUTPUT: JSON with category, confidence, reasoning, suggested_action, detected_name, detected_role
"""
import os
from typing import List
import json
from dataclasses import dataclass, asdict

USE_MOCK = os.getenv("EMAIL_CLASSIFIER_MOCK", "false").lower() == "true"
AGENT_ID = os.getenv("EMAIL_CLASSIFIER_AGENT_ID", "ag_019ca2d9a7a0773cb0104da31ed35b09")


@dataclass
class EmailClassifierInput:
    subject: str
    from_name: str
    from_email: str
    attachment_names: List[str]
    body_text: str


@dataclass
class EmailClassifierOutput:
    category: str          # "candidate_application" | "general" | "unknown"
    confidence: float      # 0.0 - 1.0
    reasoning: str
    suggested_action: str
    detected_name: str
    detected_role: str


async def classify_email(input_data: EmailClassifierInput) -> EmailClassifierOutput:
    if not USE_MOCK and AGENT_ID:
        try:
            from mistralai import Mistral
            from services.llm_tracker import LLMCallTimer

            client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

            content = (
                f"subject: {input_data.subject}\n"
                f"from_name: {input_data.from_name}\n"
                f"from_email: {input_data.from_email}\n"
                f"attachment_names: {json.dumps(input_data.attachment_names)}\n"
                f"body_text: {input_data.body_text}"
            )

            with LLMCallTimer("email_classifier", "agent") as timer:
                response = client.beta.conversations.start(
                    agent_id=AGENT_ID,
                    inputs=[{"role": "user", "content": content}],
                )
                timer.input_tokens = len(content.split()) * 2  # Approximate
                timer.output_tokens = len(response.outputs[0].content.split()) * 2

            # Parse JSON — handle potential markdown wrapping
            text = response.outputs[0].content.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            result = json.loads(text)

            # Map agent's response format to our expected schema
            # Agent may return email_type instead of category, candidate.name instead of detected_name, etc.
            mapped = {
                "category": result.get("category") or result.get("email_type", "unknown"),
                "confidence": result.get("confidence", 0.5),
                "reasoning": result.get("reasoning", ""),
                "suggested_action": result.get("suggested_action") or result.get("next_action", ""),
                "detected_name": result.get("detected_name", ""),
                "detected_role": result.get("detected_role", ""),
            }
            # Handle nested candidate/job_hint fields from agent
            if "candidate" in result and isinstance(result["candidate"], dict):
                mapped["detected_name"] = result["candidate"].get("name", "") or ""
            if "job_hint" in result and isinstance(result["job_hint"], dict):
                mapped["detected_role"] = result["job_hint"].get("title", "") or ""
            # Normalize category values
            cat = mapped["category"].lower()
            if cat in ("candidate_application", "application", "job_application"):
                mapped["category"] = "candidate_application"
            elif cat in ("general", "other", "spam", "newsletter", "ignore"):
                mapped["category"] = "general"
            else:
                mapped["category"] = "unknown"

            return EmailClassifierOutput(**mapped)
        except Exception as e:
            print(f"[email_classifier] Mistral agent error: {e}, falling back to mock")

    # ─── MOCK IMPLEMENTATION ───
    from services.llm_tracker import log_usage
    log_usage("email_classifier", "mock", input_tokens=0, output_tokens=0, latency_ms=5, status="success",
              metadata={"mode": "mock", "subject": input_data.subject[:50]})

    has_resume = any(
        name.lower().endswith(('.pdf', '.docx', '.doc'))
        for name in input_data.attachment_names
    )
    keywords = ['apply', 'application', 'resume', 'cv', 'position', 'role', 'job', 'opportunity', 'hiring']
    text = f"{input_data.subject} {input_data.body_text}".lower()
    keyword_hits = sum(1 for kw in keywords if kw in text)

    if has_resume or keyword_hits >= 2:
        name = input_data.from_name or input_data.from_email.split('@')[0].replace('.', ' ').title()
        return EmailClassifierOutput(
            category="candidate_application",
            confidence=0.92 if has_resume else 0.78,
            reasoning="Email contains resume attachment and application keywords" if has_resume
                      else "Email body contains multiple application-related keywords",
            suggested_action="Extract resume and create candidate profile",
            detected_name=name,
            detected_role="Software Engineer",
        )
    else:
        return EmailClassifierOutput(
            category="general",
            confidence=0.85,
            reasoning="No resume attachment or application keywords detected",
            suggested_action="Archive or ignore",
            detected_name="",
            detected_role="",
        )
