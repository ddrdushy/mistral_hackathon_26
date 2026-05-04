"""
Q&A Interview Agent (hybrid: MCQ + free-form)

- Aptitude  → 3 multiple-choice questions (4 options each, single correct)
- Reasoning → 3 multiple-choice questions (4 options each, single correct)
- Technical → 3 free-form questions grounded in the candidate's CV

Question generation: ONE Mistral call up-front produces all 9 questions.
Scoring: MCQ rounds are scored deterministically (correct_count / total).
         Technical round is scored via Mistral.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Dict, List, Any

USE_MOCK = os.getenv("QA_INTERVIEW_MOCK", "false").lower() == "true"
MODEL = os.getenv("QA_INTERVIEW_MODEL", "mistral-large-latest")

ROUND_ORDER = ["aptitude", "reasoning", "technical"]
MCQ_ROUNDS = {"aptitude", "reasoning"}
FREE_FORM_ROUNDS = {"technical"}
ROUND_WEIGHTS = {"aptitude": 0.25, "reasoning": 0.30, "technical": 0.45}
QUESTIONS_PER_ROUND = 3
OPTIONS_PER_MCQ = 4


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


def generate_question_set(input_data: QaGenerateInput) -> Dict[str, List[Dict[str, Any]]]:
    """Return question set across the 3 rounds.

    Shape:
      {
        "aptitude":  [{text, options:[4 strings], correct_index:int}, ...],
        "reasoning": [{text, options:[4 strings], correct_index:int}, ...],
        "technical": [{text}, ...]
      }
    """
    if USE_MOCK or not os.environ.get("MISTRAL_API_KEY"):
        return _mock_questions(input_data)

    try:
        from services.llm_tracker import LLMCallTimer

        prompt = f"""You are an expert technical interviewer designing a written first-round screening for ONE specific candidate. Generate a 3-round Q&A interview, EXACTLY {QUESTIONS_PER_ROUND} questions per round.

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
1. "aptitude" — {QUESTIONS_PER_ROUND} MULTIPLE CHOICE questions on quantitative reasoning, pattern recognition, and basic logic. Role-relevant where it makes sense. Each question MUST have exactly {OPTIONS_PER_MCQ} options and EXACTLY one correct answer.
2. "reasoning" — {QUESTIONS_PER_ROUND} MULTIPLE CHOICE situational/analytical questions with realistic role-relevant scenarios. Plausible distractors that test judgment, not just recall. Each question MUST have exactly {OPTIONS_PER_MCQ} options and EXACTLY one correct answer.
3. "technical" — {QUESTIONS_PER_ROUND} FREE-FORM questions grounded in the CANDIDATE'S RESUME. Reference specific tools/projects/claims they made and probe one level deeper. If the resume is sparse, ask about the required job skills. Free-form, no options.

STRICT RULES
- Each question is unique and self-contained.
- For MCQ: options should be plausible — no obviously wrong distractors. correct_index is 0-based.
- For free-form: questions only, no answers/hints.
- Output ONLY valid JSON, no markdown fences.

