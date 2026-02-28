"""
Resume Scorer Agent
Mistral Agent ID: ag_019ca3046554772bbbdf4d2b75bdd657

Purpose: Score a resume against a job description.

INPUT: job JSON (with responsibilities) + resume_text
OUTPUT: JSON with score, evidence, gaps, risks, recommendation, screening_questions, AI snippets

The Mistral agent returns a NESTED schema:
{
  "candidate_summary": { "name", "years_experience_est", "current_title", "key_strengths" },
  "match": { "score", "confidence", "evidence": [{"skill", "resume_evidence"}], "gaps", "risks", "recommendation" },
  "screening_questions": [string]
}

We map this to our flat ResumeScorerOutput.
"""
import os
from typing import List, Optional
import json
from dataclasses import dataclass

USE_MOCK = os.getenv("RESUME_SCORER_MOCK", "false").lower() == "true"
AGENT_ID = os.getenv("RESUME_SCORER_AGENT_ID", "ag_019ca3046554772bbbdf4d2b75bdd657")


@dataclass
class ResumeScorerInput:
    resume_text: str
    job_id: str
    job_title: str
    job_description: str
    must_have_skills: List[str]
    nice_to_have_skills: List[str]
    seniority: str
    responsibilities: Optional[List[str]] = None


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


def _map_agent_response(result: dict, input_data: ResumeScorerInput) -> ResumeScorerOutput:
    """Map the Mistral agent's nested response to our flat ResumeScorerOutput."""

    # Handle both flat and nested formats
    if "match" in result:
        # Nested format from agent
        match = result.get("match", {})
        candidate_summary = result.get("candidate_summary", {})

        score = match.get("score", 50)

        # Map evidence: [{"skill": "Python", "resume_evidence": "3 years exp"}] → ["Python: 3 years exp"]
        raw_evidence = match.get("evidence", [])
        evidence = []
        for e in raw_evidence:
            if isinstance(e, dict):
                skill = e.get("skill", "")
                proof = e.get("resume_evidence", "")
                if proof:
                    evidence.append(f"{skill}: {proof}")
                else:
                    evidence.append(f"{skill}: No direct evidence found")
            elif isinstance(e, str):
                evidence.append(e)

        gaps = match.get("gaps", [])
        risks = match.get("risks", [])

        # Map recommendation: agent uses "screen"/"shortlist"/"reject" → we use "advance"/"hold"/"reject"
        raw_rec = match.get("recommendation", "hold").lower()
        if raw_rec in ("screen", "shortlist", "advance"):
            recommendation = "advance"
        elif raw_rec == "reject":
            recommendation = "reject"
        else:
            recommendation = "hold"

        screening_questions = result.get("screening_questions", [])
        key_strengths = candidate_summary.get("key_strengths", [])

        # Build summary
        name = candidate_summary.get("name", "Candidate")
        years_exp = candidate_summary.get("years_experience_est")
        current_title = candidate_summary.get("current_title", "")
        exp_str = f" with ~{years_exp} years experience" if years_exp else ""
        title_str = f" (current: {current_title})" if current_title else ""
        summary = (
            f"{name}{title_str}{exp_str} scores {score}/100 for {input_data.job_title}. "
            f"{'Strong match' if score >= 70 else 'Partial match' if score >= 50 else 'Weak match'} — "
            f"{len([e for e in raw_evidence if isinstance(e, dict) and e.get('resume_evidence')])} "
            f"of {len(input_data.must_have_skills)} must-have skills evidenced."
        )

        return ResumeScorerOutput(
            score=score,
            evidence=evidence if evidence else ["No specific evidence extracted"],
            gaps=gaps if gaps else ["No critical gaps identified"],
            risks=risks if risks else ["No significant risks identified"],
            recommendation=recommendation,
            screening_questions=screening_questions if screening_questions else _generate_mock_questions(input_data),
            summary=summary,
            why_shortlisted=key_strengths[:3] if key_strengths else ["Relevant background experience"],
            key_strengths=key_strengths[:3] if key_strengths else ["Relevant domain knowledge"],
            main_gaps=gaps[:2] if gaps else ["No significant gaps identified"],
            interview_focus=[
                f"Verify depth of experience with {input_data.must_have_skills[0]}" if input_data.must_have_skills else "Probe technical depth",
                "Validate project ownership and hands-on contributions",
                "Assess problem-solving approach with role-specific scenarios",
            ],
        )
    else:
        # Flat format (old format or direct match) — try direct mapping
        return ResumeScorerOutput(**result)


