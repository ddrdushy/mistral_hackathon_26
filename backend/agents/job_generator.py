"""
Job Generator — Uses Mistral to auto-generate job posting details from a title.
"""
import os
import json


USE_MOCK = False  # Use real Mistral API by default


async def generate_job_details(title: str) -> dict:
    """Generate job posting details from a title using Mistral AI."""

    if USE_MOCK:
        return _mock_generate(title)

    try:
        from mistralai import Mistral
        from services.llm_tracker import LLMCallTimer

        client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY"))

        prompt = f"""You are an expert HR professional. Given a job title, generate a complete job posting.

Job Title: {title}

Return a JSON object with these exact fields:
- "department": string (e.g. "Engineering", "Marketing", "Product", "Design", "Operations")
- "location": string (e.g. "San Francisco, CA", "Remote", "New York, NY")
- "seniority": string (one of: "junior", "mid", "senior", "lead")
- "skills": array of strings (5-8 relevant technical/professional skills)
- "description": string (2-3 paragraph professional job description, 150-250 words)

Return ONLY valid JSON, no markdown, no explanation."""

        with LLMCallTimer("job_generator", "mistral-large-latest") as timer:
            response = client.chat.complete(
                model="mistral-large-latest",
                messages=[{"role": "user", "content": prompt}],
                response_format={"type": "json_object"},
            )
            usage = response.usage
            if usage:
                timer.input_tokens = usage.prompt_tokens
                timer.output_tokens = usage.completion_tokens

        result = json.loads(response.choices[0].message.content)
        # Validate required fields
        for field in ["department", "location", "seniority", "skills", "description"]:
            if field not in result:
                raise ValueError(f"Missing field: {field}")
        if not isinstance(result["skills"], list):
            result["skills"] = [result["skills"]]
        if result["seniority"] not in ("junior", "mid", "senior", "lead"):
            result["seniority"] = "mid"
        return result

    except Exception as e:
        print(f"Mistral API error: {e}, falling back to mock")
        return _mock_generate(title)


def _mock_generate(title: str) -> dict:
    """Mock job generation for development."""
    title_lower = title.lower()

    dept_map = {
        "engineer": "Engineering", "developer": "Engineering", "devops": "Infrastructure",
        "frontend": "Engineering", "backend": "Engineering", "fullstack": "Engineering",
        "data": "Data & Analytics", "analyst": "Data & Analytics", "scientist": "Data Science",
        "designer": "Design", "ux": "Design", "ui": "Design",
        "product": "Product", "marketing": "Marketing", "growth": "Marketing",
        "sales": "Sales", "hr": "Human Resources", "recruiter": "Human Resources",
    }
    department = "General"
    for keyword, dept in dept_map.items():
        if keyword in title_lower:
            department = dept
            break

    seniority = "mid"
    if any(kw in title_lower for kw in ("junior", "jr", "entry", "intern")):
        seniority = "junior"
    elif any(kw in title_lower for kw in ("senior", "sr", "principal", "staff")):
        seniority = "senior"
    elif any(kw in title_lower for kw in ("lead", "head", "director", "vp")):
        seniority = "lead"

    skill_map = {
        "frontend": ["React", "TypeScript", "CSS", "HTML5", "Next.js", "Tailwind CSS", "Jest"],
        "backend": ["Python", "Node.js", "PostgreSQL", "REST APIs", "Docker", "AWS", "Redis"],
        "fullstack": ["React", "Node.js", "TypeScript", "PostgreSQL", "Docker", "AWS", "Git"],
        "devops": ["Kubernetes", "Terraform", "AWS", "CI/CD", "Docker", "Monitoring", "Linux"],
        "data": ["SQL", "Python", "Power BI", "ETL", "Statistics", "Data Modeling"],
        "designer": ["Figma", "User Research", "Prototyping", "Design Systems", "Wireframing"],
        "product": ["Product Strategy", "Agile", "User Research", "SQL", "Analytics"],
        "marketing": ["SEO", "Content Strategy", "Google Analytics", "Social Media", "Copywriting"],
    }
    skills = ["Communication", "Problem Solving", "Team Collaboration", "Analytical Thinking"]
    for keyword, s in skill_map.items():
        if keyword in title_lower:
            skills = s
            break

    description = (
        f"We are looking for a talented {title} to join our {department} team. "
        f"In this role, you will collaborate with cross-functional teams to deliver high-quality work "
        f"that drives business impact.\n\n"
        f"The ideal candidate has strong expertise in {', '.join(skills[:3])} and is passionate about "
        f"building exceptional solutions. You will have the opportunity to work on challenging problems "
        f"and grow your career in a fast-paced environment.\n\n"
        f"We offer competitive compensation, flexible work arrangements, and a collaborative culture "
        f"that values innovation and continuous learning."
    )

    return {
        "department": department,
        "location": "Remote",
        "seniority": seniority,
        "skills": skills,
        "description": description,
    }
