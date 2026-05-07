"""
Profile Extractor Agent — Talent Bank.

Pulls structured profile out of a resume (or email body + resume) so we can
match against future jobs by tag overlap WITHOUT calling the LLM again. One
extraction per candidate, cached on the candidates row.

INPUT: resume_text (combined email body + CV content)
OUTPUT: skills (list[str]), role (str), seniority (str), years (float),
        summary (str)

Mistral chat API is used directly (not an agent) so we don't need to provision
a separate agent ID — the prompt is short, deterministic, and JSON-only.
"""
from __future__ import annotations

import os
import json
import logging
from dataclasses import dataclass, field
from typing import List

logger = logging.getLogger("hireops.profile_extractor")

USE_MOCK = os.getenv("PROFILE_EXTRACTOR_MOCK", "false").lower() == "true"
MODEL = os.getenv("PROFILE_EXTRACTOR_MODEL", "mistral-small-latest")

_SYSTEM_PROMPT = """You extract structured candidate profiles from resume text. \
Return ONLY valid JSON matching the schema below. No prose. No markdown fences.

{
  "skills": [<= 12 short skill tags, lowercase, hyphenated where useful (e.g. "power-bi", "rpa", "uipath", "react", "sql")],
  "role": "primary role title in 1-3 words, e.g. RPA Developer | Data Analyst | Frontend Engineer | DevOps Engineer",
  "seniority": "junior | mid | senior | lead | principal | unknown",
  "years_experience": <number, can be 0 for fresher>,
  "summary": "<= 280 chars, plain prose, third person, no fluff — what they do, where, with what stack",
  "key_points": [
    "3-6 punchy bullets capturing standout achievements, scale ("led 12-engineer team"), shipped products, awards, certifications",
    "each bullet <= 100 chars, no markdown bullets/dashes/numbers, just the text"
  ]
}

Rules:
- Use ONLY information present in the resume. Do not invent.
- Skills are CONCRETE technologies / tools / methods, not soft skills.
- Lowercase + hyphens for compound names ("power-bi" not "Power BI").
- Key points should be the 3-6 things a recruiter would highlight when pitching this candidate to a hiring manager.
"""


@dataclass
class ProfileExtractorOutput:
    skills: List[str] = field(default_factory=list)
    role: str = ""
    seniority: str = ""
    years_experience: float = 0.0
    summary: str = ""
    key_points: List[str] = field(default_factory=list)


def _normalize_skill(s: str) -> str:
    return s.strip().lower().replace(" ", "-").replace("_", "-")


async def extract_profile(resume_text: str) -> ProfileExtractorOutput:
    text = (resume_text or "").strip()
    if not text:
        return ProfileExtractorOutput()

    if not USE_MOCK and os.getenv("MISTRAL_API_KEY"):
        try:
            from mistralai import Mistral
            from services.llm_tracker import LLMCallTimer

            client = Mistral(api_key=os.environ["MISTRAL_API_KEY"])

            # Cap input — full resumes can run 10k+ tokens, we don't need that
            # much for tagging. First 6k chars covers the headline + experience.
            content = text[:6000]

            with LLMCallTimer("profile_extractor", "chat") as timer:
                response = client.chat.complete(
                    model=MODEL,
                    messages=[
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": content},
                    ],
                    temperature=0.1,
                    max_tokens=600,
                )
                raw = response.choices[0].message.content or ""
                # Mistral usage is on response.usage
                u = getattr(response, "usage", None)
                if u:
                    timer.input_tokens = u.prompt_tokens
                    timer.output_tokens = u.completion_tokens
                else:
                    timer.input_tokens = len(content.split()) * 2
                    timer.output_tokens = len(raw.split()) * 2

            text_out = raw.strip()
            if text_out.startswith("```"):
                # Strip markdown fence even though we asked for none
                text_out = text_out.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            data = json.loads(text_out)

            key_points_raw = data.get("key_points") or []
            if isinstance(key_points_raw, str):
                key_points_raw = [key_points_raw]
            key_points = [str(k).strip()[:160] for k in key_points_raw if k][:6]

            return ProfileExtractorOutput(
                skills=[_normalize_skill(s) for s in (data.get("skills") or []) if s][:12],
                role=str(data.get("role") or "").strip()[:80],
                seniority=str(data.get("seniority") or "").strip().lower()[:20],
                years_experience=float(data.get("years_experience") or 0),
                summary=str(data.get("summary") or "").strip()[:320],
                key_points=key_points,
            )
        except Exception as e:
            logger.warning("profile_extractor LLM failed, falling back: %s", e)

    # ─── MOCK: keyword-based fallback so the feature works without LLM ───
    return _mock_extract(text)


_MOCK_SKILLS = [
    "python", "javascript", "typescript", "react", "next-js", "node",
    "java", "spring", "go", "rust", "c++", "c#", ".net",
    "sql", "postgresql", "mysql", "mongodb", "redis",
    "aws", "gcp", "azure", "docker", "kubernetes", "terraform",
    "rpa", "uipath", "automation-anywhere", "blue-prism",
    "power-bi", "tableau", "excel", "qlikview",
    "tensorflow", "pytorch", "scikit-learn", "pandas", "numpy",
    "git", "ci-cd", "agile", "scrum", "rest", "graphql",
    "django", "flask", "fastapi", "express",
]


def _mock_extract(text: str) -> ProfileExtractorOutput:
    lower = text.lower()
    found = []
    for sk in _MOCK_SKILLS:
        token = sk.replace("-", " ")
        if token in lower or sk in lower:
            found.append(sk)
    found = found[:12]

    role = ""
    for needle, label in [
        ("rpa", "RPA Developer"),
        ("data analyst", "Data Analyst"),
        ("data scientist", "Data Scientist"),
        ("frontend", "Frontend Engineer"),
        ("backend", "Backend Engineer"),
        ("full stack", "Full-Stack Engineer"),
        ("devops", "DevOps Engineer"),
        ("ml engineer", "ML Engineer"),
        ("software engineer", "Software Engineer"),
    ]:
        if needle in lower:
            role = label
            break

    seniority = "unknown"
    for needle, label in [
        ("principal", "principal"), ("staff", "lead"), ("lead ", "lead"),
        ("senior", "senior"), ("junior", "junior"), ("intern", "junior"),
    ]:
        if needle in lower:
            seniority = label
            break

    import re
    years = 0.0
    m = re.search(r"(\d+)\+?\s*years?", lower)
    if m:
        try:
            years = float(m.group(1))
        except ValueError:
            pass

    summary = ""
    if role:
        summary = f"{seniority.title() if seniority != 'unknown' else ''} {role}".strip()
        if found:
            summary += f" with experience in {', '.join(found[:5])}."

    return ProfileExtractorOutput(
        skills=found,
        role=role,
        seniority=seniority,
        years_experience=years,
        summary=summary,
    )
