"""
Voice Screener Agent (ElevenLabs)
Purpose: Manage voice screening calls via ElevenLabs Conversational AI.

REAL FLOW:
  1. Backend calls ElevenLabs API to initiate a call
  2. ElevenLabs agent interviews the candidate
  3. After call ends, ElevenLabs sends a POST webhook to /api/v1/webhook/elevenlabs
  4. Webhook handler stores transcript and triggers interview evaluator

This stub provides:
  - Question generation from job + resume context
  - A simulated transcript for mock/demo mode
"""
from dataclasses import dataclass
from typing import List

USE_MOCK = True
ELEVENLABS_AGENT_ID = ""  # User sets their ElevenLabs agent ID


@dataclass
class VoiceScreenerInput:
    candidate_name: str
    candidate_phone: str
    job_title: str
    screening_questions: List[str]


@dataclass
class VoiceScreenerOutput:
    status: str          # screening_started / screening_simulated / error
    conversation_id: str  # ElevenLabs conversation ID (for tracking)
    transcript: str       # Only populated in mock mode
    duration_seconds: int
    questions_asked: int
    questions_answered: int


async def start_voice_screening(input_data: VoiceScreenerInput) -> VoiceScreenerOutput:
    if not USE_MOCK:
        # TODO: User integrates ElevenLabs Conversational AI SDK
        # This would initiate an outbound call to candidate_phone
        # The real transcript comes via webhook, not from this function
        raise NotImplementedError(
            "Integrate ElevenLabs Conversational AI. "
            "Set ELEVENLABS_AGENT_ID and implement the outbound call."
        )

    # ─── MOCK: Generate a simulated transcript ───
    mock_answers = [
        f"I have about 5 years of experience in that area. At my previous company, I led a team that delivered key projects on time and under budget.",
        f"I'm really excited about the {input_data.job_title} role because it aligns perfectly with my career goals and the technologies I'm passionate about.",
        "One challenging project was when we had to migrate our entire platform to a new architecture. I took the lead on planning and coordinating across three teams.",
        "I manage deadlines by breaking work into sprints, prioritizing ruthlessly, and communicating early when I see risks. I've never missed a critical deadline.",
        "In two years, I see myself growing into a technical lead role, mentoring junior developers and driving architectural decisions.",
    ]

    qa_pairs = []
    for i, q in enumerate(input_data.screening_questions[:5]):
        answer = mock_answers[i] if i < len(mock_answers) else "That's a great question. I would approach it by analyzing the problem space first and then iterating on solutions."
        qa_pairs.append(f"Q: {q}\nA: {answer}\n")

    transcript = f"Voice Screening Transcript - {input_data.candidate_name}\n"
    transcript += f"Position: {input_data.job_title}\n"
    transcript += "=" * 50 + "\n\n"
    transcript += "\n".join(qa_pairs)

    return VoiceScreenerOutput(
        status="screening_simulated",
        conversation_id="mock-conv-001",
        transcript=transcript,
        duration_seconds=420,
        questions_asked=min(len(input_data.screening_questions), 5),
        questions_answered=min(len(input_data.screening_questions), 5),
    )
