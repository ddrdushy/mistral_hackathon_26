"""HRIS / ATS integrations (Feature 9).

Adapter pattern: every provider implements `IntegrationAdapter`. The
sync engine reads from / writes to adapters; provider-specific details
(auth, pagination, field shape) stay behind the interface.

v1 ships a working MockAdapter so the entire pipeline (connect → pull →
upsert → mapping → log) works end-to-end without external API access.
Merge.dev, Greenhouse, and Lever adapters are documented stubs in
`merge_adapter.py`, `greenhouse_adapter.py`, `lever_adapter.py` —
follow-up turns fill in the network code without touching the engine.
"""
from .base import (
    IntegrationAdapter,
    ExternalJob,
    ExternalCandidate,
    ExternalApplication,
)
from .mock_adapter import MockAdapter
from .registry import get_adapter, available_providers

__all__ = [
    "IntegrationAdapter",
    "ExternalJob",
    "ExternalCandidate",
    "ExternalApplication",
    "MockAdapter",
    "get_adapter",
    "available_providers",
]
