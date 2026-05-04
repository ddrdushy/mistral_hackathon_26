"""
Q&A Interview Agent

Generates a 3-round written interview (aptitude → reasoning → technical) tailored
to the candidate's resume and the job, then scores answers per round.

All rounds are generated in a single LLM call when the candidate clicks "Start"
so the question set is atomic and cheap. Scoring is one LLM call per submitted
round.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, List

USE_MOCK = os.getenv("QA_INTERVIEW_MOCK", "false").lower() == "true"
MODEL = os.getenv("QA_INTERVIEW_MODEL", "mistral-large-latest")

ROUND_ORDER = ["aptitude", "reasoning", "technical"]
ROUND_WEIGHTS = {"aptitude": 0.25, "reasoning": 0.30, "technical": 0.45}
QUESTIONS_PER_ROUND = 3


@dataclass
class QaGenerateInput:
    candidate_name: str
    resume_text: str
    job_title: str
    job_description: str
    required_skills: List[str]
    seniority: str = "mid"


def _client():
    from mistralai import Mistral
    return Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))


def generate_question_set(input_data: QaGenerateInput) -> Dict[str, List[str]]:
    """Return {aptitude:[3], reasoning:[3], technical:[3]} tailored to candidate+job."""
    if USE_MOCK or not os.environ.get("MISTRAL_API_KEY"):
        return _mock_questions(input_data)

    try:
        from services.llm_tracker import LLMCallTimer

        prompt = f"""You are an expert technical interviewer designing a written first-round screening for ONE specific candidate. Generate a 3-round Q&A interview, with EXACTLY {QUESTIONS_PER_ROUND} questions per round.

CANDIDATE
- Name: {input_data.candidate_name}
- Resume:
{input_data.resume_text[:3000]}

JOB
- Title: {input_data.job_title}
- Seniority: {input_data.seniority}
- Required skills: {", ".join(input_data.required_skills) or "general"}
- Description:
{input_data.job_description[:1500]}

ROUND DESIGN
1. "aptitude" — {QUESTIONS_PER_ROUND} concise quantitative / pattern / basic logic questions. Role-relevant where possible (e.g., for a data role: simple stats interpretation; for an engineer: complexity intuition). Each answerable in 1–3 sentences.
2. "reasoning" — {QUESTIONS_PER_ROUND} situational/analytical scenarios that probe how the candidate thinks. Tie to the job's day-to-day work. Each answerable in 3–6 sentences.
3. "technical" — {QUESTIONS_PER_ROUND} questions GROUNDED IN THE CANDIDATE'S RESUME. Reference specific tools/projects/claims they made and probe depth. Avoid asking things their resume already answers; instead push one level deeper. If the resume is sparse, ask about the required skills for the job.

STRICT RULES
- Each question is unique and self-contained (no "see above").
- Do NOT include answers, hints, or commentary — questions only.
- Output ONLY valid JSON, no markdown fences.

OUTPUT SCHEMA
{{
  "aptitude": ["q1", "q2", "q3"],
  "reasoning": ["q1", "q2", "q3"],
  "technical": ["q1", "q2", "q3"]
}}"""

        with LLMCallTimer("qa_interview_generate", MODEL) as timer:
            response = _client().chat.complete(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.7,
            )
            usage = response.usage
            if usage:
                timer.input_tokens = usage.prompt_tokens
                timer.output_tokens = usage.completion_tokens

        result = json.loads(response.choices[0].message.content)
        # Validate shape
        for r in ROUND_ORDER:
            qs = result.get(r) or []
            if not isinstance(qs, list) or len(qs) < 1:
                raise ValueError(f"Round {r} missing questions")
            # Trim/pad to QUESTIONS_PER_ROUND
            result[r] = [str(q).strip() for q in qs[:QUESTIONS_PER_ROUND] if str(q).strip()]
            while len(result[r]) < QUESTIONS_PER_ROUND:
                result[r].append(f"Tell us more about your experience related to {input_data.job_title}.")
        return {r: result[r] for r in ROUND_ORDER}

    except Exception as e:
        print(f"[qa_interview] generate fallback: {e}")
        return _mock_questions(input_data)


@dataclass
class QaScoreInput:
    round: str
    questions: List[str]
    answers: List[str]
    job_title: str
    required_skills: List[str]
    resume_text: str


def score_round(input_data: QaScoreInput) -> Dict:
    """Score one round. Returns {score: 0-100, feedback: str, strengths: [..], gaps: [..]}.
    """
    if USE_MOCK or not os.environ.get("MISTRAL_API_KEY"):
        return _mock_score(input_data)

    try:
        from services.llm_tracker import LLMCallTimer

        qa_pairs = "\n\n".join(
            f"Q{i+1}: {q}\nA{i+1}: {a or '(no answer)'}"
            for i, (q, a) in enumerate(zip(input_data.questions, input_data.answers))
        )

        rubric = {
            "aptitude": "Score correctness of reasoning and clarity. Penalize hand-waving. 0–100.",
            "reasoning": "Score quality of thinking, structure, and role-relevance. Reward concrete examples. 0–100.",
            "technical": "Score technical depth, accuracy, and specificity to the candidate's claimed experience. Penalize vague answers. 0–100.",
        }.get(input_data.round, "Score 0–100.")

        prompt = f"""You are evaluating a candidate's written answers for the "{input_data.round}" round of a screening for the role of {input_data.job_title}.

