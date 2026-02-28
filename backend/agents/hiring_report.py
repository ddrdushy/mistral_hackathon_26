"""
Hiring Report Generator
Generates a comprehensive autonomous hiring report using Mistral.

Purpose: Produce a detailed, structured report that explains everything
the platform did on behalf of HR and gives a clear hire/don't-hire recommendation.

INPUT: All application data (resume score, interview score, snippets, transcript summary)
OUTPUT: Structured JSON report with sections for timeline, analysis, and recommendation.
"""
import os
from typing import List, Optional
import json
from dataclasses import dataclass, asdict

USE_MOCK = os.getenv("HIRING_REPORT_MOCK", "true").lower() == "true"


@dataclass
class HiringReportInput:
    candidate_name: str
    candidate_email: str
    job_title: str
    job_code: str
    resume_score: float
    interview_score: Optional[float]
    final_score: Optional[float]
    recommendation: str  # advance / hold / reject
    resume_evidence: List[str]
    resume_gaps: List[str]
    resume_risks: List[str]
    resume_summary: str
    key_strengths: List[str]
    main_gaps: List[str]
    why_shortlisted: List[str]
    interview_strengths: List[str]
    interview_concerns: List[str]
    communication_rating: str
    technical_depth: str
    cultural_fit: str
    interview_summary: str
    final_summary: str
    thresholds: dict  # resume_min, interview_min, reject_below


@dataclass
class HiringReportOutput:
    executive_summary: str
    hire_recommendation: str  # "Strong Hire" / "Hire" / "Lean Hire" / "No Hire" / "Strong No Hire"
    confidence_pct: int  # 0-100
    pipeline_actions: List[dict]  # [{action, detail, result}]
    strengths_analysis: List[str]
    risk_analysis: List[str]
    verdict_reasoning: str
    suggested_next_steps: List[str]


async def generate_hiring_report(inp: HiringReportInput) -> HiringReportOutput:
    if not USE_MOCK:
        try:
            from mistralai import Mistral
            client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

            prompt = f"""You are an autonomous AI hiring platform. Generate a comprehensive hiring report.

CANDIDATE: {inp.candidate_name} ({inp.candidate_email})
JOB: {inp.job_title} ({inp.job_code})

RESUME ANALYSIS (Score: {inp.resume_score}/100):
- Evidence: {json.dumps(inp.resume_evidence)}
- Gaps: {json.dumps(inp.resume_gaps)}
- Risks: {json.dumps(inp.resume_risks)}
- Summary: {inp.resume_summary}

INTERVIEW ANALYSIS (Score: {inp.interview_score}/100):
- Strengths: {json.dumps(inp.interview_strengths)}
- Concerns: {json.dumps(inp.interview_concerns)}
- Communication: {inp.communication_rating}
- Technical Depth: {inp.technical_depth}
- Cultural Fit: {inp.cultural_fit}
- Summary: {inp.interview_summary}

FINAL SCORE: {inp.final_score}/100
CURRENT RECOMMENDATION: {inp.recommendation}
THRESHOLDS: Resume min={inp.thresholds.get('resume_min', 80)}, Interview min={inp.thresholds.get('interview_min', 75)}, Reject below={inp.thresholds.get('reject_below', 50)}

Return a JSON object with these fields:
- executive_summary: 2-3 sentence overview of the candidate
- hire_recommendation: one of "Strong Hire", "Hire", "Lean Hire", "No Hire", "Strong No Hire"
- confidence_pct: 0-100 confidence in the recommendation
- strengths_analysis: array of 3-5 key strengths with brief explanations
- risk_analysis: array of 2-4 risks or concerns
- verdict_reasoning: 2-3 sentences explaining the final verdict
- suggested_next_steps: array of 2-3 actionable next steps for HR

Return ONLY valid JSON, no markdown."""

            response = client.chat.complete(
                model="mistral-medium-latest",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=800,
            )

            text = response.choices[0].message.content.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

            result = json.loads(text)

            return HiringReportOutput(
                executive_summary=result.get("executive_summary", ""),
                hire_recommendation=result.get("hire_recommendation", "No Hire"),
                confidence_pct=result.get("confidence_pct", 50),
                pipeline_actions=_build_pipeline_actions(inp),
                strengths_analysis=result.get("strengths_analysis", []),
                risk_analysis=result.get("risk_analysis", []),
                verdict_reasoning=result.get("verdict_reasoning", ""),
                suggested_next_steps=result.get("suggested_next_steps", []),
            )
        except Exception as e:
            print(f"[hiring_report] Mistral error: {e}, falling back to mock")

    # ─── MOCK / FALLBACK ───
    return _generate_mock_report(inp)


