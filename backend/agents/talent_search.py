"""Talent Search Agent.

Takes a Job and turns it into a candidate-search query that the configured
talent provider (Apollo by default, BYO LinkedIn/Indeed/JobStreet later)
can execute. Returns the matched candidates plus a per-candidate fit
rationale grounded in the Job description.

The Mistral agent is optional — if MISTRAL_API_KEY (or the agent ID) is
unset, we fall back to a deterministic query builder that's good enough
for the demo. Either way we still hit the real Apollo API.

Env:
  TALENT_SEARCH_AGENT_ID   Mistral agent ID for prompt/policy. Optional.
  TALENT_SEARCH_MOCK       "true" to skip the LLM altogether.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from services import apollo_service
from services.llm_tracker import LLMCallTimer, log_usage

logger = logging.getLogger("hireops.talent_search")

USE_MOCK = os.getenv("TALENT_SEARCH_MOCK", "false").lower() == "true"
AGENT_ID = os.getenv("TALENT_SEARCH_AGENT_ID", "").strip()


@dataclass
class JobSummary:
    title: str
    seniority: str = ""
    location: str = ""
    skills: List[str] = field(default_factory=list)
    description: str = ""


@dataclass
class TalentMatch:
    """One ranked candidate returned to the UI."""
    name: str
    email: Optional[str]
    title: Optional[str]
    company: Optional[str]
    location: Optional[str]
    years_experience: Optional[int]
    skills: List[str]
    profile_url: Optional[str]
    linkedin_url: Optional[str]
    provider: str            # apollo | apollo_mock | byo:linkedin ...
    external_id: Optional[str]
    fit_score: int           # 0–100
    fit_reasoning: str       # one-sentence rationale


# ─── Query building ───────────────────────────────────────────────────────


def _llm_build_query(job: JobSummary) -> Optional[Dict[str, Any]]:
    """Optional Mistral pass to refine the query. Returns None on any error."""
    if USE_MOCK or not AGENT_ID:
        return None
    try:
        from mistralai import Mistral
    except ImportError:
        return None

    api_key = os.environ.get("MISTRAL_API_KEY")
    if not api_key:
        return None

    prompt = (
        "You are a recruiter sourcing assistant. Given a job description, "
        "produce a candidate-search query as compact JSON with keys: "
        "title_keywords (list[str]), seniority (str — entry|senior|director|vp), "
        "location (str), skills (list[str]), company_keywords (list[str]). "
        "Be specific; prefer skills the job description actually demands.\n\n"
        f"Job: {json.dumps(asdict(job))}"
    )

    try:
        client = Mistral(api_key=api_key)
        with LLMCallTimer("talent_search", "agent") as timer:
            response = client.beta.conversations.start(
                agent_id=AGENT_ID,
                inputs=[{"role": "user", "content": prompt}],
            )
            timer.input_tokens = len(prompt.split()) * 2
            timer.output_tokens = len(response.outputs[0].content.split()) * 2

        text = response.outputs[0].content.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)
    except Exception as e:
        logger.warning("Mistral query refinement failed: %s — falling back to deterministic builder", e)
        return None


def _deterministic_query(job: JobSummary) -> Dict[str, Any]:
    """No-LLM fallback. Good enough for the demo."""
    return {
        "title_keywords": [job.title] if job.title else [],
        "seniority": _normalize_seniority(job.seniority),
        "location": job.location or None,
        "skills": list(job.skills or [])[:5],
        "company_keywords": [],
    }


_SENIORITY_MAP = {
    "junior": "entry",
    "mid": "senior",
    "senior": "senior",
    "lead": "director",
    "principal": "director",
    "staff": "director",
    "manager": "manager",
    "director": "director",
    "vp": "vp",
}


def _normalize_seniority(s: str) -> str:
    return _SENIORITY_MAP.get((s or "").strip().lower(), "")


# ─── Fit scoring ──────────────────────────────────────────────────────────


def _score_match(job: JobSummary, candidate: Dict[str, Any]) -> tuple[int, str]:
    """Cheap heuristic that runs on every result so the UI can sort & explain.
    Pure Python — no LLM call, free per result, deterministic. The agent can
    refine the top-N later if the user clicks 'Get a deeper read' (TODO)."""
    score = 50
    reasons: List[str] = []

    # Skill overlap
    cand_skills = {s.lower() for s in candidate.get("skills") or []}
    job_skills = {s.lower() for s in job.skills or []}
    overlap = cand_skills & job_skills
    if job_skills:
        skill_pct = len(overlap) / len(job_skills)
        score += int(skill_pct * 25)
        if overlap:
            reasons.append(f"matches {len(overlap)} of {len(job_skills)} required skills ({', '.join(list(overlap)[:3])})")

    # Title alignment
    title = (candidate.get("title") or "").lower()
    if job.title and any(w in title for w in job.title.lower().split() if len(w) > 3):
        score += 10
        reasons.append("title aligns with the role")

    # Seniority alignment
    yrs = candidate.get("years_experience") or 0
    sen = (job.seniority or "").lower()
    if sen in ("senior", "lead", "principal") and yrs >= 5:
        score += 8
        reasons.append(f"{yrs}+ years matches the seniority bar")
    elif sen in ("junior", "entry") and yrs <= 3:
        score += 5
        reasons.append("experience level fits a junior role")
    elif yrs:
        reasons.append(f"{yrs} years of experience")

    # Location proximity (substring)
    if job.location and candidate.get("location"):
        if any(part.strip().lower() in candidate["location"].lower()
               for part in job.location.split(",") if len(part.strip()) > 2):
            score += 7
            reasons.append("location matches")

    # Has a contact channel
    if candidate.get("email"):
        score += 3

    score = max(0, min(100, score))
    rationale = "; ".join(reasons) if reasons else "general profile alignment"
    return score, rationale


# ─── Public entrypoint ────────────────────────────────────────────────────


async def search_talent(
    job: JobSummary,
    *,
    limit: int = 20,
) -> List[TalentMatch]:
    """End-to-end: optional LLM query refinement → Apollo search → fit scoring.

    Returns ranked TalentMatch objects sorted by fit_score desc.
    """
    refined = _llm_build_query(job) or _deterministic_query(job)

    # Light validation — Apollo accepts forgiving payloads but we don't want
    # to send None where it expects a list.
    title_keywords = refined.get("title_keywords") or [job.title] if job.title else []
    candidates = apollo_service.search_people(
        title_keywords=title_keywords,
        location=refined.get("location") or job.location or None,
        seniority=refined.get("seniority") or _normalize_seniority(job.seniority),
        skills=refined.get("skills") or job.skills,
        company_keywords=refined.get("company_keywords") or [],
        limit=limit,
    )

    # Log mock-mode usage so the UI can show a "demo data" badge
    if candidates and candidates[0].get("provider") == "apollo_mock":
        log_usage("talent_search", "mock", input_tokens=0, output_tokens=0,
                  latency_ms=5, status="success", metadata={"mode": "apollo_mock"})

    matches: List[TalentMatch] = []
    for c in candidates:
        fit, why = _score_match(job, c)
        matches.append(TalentMatch(
            name=c.get("name") or "Unknown",
            email=c.get("email"),
            title=c.get("title"),
            company=c.get("company"),
            location=c.get("location"),
            years_experience=c.get("years_experience"),
            skills=c.get("skills") or [],
            profile_url=c.get("profile_url"),
            linkedin_url=c.get("linkedin_url"),
            provider=c.get("provider", "apollo"),
            external_id=str(c.get("external_id") or ""),
            fit_score=fit,
            fit_reasoning=why,
        ))

    matches.sort(key=lambda m: m.fit_score, reverse=True)
    return matches