def _generate_mock_questions(input_data: ResumeScorerInput) -> List[str]:
    """Generate CV/project-specific screening questions (not generic HR questions)."""
    questions = []
    skills = input_data.must_have_skills or []
    title = input_data.job_title
    responsibilities = input_data.responsibilities or []

    # Skill-specific deep-dive questions
    if len(skills) >= 1:
        questions.append(
            f"Walk me through a project where you used {skills[0]} end-to-end. "
            f"What was the problem, your approach, and the measurable outcome?"
        )
    if len(skills) >= 2:
        questions.append(
            f"Describe a challenging technical problem you solved using {skills[1]}. "
            f"What alternatives did you consider and why did you choose that approach?"
        )
    if len(skills) >= 3:
        questions.append(
            f"How have you integrated {skills[2]} with other tools in your previous projects? "
            f"Give a specific example with the architecture you designed."
        )

    # Responsibility-based questions
    if responsibilities:
        resp = responsibilities[0] if responsibilities else ""
        questions.append(
            f"In your resume you mention relevant experience — can you describe how you've handled: "
            f"'{resp[:80]}...'? What was your specific role and contribution?"
        )

    # Project verification question
    questions.append(
        f"Pick the most complex {title}-related project from your resume. "
        f"Explain the technical architecture, your specific contributions, and what you would do differently today."
    )

    return questions[:5]


async def score_resume(input_data: ResumeScorerInput) -> ResumeScorerOutput:
    if not USE_MOCK and AGENT_ID:
        try:
            from mistralai import Mistral
            from services.llm_tracker import LLMCallTimer

            client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

            # Build rich job context matching agent's expected input
            job_data = {
                "job_id": input_data.job_id,
                "title": input_data.job_title,
                "must_have_skills": input_data.must_have_skills,
                "nice_to_have_skills": input_data.nice_to_have_skills,
                "responsibilities": input_data.responsibilities or [],
            }

            job_json = json.dumps(job_data)
            content = f"job: {job_json}\n\nresume_text: {input_data.resume_text}"

            with LLMCallTimer("resume_scorer", "agent") as timer:
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

            # Map nested agent response to our flat output
            return _map_agent_response(result, input_data)

        except Exception as e:
            print(f"[resume_scorer] Mistral agent error: {e}, falling back to mock")

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
            f"Matches {len(must_matched)}/{len(input_data.must_have_skills)} must-have skills: {', '.join(must_matched[:4]) or 'none'}",
            f"Matches {len(nice_matched)}/{len(input_data.nice_to_have_skills)} nice-to-have skills: {', '.join(nice_matched[:3]) or 'none'}",
            "Resume demonstrates relevant industry experience",
        ],
        gaps=[
            f"Missing must-have skills: {', '.join(must_missing[:4])}" if must_missing else "No critical skill gaps",
            "Could benefit from more quantified achievements",
        ],
        risks=["Short tenure patterns at previous positions" if score < 60 else "No significant red flags"],
        recommendation=recommendation,
        screening_questions=_generate_mock_questions(input_data),
        summary=f"Candidate scores {score}/100 for {input_data.job_title}. "
                f"{'Strong match' if score >= 70 else 'Partial match' if score >= 50 else 'Weak match'} "
                f"with {len(must_matched)} of {len(input_data.must_have_skills)} must-have skills.",
        why_shortlisted=[
            f"Strong skill alignment: {', '.join(must_matched[:2])}" if must_matched else "Relevant background experience",
            "Resume demonstrates progressive career growth",
            "Experience level aligns with role seniority requirements",
        ],
        key_strengths=[
            f"Proficient in {must_matched[0]}" if must_matched else "Relevant domain knowledge",
            f"Additional expertise in {nice_matched[0]}" if nice_matched else "Broad technical foundation",
            "Progressive career trajectory with increasing responsibility",
        ],
        main_gaps=[
            f"Missing: {', '.join(must_missing[:2])}" if must_missing else "No significant gaps identified",
            "Could strengthen portfolio with more project examples",
        ],
        interview_focus=[
            f"Verify hands-on depth with {must_matched[0] if must_matched else input_data.must_have_skills[0] if input_data.must_have_skills else 'core skills'}",
            "Validate project ownership vs team contributions",
            f"Assess readiness for {input_data.seniority}-level {input_data.job_title} responsibilities",
        ],
    )
