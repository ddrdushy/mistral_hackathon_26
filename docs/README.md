# HireOps AI — Documentation Index

| Document | Audience | When to read it |
| --- | --- | --- |
| [TESTING_QUICKSTART.md](TESTING_QUICKSTART.md) | Anyone | First. 30-min path from zero to a working demo. |
| [OPERATOR_SETUP_GUIDE.md](OPERATOR_SETUP_GUIDE.md) | Operator / admin / you | Configuring the platform: env vars, third-party services, per-tenant admin operations. |
| [TEST_PLAN.md](TEST_PLAN.md) | QA / tester | Feature-by-feature test cases with pre-conditions, steps, and expected results. |

## Recommended reading order

### If you're setting up the platform

1. **TESTING_QUICKSTART.md** — get a working stack in 30 minutes.
2. **OPERATOR_SETUP_GUIDE.md** — fill in real Mistral / Stripe / Twilio /
   ElevenLabs / Gmail credentials.
3. Hand the test plan to your QA team.

### If you're testing the platform

1. **TESTING_QUICKSTART.md § "The 90-second smoke test"** — confirm the stack
   is actually working before you start.
2. **OPERATOR_SETUP_GUIDE.md § "Diagnostics"** — bookmark this for when
   something breaks.
3. **TEST_PLAN.md** — run from top to bottom. Each section is independent.

### If you're debugging

1. **TEST_PLAN.md § "Diagnostics & verification"** — quick commands to find
   the broken layer.
2. **OPERATOR_SETUP_GUIDE.md § "Diagnostics / health checks"** — deeper
   sanity checks per feature.

## Quick links to feature owners

| Feature | Spec section | Test section |
| --- | --- | --- |
| Audit log | [Setup §12](OPERATOR_SETUP_GUIDE.md#12-audit-log) | [Test §1](TEST_PLAN.md#1-audit-log) |
| Resume fraud | — | [Test §2](TEST_PLAN.md#2-resume-fraud-detection) |
| Tags | — | [Test §3](TEST_PLAN.md#3-candidate-tags) |
| Pipeline stages | — | [Test §4](TEST_PLAN.md#4-custom-hiring-stages) |
| Interview questions | — | [Test §5](TEST_PLAN.md#5-custom-interview-questions) |
| Recruiter productivity | — | [Test §6](TEST_PLAN.md#6-recruiter-productivity) |
| Outreach | — | [Test §7](TEST_PLAN.md#7-sequenced-outreach) |
| Offer + e-sign | — | [Test §8](TEST_PLAN.md#8-offer-letter--e-sign) |
| Pipeline forecast | — | [Test §9](TEST_PLAN.md#9-pipeline-forecasting) |
| HRIS (mock) | [Setup §10](OPERATOR_SETUP_GUIDE.md#10-hris--ats-mock-adapter-only) | [Test §10](TEST_PLAN.md#10-hris--ats-mock-only) |
| Auto-workflow | — | [Test §11](TEST_PLAN.md#11-auto-workflow-emailhire) |
| Voice screening | [Setup §8](OPERATOR_SETUP_GUIDE.md#8-voice-screening-elevenlabs) | [Test §12](TEST_PLAN.md#12-voice-screening-elevenlabs) |
| Phone queue | [Setup §9](OPERATOR_SETUP_GUIDE.md#9-phone-queue-twilio) | [Test §13](TEST_PLAN.md#13-phone-queue-twilio) |
| Plan gating | [Setup §11](OPERATOR_SETUP_GUIDE.md#11-plan-gating--agent-overrides) | [Test §14](TEST_PLAN.md#14-billing--plan-gating) |
| Stripe toggle | [Setup §7](OPERATOR_SETUP_GUIDE.md#7-billing--plans-stripe) | [Test §15](TEST_PLAN.md#15-stripe-sandboxprod-toggle) |
| Per-recruiter LLM cost | [Setup §5](OPERATOR_SETUP_GUIDE.md#5-mistral-agents) | [Test §16](TEST_PLAN.md#16-per-recruiter-llm-cost) |
| Talent bank | — | [Test §17](TEST_PLAN.md#17-talent-bank--profile-extraction) |
