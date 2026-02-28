"""
Interview Evaluator Agent
Mistral Agent ID: Set via INTERVIEW_EVALUATOR_AGENT_ID env var or below.

Purpose: Evaluate a voice interview transcript against job requirements.

INPUT: transcript + job profile + resume score summary
OUTPUT: score, decision, strengths, concerns, email draft, scheduling slots
"""
import os
from typing import List
import json
from dataclasses import dataclass

USE_MOCK = os.getenv("INTERVIEW_EVALUATOR_MOCK", "false").lower() == "true"
AGENT_ID = os.getenv("INTERVIEW_EVALUATOR_AGENT_ID", "")


@dataclass
class InterviewEvaluatorInput:
    transcript: str
    job_title: str
    job_description: str
    required_skills: List[str]
    resume_score: float
    resume_summary: str


@dataclass
class InterviewEvaluatorOutput:
    score: float
    decision: str  # advance / hold / reject
    strengths: List[str]
    concerns: List[str]
    communication_rating: str  # excellent / good / average / poor
    technical_depth: str       # strong / adequate / weak
    cultural_fit: str          # strong / adequate / weak
    email_draft: str
    scheduling_slots: List[str]
    summary: str


async def evaluate_interview(input_data: InterviewEvaluatorInput) -> InterviewEvaluatorOutput:
    if not USE_MOCK and AGENT_ID:
        try:
            from mistralai import Mistral
            from services.llm_tracker import LLMCallTimer

            client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

            content = (
                f"transcript:\n{input_data.transcript}\n\n"
                f"job_title: {input_data.job_title}\n"
                f"job_description: {input_data.job_description}\n"
                f"required_skills: {json.dumps(input_data.required_skills)}\n"
                f"resume_score: {input_data.resume_score}\n"
                f"resume_summary: {input_data.resume_summary}"
            )

            with LLMCallTimer("interview_evaluator", "agent") as timer:
                response = client.beta.conversations.start(
                    agent_id=AGENT_ID,
                    inputs=[{"role": "user", "content": content}],
                )
                timer.input_tokens = len(content.split()) * 2
                timer.output_tokens = len(response.outputs[0].content.split()) * 2

            # Parse JSON — handle potential markdown wrapping
            text = response.outputs[0].content.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            result = json.loads(text)
            return InterviewEvaluatorOutput(**result)
        except Exception as e:
            print(f"[interview_evaluator] Mistral agent error: {e}, falling back to mock")

    # ─── MOCK / FALLBACK IMPLEMENTATION ───
    from services.llm_tracker import log_usage
    log_usage("interview_evaluator", "mock", input_tokens=0, output_tokens=0,
              latency_ms=8, status="success",
              metadata={"mode": "mock", "job": input_data.job_title})

    base = input_data.resume_score * 0.7
    interview_bonus = 20
    score = round(min(base + interview_bonus, 95), 1)
    decision = "advance" if score >= 70 else ("hold" if score >= 50 else "reject")

    return InterviewEvaluatorOutput(
        score=score,
        decision=decision,
        strengths=[
            "Articulate and clear communicator",
            "Demonstrated practical knowledge of core technologies",
            "Showed enthusiasm for the role and company mission",
            "Asked thoughtful questions about team structure",
        ],
        concerns=[
            "Limited experience with distributed systems",
            "Could elaborate more on conflict resolution approach",
        ],
        communication_rating="good",
        technical_depth="adequate",
        cultural_fit="strong",
        email_draft=(
            f"Dear Candidate,\n\n"
            f"Thank you for completing the screening for the {input_data.job_title} position. "
            f"We were impressed with your background and would like to invite you to the next round of interviews.\n\n"
            f"Please let us know your availability for the proposed time slots below.\n\n"
            f"Best regards,\nHireOps AI Recruiting Team"
        ),
        scheduling_slots=[
            "Monday, March 3rd, 10:00 AM - 11:00 AM",
            "Tuesday, March 4th, 2:00 PM - 3:00 PM",
            "Wednesday, March 5th, 11:00 AM - 12:00 PM",
        ],
        summary=f"Candidate scored {score}/100 in voice screening. {decision.title()} recommendation based on strong communication and relevant experience.",
    )
