"""
Job Generator — Uses Mistral to auto-generate rich job posting details from a title.
Generates: department, location, seniority, must_have_skills, nice_to_have_skills,
           responsibilities, qualifications, description
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

        prompt = f"""You are an expert technical recruiter creating a comprehensive LinkedIn-quality job posting.

Job Title: {title}

Return a JSON object with ALL of these fields:

{{
  "department": "Engineering" | "IT" | "Data & Analytics" | "Product" | "Design" | "Marketing" | "Sales" | "Operations",
  "location": "Remote" | "San Francisco, CA" | "New York, NY" | etc.,
  "seniority": "junior" | "mid" | "senior" | "lead",
  "must_have_skills": ["skill1", "skill2", ...],
  "nice_to_have_skills": ["skill1", "skill2", ...],
  "responsibilities": ["responsibility1", "responsibility2", ...],
  "qualifications": ["qual1", "qual2", ...],
  "description": "Full job description text..."
}}

REQUIREMENTS:
1. "must_have_skills": 6-8 SPECIFIC technical tools/technologies/platforms/languages/frameworks REQUIRED for this role. NEVER generic soft skills. Examples: "UiPath", "Python", "React", "AWS", "Kubernetes", "SAP S/4HANA".

2. "nice_to_have_skills": 4-6 additional technical tools, certifications, or specialized domain knowledge. Examples: "Blue Prism", "PMP Certification", "GraphQL", "Terraform", "TOGAF".

3. "responsibilities": 6-8 specific, actionable responsibilities that describe the day-to-day work. Each should start with an action verb. Examples:
   - "Design, develop, and maintain RPA bots using UiPath and Automation Anywhere"
   - "Write Python and VB.NET scripts for data extraction and transformation within automated workflows"
   - "Collaborate with business analysts to identify automation opportunities and document process flows"

4. "qualifications": 3-5 items including degree requirements, years of experience, and certifications. Examples:
   - "Bachelor's degree in Computer Science, IT, or related field"
   - "3+ years of hands-on experience in RPA development"
   - "UiPath Advanced Developer Certification preferred"

5. "description": 3-4 paragraph professional description (200-350 words) that mentions the specific tools, technologies, and what the role involves day-to-day.

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

        # Handle both old format (skills) and new format (must_have_skills + nice_to_have_skills)
        if "must_have_skills" in result and "skills" not in result:
            result["skills"] = result["must_have_skills"]
        if "skills" not in result:
            result["skills"] = []

        # Ensure responsibilities exists
        if "responsibilities" not in result or not isinstance(result["responsibilities"], list):
            result["responsibilities"] = []
        if "qualifications" not in result or not isinstance(result["qualifications"], list):
            result["qualifications"] = []

        # Validate required fields
        for field in ["department", "location", "seniority", "skills", "description"]:
            if field not in result:
                raise ValueError(f"Missing field: {field}")
        if not isinstance(result["skills"], list):
            result["skills"] = [result["skills"]]
        if "must_have_skills" in result and not isinstance(result["must_have_skills"], list):
            result["must_have_skills"] = [result["must_have_skills"]]
        if "nice_to_have_skills" in result and not isinstance(result["nice_to_have_skills"], list):
            result["nice_to_have_skills"] = [result["nice_to_have_skills"]]
        if result["seniority"] not in ("junior", "mid", "senior", "lead"):
            result["seniority"] = "mid"
        return result

    except Exception as e:
        print(f"Mistral API error: {e}, falling back to mock")
        return _mock_generate(title)


