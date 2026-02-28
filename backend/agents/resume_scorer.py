"""
Resume Scorer Agent
Mistral Agent ID: ag_019ca3046554772bbbdf4d2b75bdd657

Purpose: Score a resume against a job description.

INPUT: job JSON + resume_text (as structured text)
OUTPUT: JSON with score, evidence, gaps, risks, recommendation, screening_questions, AI snippets
"""
import os
from typing import List
import json
from dataclasses import dataclass

USE_MOCK = True
AGENT_ID = "ag_019ca3046554772bbbdf4d2b75bdd657"


@dataclass
class ResumeScorerInput:
    resume_text: str
    job_id: str
    job_title: str
    job_description: str
    must_have_skills: List[str]
    nice_to_have_skills: List[str]
    seniority: str


@dataclass
class ResumeScorerOutput:
    score: float
    evidence: List[str]
    gaps: List[str]
    risks: List[str]
    recommendation: str  # advance / hold / reject
    screening_questions: List[str]
    summary: str
    why_shortlisted: List[str]
    key_strengths: List[str]
    main_gaps: List[str]
    interview_focus: List[str]


async def score_resume(input_data: ResumeScorerInput) -> ResumeScorerOutput:
    if not USE_MOCK:
        from mistralai import Mistral
        from services.llm_tracker import LLMCallTimer

        client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

        job_json = json.dumps({
            "job_id": input_data.job_id,
            "title": input_data.job_title,
            "must_have_skills": input_data.must_have_skills,
            "nice_to_have_skills": input_data.nice_to_have_skills,
        })

        content = f"job: {job_json}\n\nresume_text: {input_data.resume_text}"

        with LLMCallTimer("resume_scorer", "agent") as timer:
            response = client.beta.conversations.start(
                agent_id=AGENT_ID,
                inputs=[{"role": "user", "content": content}],
            )
            timer.input_tokens = len(content.split()) * 2
            timer.output_tokens = len(response.outputs.text.split()) * 2

        result = json.loads(response.outputs.text)
        return ResumeScorerOutput(**result)

    # ─── MOCK IMPLEMENTATION ───
    from services.llm_tracker import log_usage
    log_usage("resume_scorer", "mock", input_tokens=0, output_tokens=0, latency_ms=8, status="success",
              metadata={"mode": "mock", "job": input_data.job_title})
    resume_lower = input_data.resume_text.lower()
    must_matched = [s for s in input_data.must_have_skills if s.lower() in resume_lower]
    nice_matched = [s for s in input_data.nice_to_have_skills if s.lower() in resume_lower]
    must_ratio = len(must_matched) / max(len(input_data.must_have_skills), 1)
    nice_ratio = len(nice_matched) / max(len(input_data.nice_to_have_skills), 1)
    score = round(40 + (must_ratio * 40) + (nice_ratio * 15) + 5, 1)
    score = min(score, 98)

    must_missing = [s for s in input_data.must_have_skills if s.lower() not in resume_lower]
    recommendation = "advance" if score >= 70 else ("hold" if score >= 50 else "reject")

    return ResumeScorerOutput(
        score=score,
        evidence=[
            f"Matches {len(must_matched)}/{len(input_data.must_have_skills)} must-have skills: {', '.join(must_matched[:3]) or 'none'}",
            f"Matches {len(nice_matched)}/{len(input_data.nice_to_have_skills)} nice-to-have skills: {', '.join(nice_matched[:3]) or 'none'}",
            "Resume demonstrates relevant industry experience",
        ],
        gaps=[
            f"Missing must-have skills: {', '.join(must_missing[:3])}" if must_missing else "No critical skill gaps",
            "Could benefit from more quantified achievements",
        ],
        risks=["Short tenure patterns at previous positions" if score < 60 else "No significant red flags"],
        recommendation=recommendation,
        screening_questions=[
            f"Tell me about your experience with {must_matched[0] if must_matched else input_data.must_have_skills[0] if input_data.must_have_skills else 'your core skills'}",
            f"Why are you interested in the {input_data.job_title} role?",
            "Describe a challenging project you led recently",
            "How do you handle tight deadlines and competing priorities?",
            "Where do you see yourself in 2 years?",
        ],
        summary=f"Candidate scores {score}/100 for {input_data.job_title}. "
                f"{'Strong match' if score >= 70 else 'Partial match' if score >= 50 else 'Weak match'} "
                f"with {len(must_matched)} of {len(input_data.must_have_skills)} must-have skills.",
        why_shortlisted=[
            f"Strong skill alignment: {', '.join(must_matched[:2])}" if must_matched else "Relevant background experience",
            "Resume demonstrates progressive career growth",
            "Experience level matches role seniority requirements",
        ],
        key_strengths=[
            f"Proficient in {must_matched[0]}" if must_matched else "Relevant domain knowledge",
            "Clear and professional resume presentation",
            "Progressive career trajectory with increasing responsibility",
        ],
        main_gaps=[
            f"Missing: {', '.join(must_missing[:2])}" if must_missing else "No significant gaps identified",
            "Could strengthen portfolio with more project examples",
        ],
        interview_focus=[
            "Probe depth of technical skills in core areas",
            "Assess cultural fit and teamwork approach",
            "Evaluate problem-solving methodology with real scenarios",
        ],
    )