REQUIRED SKILLS: {", ".join(input_data.required_skills) or "general"}

RUBRIC
{rubric}

CANDIDATE'S RESUME (for context — only relevant for technical round):
{input_data.resume_text[:1500]}

ANSWERS TO EVALUATE
{qa_pairs}

Return ONLY valid JSON:
{{
  "score": <0-100 integer>,
  "feedback": "<2-3 sentences summarising performance for HR>",
  "strengths": ["short bullet", ...],
  "gaps": ["short bullet", ...]
}}"""

        with LLMCallTimer(f"qa_interview_score_{input_data.round}", MODEL) as timer:
            response = _client().chat.complete(
                model=MODEL,
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
                temperature=0.2,
            )
            usage = response.usage
            if usage:
                timer.input_tokens = usage.prompt_tokens
                timer.output_tokens = usage.completion_tokens

        result = json.loads(response.choices[0].message.content)
        return {
            "score": float(result.get("score", 0)),
            "feedback": str(result.get("feedback", "")),
            "strengths": list(result.get("strengths", []))[:5],
            "gaps": list(result.get("gaps", []))[:5],
        }

    except Exception as e:
        print(f"[qa_interview] score fallback: {e}")
        return _mock_score(input_data)


def aggregate_final(scores: Dict[str, Dict]) -> Dict:
    """Combine per-round scores into a final 0-100 with summary."""
    weighted = 0.0
    total_weight = 0.0
    bullets = []
    for r in ROUND_ORDER:
        s = scores.get(r)
        if not s:
            continue
        w = ROUND_WEIGHTS[r]
        weighted += float(s.get("score", 0)) * w
        total_weight += w
        bullets.append(f"{r.title()}: {int(s.get('score', 0))}/100 — {s.get('feedback', '').strip()}")
    final = round(weighted / total_weight, 1) if total_weight > 0 else 0.0

    summary = (
        f"Q&A interview final score: {final}/100. " + " | ".join(bullets)
        if bullets else f"Q&A interview final score: {final}/100."
    )
    return {"final_score": final, "summary": summary}


# ─── Mock fallbacks ──────────────────────────────────────────────────────────

def _mock_questions(input_data: QaGenerateInput) -> Dict[str, List[str]]:
    skill = (input_data.required_skills or ["the role"])[0]
    return {
        "aptitude": [
            "If a process takes 12 minutes per item and you have 75 items, how many full work-hours of effort is that?",
            "A dashboard's daily active users grew from 1,200 to 1,650 in a month. What is the percentage increase, rounded to one decimal?",
            "Which is larger and by how much: 7/12 or 0.6?",
        ],
        "reasoning": [
            f"You inherit a {input_data.job_title} project that is two weeks behind. Walk through how you'd diagnose the cause and decide what to cut.",
            "A teammate insists on a solution you believe is wrong. You have 24 hours before commit. How do you handle it?",
            "Describe how you'd validate that a new feature you shipped is actually working in production.",
        ],
        "technical": [
            f"Your resume mentions experience with {skill}. Describe the trickiest bug or design issue you hit and exactly how you resolved it.",
            f"For a {input_data.job_title} role, walk through how you'd structure your first 30 days based on what you've done before.",
            "Pick one project from your resume and explain its architecture, the trade-offs you made, and what you'd do differently today.",
        ],
    }


def _mock_score(input_data: QaScoreInput) -> Dict:
    # Heuristic: score on answer length / non-emptiness
    total_chars = sum(len((a or "").strip()) for a in input_data.answers)
    answered = sum(1 for a in input_data.answers if (a or "").strip())
    base = (answered / max(1, len(input_data.questions))) * 60
    depth_bonus = min(30, total_chars / 25)
    score = round(min(95, base + depth_bonus), 1)
    return {
        "score": score,
        "feedback": f"Mock evaluation for {input_data.round} round. Answered {answered}/{len(input_data.questions)} questions.",
        "strengths": ["Provided answers to all questions"] if answered == len(input_data.questions) else [],
        "gaps": [f"Skipped {len(input_data.questions) - answered} question(s)"] if answered < len(input_data.questions) else [],
    }
