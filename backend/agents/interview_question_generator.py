"""AI-suggested interview questions per job (Feature 4).

Mistral chat (no Agent ID needed). Given job title + description +
required skills, returns N candidate interview questions with type,
weight, and expected keywords. Tenant-scoped LLM cost guard wraps the
caller, not this module.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from typing import List, Optional

logger = logging.getLogger("hireops.interview_question_generator")

USE_MOCK = os.getenv("INTERVIEW_QUESTION_GEN_MOCK", "false").lower() == "true"
MODEL = os.getenv("INTERVIEW_QUESTION_GEN_MODEL", "mistral-small-latest")

ALLOWED_TYPES = {"behavioural", "technical", "situational", "culture_fit", "custom"}


@dataclass
class GeneratedQuestion:
    question_text: str
    question_type: str
    weight: int = 3
    expected_keywords: List[str] = field(default_factory=list)
    expected_answer_summary: str = ""


_SYSTEM_PROMPT = """You are an interview-design assistant for a hiring team. \
Generate role-appropriate interview questions. Output ONLY valid JSON.

Schema:
{
  "questions": [
    {
      "question_text": "<= 280 chars, one question, no preamble, no numbering",
      "question_type": "behavioural | technical | situational | culture_fit",
      "weight": 1-5 integer (3=default importance, 5=must-cover),
      "expected_keywords": ["3-8 keywords/phrases a strong answer would mention"],
      "expected_answer_summary": "<= 300 chars; one-sentence sketch of what a 'good' answer covers"
    },
    ...
  ]
}

Rules:
- Tailor every question to the JOB TITLE, DESCRIPTION, and REQUIRED SKILLS provided.
- Diversify across the requested types unless the user picked a single type.
- Keep questions concrete and answerable in 2-3 minutes (interview pace).
- expected_keywords are short — concepts, tools, frameworks, behaviours.
"""


async def suggest_questions(
    *,
    job_title: str,
    job_description: str = "",
    required_skills: Optional[List[str]] = None,
    seniority: str = "",
    count: int = 5,
    types: Optional[List[str]] = None,
) -> List[GeneratedQuestion]:
    count = max(1, min(int(count or 5), 12))
    wanted_types = [t for t in (types or []) if t in ALLOWED_TYPES] or [
        "behavioural", "technical", "situational"
    ]

    if USE_MOCK or not os.getenv("MISTRAL_API_KEY"):
        return _mock(job_title, required_skills or [], wanted_types, count)

    try:
        from mistralai import Mistral
        from services.llm_tracker import LLMCallTimer

        client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])
        user_msg = (
            f"Job title: {job_title}\n"
            f"Seniority: {seniority or 'unspecified'}\n"
            f"Required skills: {', '.join(required_skills or []) or 'general'}\n"
            f"Description: {(job_description or '')[:1500]}\n\n"
            f"Generate exactly {count} questions across these types: "
            f"{', '.join(wanted_types)}. Return JSON only."
        )
        with LLMCallTimer("interview_question_generator", "chat") as timer:
            response = client.chat.complete(
                model=MODEL,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                response_format={"type": "json_object"},
                temperature=0.5,
                max_tokens=1500,
            )
            usage = getattr(response, "usage", None)
            if usage:
                timer.input_tokens = usage.prompt_tokens
                timer.output_tokens = usage.completion_tokens

        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        out: list[GeneratedQuestion] = []
        for q in (data.get("questions") or [])[:count]:
            if not isinstance(q, dict):
                continue
            text = str(q.get("question_text") or "").strip()
            if not text:
                continue
            qtype = str(q.get("question_type") or "behavioural").lower()
            if qtype not in ALLOWED_TYPES:
                qtype = "behavioural"
            try:
                weight = int(q.get("weight") or 3)
            except Exception:
                weight = 3
            weight = max(1, min(weight, 5))
            kw_raw = q.get("expected_keywords") or []
            keywords = [str(k).strip() for k in kw_raw if str(k).strip()][:8] \
                if isinstance(kw_raw, list) else []
            out.append(GeneratedQuestion(
                question_text=text[:1000],
                question_type=qtype,
                weight=weight,
                expected_keywords=keywords,
                expected_answer_summary=str(q.get("expected_answer_summary") or "").strip()[:600],
            ))
        return out
    except Exception as e:
        logger.warning("Mistral suggest failed, falling back: %s", e)
        return _mock(job_title, required_skills or [], wanted_types, count)


def _mock(
    job_title: str,
    skills: list[str],
    types: list[str],
    count: int,
) -> List[GeneratedQuestion]:
    bank = [
        ("behavioural", "Tell me about a time you disagreed with a teammate on technical direction. How did you handle it?", ["disagreement", "conflict resolution", "teamwork", "outcome"]),
        ("behavioural", "Describe a situation where you missed a deadline. What did you learn?", ["accountability", "retrospective", "process change"]),
        ("technical", f"Walk me through how you'd design a system for the most complex problem you've solved related to {job_title.lower()}.", ["architecture", "trade-offs", "scaling", "reliability"]),
        ("technical", f"What's the trickiest bug you've debugged using {(skills[0] if skills else 'your primary stack')}? How did you find the root cause?", ["debugging", "root cause", "tooling", "validation"]),
        ("situational", "If you joined a team where the codebase had no tests and shipping was painful, how would you spend your first 30 days?", ["testing", "ramp up", "incremental", "stakeholders"]),
        ("situational", "Your manager asks you to ship a feature you think is the wrong call for users. What do you do?", ["disagree and commit", "data", "stakeholder", "user impact"]),
        ("culture_fit", "What kind of work environment helps you do your best engineering?", ["autonomy", "feedback", "psychological safety"]),
    ]
    out: list[GeneratedQuestion] = []
    for t, q, kw in bank:
        if t in types and len(out) < count:
            out.append(GeneratedQuestion(
                question_text=q, question_type=t, weight=3,
                expected_keywords=kw,
            ))
    while len(out) < count and bank:
        t, q, kw = bank[len(out) % len(bank)]
        out.append(GeneratedQuestion(
            question_text=q, question_type=t, weight=3,
            expected_keywords=kw,
        ))
    return out[:count]