def _mock_generate(title: str) -> dict:
    """Mock job generation for development — produces LinkedIn-quality JDs."""
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

    # ─── Role-specific data ───
    role_data = {
        "rpa": {
            "skills": ["UiPath", "Automation Anywhere", "Blue Prism", "Python", "SQL", "VB.NET", "REST APIs", "Power Automate"],
            "nice_to_have": ["ABBYY FlexiCapture", "Orchestrator", "Process Mining", "Celonis", "RPA CoE Methodology"],
            "responsibilities": [
                "Design, develop, and deploy RPA bots using UiPath and Automation Anywhere to automate business processes",
                "Write Python and VB.NET scripts for data extraction, transformation, and validation within automated workflows",
                "Integrate RPA bots with enterprise systems via REST APIs, databases, and file-based interfaces",
                "Collaborate with business analysts to identify automation opportunities and document process design documents (PDD)",
                "Perform unit testing, UAT support, and production deployment of RPA solutions",
                "Monitor bot performance using Orchestrator dashboards and troubleshoot production failures",
                "Maintain technical documentation including Solution Design Documents (SDD) and runbooks",
                "Participate in RPA Center of Excellence (CoE) activities and contribute to best practices",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science, Information Technology, or related field",
                "3+ years of hands-on experience developing RPA solutions with UiPath or Automation Anywhere",
                "UiPath Advanced Developer Certification or Automation Anywhere Certified Advanced RPA Professional preferred",
                "Strong SQL skills for database queries and data manipulation",
                "Experience integrating automation with ERP systems (SAP, Oracle) is a plus",
            ],
        },
        "frontend": {
            "skills": ["React", "TypeScript", "Next.js", "CSS3", "HTML5", "Tailwind CSS", "Jest", "Webpack"],
            "nice_to_have": ["GraphQL", "Storybook", "Cypress", "Figma", "Web Accessibility (WCAG)"],
            "responsibilities": [
                "Build and maintain responsive web applications using React and TypeScript",
                "Implement pixel-perfect UI components from Figma designs using Tailwind CSS",
                "Develop server-side rendered pages and API routes with Next.js",
                "Write comprehensive unit and integration tests using Jest and React Testing Library",
                "Optimize application performance including bundle size, Core Web Vitals, and rendering efficiency",
                "Collaborate with UX designers and backend engineers to define and implement API contracts",
                "Review pull requests and mentor junior developers on frontend best practices",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science or equivalent practical experience",
                "3+ years of professional frontend development experience with React",
                "Strong understanding of responsive design, cross-browser compatibility, and web accessibility",
                "Experience with state management (Redux, Zustand, or React Context)",
            ],
        },
        "backend": {
            "skills": ["Python", "Node.js", "PostgreSQL", "REST APIs", "Docker", "AWS", "Redis", "FastAPI"],
            "nice_to_have": ["Kubernetes", "GraphQL", "Kafka", "Terraform", "gRPC"],
            "responsibilities": [
                "Design and implement RESTful APIs and microservices using Python/FastAPI or Node.js",
                "Design and optimize PostgreSQL database schemas, queries, and migrations",
                "Build and maintain CI/CD pipelines and containerized deployments with Docker",
                "Implement caching strategies using Redis for high-performance data access",
                "Write comprehensive unit and integration tests with >80% code coverage",
                "Conduct code reviews and participate in architecture design discussions",
                "Monitor application health and performance using logging, metrics, and alerting tools",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science, Software Engineering, or related field",
                "4+ years of backend development experience with Python or Node.js",
                "Strong knowledge of relational databases, SQL optimization, and ORM frameworks",
                "Experience deploying and managing applications on AWS (EC2, ECS, Lambda, RDS)",
            ],
        },
        "data": {
            "skills": ["SQL", "Python", "Power BI", "Tableau", "ETL", "Spark", "Airflow", "Data Modeling"],
            "nice_to_have": ["dbt", "Snowflake", "Looker", "Databricks", "AWS Redshift"],
            "responsibilities": [
                "Design and build ETL/ELT pipelines to extract, transform, and load data from multiple sources",
                "Create interactive dashboards and reports using Power BI and Tableau",
                "Write complex SQL queries for data analysis, reporting, and business intelligence",
                "Develop and maintain data models that support analytics and machine learning workloads",
                "Collaborate with stakeholders to translate business requirements into data solutions",
                "Ensure data quality through validation, testing, and monitoring of data pipelines",
                "Document data lineage, schema definitions, and transformation logic",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science, Statistics, Mathematics, or related field",
                "3+ years of experience in data engineering or analytics",
                "Expert-level SQL skills and experience with at least one BI/visualization tool",
                "Experience with cloud data platforms (Snowflake, BigQuery, or Redshift)",
            ],
        },
        "devops": {
            "skills": ["Kubernetes", "Terraform", "AWS", "CI/CD", "Docker", "Prometheus", "Linux", "Ansible"],
            "nice_to_have": ["ArgoCD", "Helm", "Vault", "Datadog", "GCP", "Azure DevOps"],
            "responsibilities": [
                "Design and maintain cloud infrastructure using Terraform and AWS services",
                "Build and optimize CI/CD pipelines for automated testing, building, and deployment",
                "Manage Kubernetes clusters and containerized application deployments",
                "Implement monitoring, alerting, and observability using Prometheus, Grafana, and ELK stack",
                "Automate infrastructure provisioning and configuration management with Ansible",
                "Ensure system reliability, scalability, and security through SRE best practices",
                "Respond to production incidents and conduct post-mortem analysis",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science, IT, or related field",
                "4+ years of DevOps/SRE experience in production environments",
                "Strong Linux administration and shell scripting skills",
                "AWS Solutions Architect or DevOps Engineer certification preferred",
            ],
        },
        "product": {
            "skills": ["Jira", "Amplitude", "SQL", "Figma", "A/B Testing", "Mixpanel", "Roadmapping", "User Research"],
            "nice_to_have": ["Pendo", "Productboard", "Looker", "Python", "Intercom"],
            "responsibilities": [
                "Define product strategy and roadmap based on user research, data analysis, and business goals",
                "Write detailed product requirements documents (PRDs) and user stories with clear acceptance criteria",
                "Prioritize features using data-driven frameworks (RICE, ICE) and manage the product backlog",
                "Analyze product metrics using Amplitude and SQL to measure feature impact and inform decisions",
                "Collaborate with engineering, design, and QA teams throughout the development lifecycle",
                "Conduct user interviews, usability testing, and competitive analysis",
                "Present product updates to stakeholders and leadership on a regular cadence",
            ],
            "qualifications": [
                "Bachelor's degree in Business, Computer Science, or related field; MBA preferred",
                "3+ years of product management experience in a SaaS or technology company",
                "Strong analytical skills with hands-on SQL experience",
                "Excellent communication and stakeholder management skills",
            ],
        },
    }

    # Find matching role data
    matched_data = None
    for keyword, data in role_data.items():
        if keyword in title_lower:
            matched_data = data
            break

    if not matched_data:
        matched_data = {
            "skills": ["Python", "SQL", "Git", "REST APIs", "Docker", "AWS", "CI/CD", "Linux"],
            "nice_to_have": ["Kubernetes", "Terraform", "GraphQL", "TypeScript", "Redis"],
            "responsibilities": [
                f"Design, develop, and maintain solutions as a {title}",
                "Collaborate with cross-functional teams to deliver high-quality software",
                "Write clean, maintainable, and well-tested code following best practices",
                "Participate in code reviews and contribute to technical design discussions",
                "Monitor application performance and troubleshoot production issues",
                "Document technical specifications and system architecture",
                "Mentor junior team members and contribute to engineering best practices",
            ],
            "qualifications": [
                "Bachelor's degree in Computer Science, Engineering, or related field",
                "3+ years of relevant professional experience",
                "Strong problem-solving skills and attention to detail",
                "Experience with agile development methodologies",
            ],
        }

    skills = matched_data["skills"]
    responsibilities = matched_data["responsibilities"]

    description = (
        f"We are seeking a skilled {title} to join our {department} team. "
        f"In this role, you will leverage tools like {', '.join(skills[:3])} "
        f"to design, develop, and deliver solutions that drive operational efficiency and business impact.\n\n"
        f"You will be responsible for {responsibilities[0].lower()} and {responsibilities[1].lower()}. "
        f"The ideal candidate has hands-on experience building scalable solutions "
        f"and thrives in a collaborative, fast-paced environment.\n\n"
        f"We offer competitive compensation, flexible remote work arrangements, "
        f"and a culture that values innovation, continuous learning, and technical excellence."
    )

    return {
        "department": department,
        "location": "Remote",
        "seniority": seniority,
        "skills": skills,
        "nice_to_have_skills": matched_data["nice_to_have"],
        "responsibilities": responsibilities,
        "qualifications": matched_data["qualifications"],
        "description": description,
    }