def _build_pipeline_actions(inp: HiringReportInput) -> List[dict]:
    """Build the timeline of autonomous actions taken."""
    actions = [
        {
            "action": "Email Received & Classified",
            "detail": f"Received application email from {inp.candidate_email}",
            "result": "Classified as candidate application with resume attachment",
        },
        {
            "action": "Resume Extracted & Parsed",
            "detail": "Extracted PDF resume, parsed text content using AI",
            "result": f"Successfully extracted resume for {inp.candidate_name}",
        },
        {
            "action": "Candidate Profile Created",
            "detail": f"Auto-created candidate profile and matched to {inp.job_title}",
            "result": f"Matched to job {inp.job_code}",
        },
        {
            "action": "AI Resume Screening",
            "detail": "Scored resume against job requirements using Mistral AI agent",
            "result": f"Resume score: {inp.resume_score}/100 — {'Passed' if inp.resume_score >= inp.thresholds.get('resume_min', 80) else 'Below threshold'}",
        },
    ]

    if inp.interview_score is not None:
        actions.append({
            "action": "AI Voice Interview Conducted",
            "detail": "Conducted autonomous voice screening via ElevenLabs AI interviewer",
            "result": f"Interview score: {inp.interview_score}/100 — Communication: {inp.communication_rating}, Technical: {inp.technical_depth}",
        })
        actions.append({
            "action": "Interview Evaluated",
            "detail": "Transcript analyzed by Mistral AI evaluator agent",
            "result": f"Decision: {inp.recommendation.upper()} — Cultural fit: {inp.cultural_fit}",
        })

    if inp.final_score is not None:
        actions.append({
            "action": "Final Assessment Computed",
            "detail": "Combined resume (40%) + interview (60%) scores with threshold analysis",
            "result": f"Final score: {inp.final_score}/100 — Recommendation: {inp.recommendation.upper()}",
        })

    return actions


def _generate_mock_report(inp: HiringReportInput) -> HiringReportOutput:
    """Generate a report from available data without calling Mistral."""
    score = inp.final_score or inp.resume_score
    rec = inp.recommendation

    # Determine hire recommendation
    if rec == "advance" and score >= 80:
        hire_rec = "Strong Hire"
        confidence = 90
    elif rec == "advance":
        hire_rec = "Hire"
        confidence = 80
    elif rec == "hold" and score >= 60:
        hire_rec = "Lean Hire"
        confidence = 55
    elif rec == "hold":
        hire_rec = "No Hire"
        confidence = 45
    elif rec == "reject" and score < 40:
        hire_rec = "Strong No Hire"
        confidence = 85
    else:
        hire_rec = "No Hire"
        confidence = 70

    # Build executive summary
    interview_part = ""
    if inp.interview_score is not None:
        interview_part = (
            f" The AI-conducted voice interview scored {inp.interview_score}/100 "
            f"with {inp.communication_rating} communication and {inp.technical_depth} technical depth."
        )

    executive_summary = (
        f"{inp.candidate_name} applied for the {inp.job_title} position and was autonomously evaluated "
        f"through our AI pipeline. Resume analysis scored {inp.resume_score}/100, identifying strong alignment "
        f"with required skills.{interview_part} "
        f"Overall recommendation: {hire_rec} (confidence: {confidence}%)."
    )

    # Strengths
    strengths = []
    for s in (inp.key_strengths or [])[:3]:
        strengths.append(s)
    for s in (inp.interview_strengths or [])[:2]:
        strengths.append(s)
    if not strengths:
        strengths = [f"Resume score of {inp.resume_score}/100 indicates strong qualification match"]

    # Risks
    risks = []
    for g in (inp.main_gaps or [])[:2]:
        risks.append(g)
    for c in (inp.interview_concerns or [])[:2]:
        risks.append(c)
    if not risks:
        risks = ["No significant risks identified"]

    # Verdict reasoning
    threshold_status = []
    if inp.resume_score >= inp.thresholds.get("resume_min", 80):
        threshold_status.append("resume threshold met")
    else:
        threshold_status.append(f"resume below {inp.thresholds.get('resume_min', 80)}% threshold")
    if inp.interview_score is not None:
        if inp.interview_score >= inp.thresholds.get("interview_min", 75):
            threshold_status.append("interview threshold met")
        else:
            threshold_status.append(f"interview below {inp.thresholds.get('interview_min', 75)}% threshold")

    verdict = (
        f"Based on comprehensive AI analysis, {inp.candidate_name} scores {score}/100 overall "
        f"({', '.join(threshold_status)}). "
        f"The platform autonomously processed the application from email receipt through "
        f"{'voice interview and evaluation' if inp.interview_score else 'resume scoring'}. "
        f"Recommendation: {hire_rec}."
    )

    # Next steps
    if hire_rec in ("Strong Hire", "Hire"):
        next_steps = [
            "Schedule in-person/final round interview with hiring manager",
            "Prepare offer letter with competitive compensation package",
            "Conduct reference checks",
        ]
    elif hire_rec == "Lean Hire":
        next_steps = [
            "HR review recommended — candidate shows potential but has gaps",
            "Consider a technical assessment to validate specific skills",
            "Schedule follow-up interview focusing on identified concerns",
        ]
    else:
        next_steps = [
            "Send professional rejection email with feedback",
            "Keep candidate in talent pool for future relevant positions",
            "No further action required at this time",
        ]

    return HiringReportOutput(
        executive_summary=executive_summary,
        hire_recommendation=hire_rec,
        confidence_pct=confidence,
        pipeline_actions=_build_pipeline_actions(inp),
        strengths_analysis=strengths,
        risk_analysis=risks,
        verdict_reasoning=verdict,
        suggested_next_steps=next_steps,
    )
