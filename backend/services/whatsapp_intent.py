"""Classify candidate WhatsApp replies to the availability-check ping.

Keyword-based on purpose — an LLM call per inbound message is overkill
when the universe of expected replies is small. Order matters: the
'decline' patterns are checked first because phrases like "I'm not
available this week but next week works" should NOT be treated as a
flat decline (we route them to 'unclear' so HR sees the full message).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Intent = Literal["confirm", "decline_joined_another", "decline_not_available", "decline_other", "unclear"]


@dataclass
class IntentResult:
    intent: Intent
    matched_phrase: str
    confidence: float  # 0..1, mostly informational


# Decline → joined a different role (most actionable for the talent bank).
_JOINED_PATTERNS = (
    "joined another",
    "already accepted",
    "started a new",
    "took another",
    "took up a",
    "i have a new job",
    "i have already joined",
    "i'm employed at",
    "i'm now at",
    "got a job at",
    "got hired at",
    "currently employed at",
    "signed an offer",
    "accepted an offer",
)

# Decline → not currently available (could be temporary).
_NOT_AVAILABLE_PATTERNS = (
    "not available",
    "not looking",
    "not interested",
    "no longer looking",
    "not open to",
    "happy where i am",
    "happy in my current",
    "not actively",
    "please remove me",
    "stop contacting",
    "unsubscribe",
)

# Mixed signals — partial availability, asking for more info, scheduling
# nuance. These come BEFORE confirm so we don't accidentally take "i can't
# this week but next is fine" as a flat decline. Returned as 'unclear' so
# HR opens it.
_NUANCE_PATTERNS = (
    "but next",
    "can we do",
    "but after",
    "later this",
    "but instead",
    "instead of",
    "if not",
    "before i decide",
    "what is the",
    "what's the",
    "more info",
    "more details",
    "salary range",
    "tell me more",
    "what's the salary",
    "package",
)

# Confirm → ready to interview.
_CONFIRM_PATTERNS = (
    "yes",
    "yeah",
    "sure",
    "okay",
    "ok",
    "sounds good",
    "i'm available",
    "i am available",
    "im available",
    "works for me",
    "happy to",
    "i'm in",
    "im in",
    "let's do",
    "let me know",
    "send me",
    "go ahead",
    "interested",
    "i'd love to",
    "would love to",
    "available tomorrow",
    "available today",
    "available this week",
    "available next week",
    "any time",
    "anytime",
)


def classify(message: str) -> IntentResult:
    text = (message or "").strip().lower()
    if not text:
        return IntentResult(intent="unclear", matched_phrase="", confidence=0.0)

    # Joined-another beats generic decline because it's the most useful
    # talent-bank signal.
    for p in _JOINED_PATTERNS:
        if p in text:
            return IntentResult(intent="decline_joined_another", matched_phrase=p, confidence=0.9)

    # Then nuance — don't auto-confirm someone who's asking for context.
    for p in _NUANCE_PATTERNS:
        if p in text:
            return IntentResult(intent="unclear", matched_phrase=p, confidence=0.5)

    # Generic not-available decline.
    for p in _NOT_AVAILABLE_PATTERNS:
        if p in text:
            return IntentResult(intent="decline_not_available", matched_phrase=p, confidence=0.8)

    # Confirm patterns last.
    for p in _CONFIRM_PATTERNS:
        if p in text:
            return IntentResult(intent="confirm", matched_phrase=p, confidence=0.7)

    return IntentResult(intent="unclear", matched_phrase="", confidence=0.0)