OUTPUT SCHEMA
{{
  "aptitude": [
    {{ "text": "...", "options": ["...","...","...","..."], "correct_index": 0 }},
    ... 3 total
  ],
  "reasoning": [
    {{ "text": "...", "options": ["...","...","...","..."], "correct_index": 0 }},
    ... 3 total
  ],
  "technical": [
    {{ "text": "..." }},
    ... 3 total
  ]
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
        return _validate_and_normalise(result, input_data)

    except Exception as e:
        print(f"[qa_interview] generate fallback: {e}")
        return _mock_questions(input_data)


def _validate_and_normalise(
    result: dict, input_data: QaGenerateInput
) -> Dict[str, List[Dict[str, Any]]]:
    """Coerce LLM output into the strict schema. Pad short rounds with mocks."""
    mock = _mock_questions(input_data)
    out: Dict[str, List[Dict[str, Any]]] = {}

    for r in ROUND_ORDER:
        items = result.get(r) or []
        normalised: List[Dict[str, Any]] = []
        for q in items[:QUESTIONS_PER_ROUND]:
            if not isinstance(q, dict):
                continue
            text = str(q.get("text") or q.get("question") or "").strip()
            if not text:
                continue
            if r in MCQ_ROUNDS:
                opts_raw = q.get("options") or []
                if not isinstance(opts_raw, list):
                    continue
                options = [str(o).strip() for o in opts_raw if str(o).strip()][:OPTIONS_PER_MCQ]
                while len(options) < OPTIONS_PER_MCQ:
                    options.append("(no option)")
                ci = q.get("correct_index")
                try:
                    ci = int(ci)
                except (TypeError, ValueError):
                    ci = 0
                if not (0 <= ci < OPTIONS_PER_MCQ):
                    ci = 0
                normalised.append({"text": text, "options": options, "correct_index": ci})
            else:
                normalised.append({"text": text})
        # Pad short rounds with mock questions
        while len(normalised) < QUESTIONS_PER_ROUND:
            normalised.append(mock[r][len(normalised)])
        out[r] = normalised

    return out


@dataclass
class QaScoreInput:
    round: str
    questions: List[Dict[str, Any]]
    answers: List[str]
    job_title: str
    required_skills: List[str]
    resume_text: str


def score_round(input_data: QaScoreInput) -> Dict:
    """Score one round.

    MCQ rounds: deterministic correct/total; no LLM call.
    Free-form rounds: Mistral evaluator.
    """
    if input_data.round in MCQ_ROUNDS:
        return _score_mcq(input_data)
    return _score_free_form(input_data)


def _score_mcq(input_data: QaScoreInput) -> Dict:
    total = len(input_data.questions)
    correct = 0
    breakdown = []
    for q, a in zip(input_data.questions, input_data.answers):
        ci = int(q.get("correct_index") or 0)
        try:
            chosen = int(str(a).strip()) if str(a).strip() != "" else -1
        except ValueError:
            chosen = -1
        is_correct = chosen == ci
        if is_correct:
            correct += 1
        breakdown.append({
            "question": q.get("text"),
            "chosen_index": chosen,
            "correct_index": ci,
            "correct": is_correct,
        })
    score = round((correct / total * 100) if total else 0.0, 1)
    feedback = (
        f"Answered {correct}/{total} correctly."
    )
    strengths = [f"{correct}/{total} correct on {input_data.round}"] if correct else []
    gaps = [f"Missed {total - correct}/{total} questions"] if (total - correct) > 0 else []
    return {
        "score": score,
        "feedback": feedback,
        "strengths": strengths,
        "gaps": gaps,
        "breakdown": breakdown,
    }


def _score_free_form(input_data: QaScoreInput) -> Dict:
    if USE_MOCK or not os.environ.get("MISTRAL_API_KEY"):
        return _mock_score_free_form(input_data)

    try:
        from services.llm_tracker import LLMCallTimer

        question_texts = [q.get("text", "") for q in input_data.questions]
        qa_pairs = "\n\n".join(
            f"Q{i+1}: {q}\nA{i+1}: {a or '(no answer)'}"
            for i, (q, a) in enumerate(zip(question_texts, input_data.answers))
        )

        prompt = f"""You are evaluating a candidate's written answers for the "technical" round of a screening for the role of {input_data.job_title}.

REQUIRED SKILLS: {", ".join(input_data.required_skills) or "general"}

RUBRIC
Score technical depth, accuracy, and specificity to the candidate's claimed experience. Penalize vague answers. 0-100.

CANDIDATE'S RESUME (for context):
{input_data.resume_text[:1500]}

ANSWERS TO EVALUATE
{qa_pairs}

Return ONLY valid JSON:
{{
  "score": <0-100 integer>,
  "feedback": "<2-3 sentences for HR>",
  "strengths": ["short bullet", ...],
  "gaps": ["short bullet", ...]
}}"""

        with LLMCallTimer("qa_interview_score_technical", MODEL) as timer:
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
        print(f"[qa_interview] score_free_form fallback: {e}")
        return _mock_score_free_form(input_data)


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

def _mock_questions(input_data: QaGenerateInput) -> Dict[str, List[Dict[str, Any]]]:
    skill = (input_data.required_skills or ["the role"])[0]
    return {
        "aptitude": [
            {
                "text": "If a process takes 12 minutes per item and you have 75 items, how many full work-hours of effort is that?",
                "options": ["12 hours", "15 hours", "18 hours", "20 hours"],
                "correct_index": 1,
            },
            {
                "text": "A dashboard's daily active users grew from 1,200 to 1,650 in a month. What is the percentage increase, rounded to one decimal?",
                "options": ["27.3%", "37.5%", "45.0%", "55.0%"],
                "correct_index": 1,
            },
            {
                "text": "Which is larger: 7/12 or 0.6?",
                "options": ["7/12", "0.6", "They're equal", "Cannot be determined"],
                "correct_index": 1,
            },
        ],
        "reasoning": [
            {
                "text": f"You inherit a {input_data.job_title} project that is two weeks behind. What's the FIRST thing you should do?",
                "options": [
                    "Push the team to work overtime to catch up",
                    "Diagnose the root cause of the delay before deciding what to cut",
                    "Tell stakeholders the deadline will slip",
                    "Add more engineers to the project",
                ],
                "correct_index": 1,
            },
            {
                "text": "A teammate insists on a solution you believe is wrong, with 24 hours before commit. The most professional response is:",
                "options": [
                    "Override their choice — you're more senior",
                    "Let them ship it; you can fix it later",
                    "Ask for their reasoning, share your concerns with concrete examples, escalate if needed",
                    "Stay quiet to keep the peace",
                ],
                "correct_index": 2,
            },
            {
                "text": "How would you BEST validate that a new feature is actually working in production?",
                "options": [
                    "Check that the deploy succeeded",
                    "Ask users informally if they like it",
                    "Define metrics tied to the feature's goal and monitor them post-launch",
                    "Wait for support tickets",
                ],
                "correct_index": 2,
            },
        ],
        "technical": [
            {"text": f"Your resume mentions experience with {skill}. Describe the trickiest bug or design issue you hit and exactly how you resolved it."},
            {"text": f"For a {input_data.job_title} role, walk through how you'd structure your first 30 days based on what you've done before."},
            {"text": "Pick one project from your resume and explain its architecture, the trade-offs you made, and what you'd do differently today."},
        ],
    }


def _mock_score_free_form(input_data: QaScoreInput) -> Dict:
    total_chars = sum(len((a or "").strip()) for a in input_data.answers)
    answered = sum(1 for a in input_data.answers if (a or "").strip())
    base = (answered / max(1, len(input_data.questions))) * 60
    depth_bonus = min(30, total_chars / 25)
    score = round(min(95, base + depth_bonus), 1)
    return {
        "score": score,
        "feedback": f"Mock evaluation for technical round. Answered {answered}/{len(input_data.questions)} questions.",
        "strengths": ["Provided answers"] if answered == len(input_data.questions) else [],
        "gaps": [f"Skipped {len(input_data.questions) - answered} question(s)"] if answered < len(input_data.questions) else [],
    }
