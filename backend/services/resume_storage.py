"""Per-tenant filesystem storage for the original CV binaries.

Direct uploads (drag-drop, bulk import, walk-in resumes) used to be
parsed to text and the binary discarded. To support audit / re-share /
"download original PDF" workflows we now persist the original bytes on
disk under a tenant-scoped directory layout:

    <UPLOAD_DIR>/tenant_<tenant_id>/candidate_<candidate_id>/v<N>_<safe_name>

Each tenant's directory is isolated — read/write goes through this
module's helpers which check that the tenant_id in the requested path
matches the caller's session tenant before touching the filesystem.

UPLOAD_DIR is configurable via HIREOPS_UPLOAD_DIR. Default:
  <backend dir>/../uploads  (i.e. repo-root/uploads)

The DB stores the *relative* path (e.g. ``tenant_5/candidate_12/v2_jane.pdf``)
so the absolute root can change between environments without breaking
existing rows.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Optional, Tuple


def _default_root() -> str:
    here = Path(__file__).resolve().parent.parent  # backend/
    return str((here.parent / "uploads").resolve())


RESUMES_ROOT = Path(os.getenv("HIREOPS_UPLOAD_DIR", _default_root())).resolve()


def _ensure_root() -> None:
    RESUMES_ROOT.mkdir(parents=True, exist_ok=True)


_SAFE_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    """Strip path separators and unusual chars from an uploaded filename.

    Keeps the extension intact. Falls back to ``resume.bin`` if nothing
    usable remains.
    """
    base = os.path.basename(name or "").strip()
    base = _SAFE_CHARS.sub("_", base)
    base = base.strip("._") or "resume.bin"
    # Cap length to avoid filesystem limits on legacy filesystems.
    if len(base) > 120:
        stem, _, ext = base.rpartition(".")
        if ext and len(ext) <= 8:
            base = stem[: 120 - len(ext) - 1] + "." + ext
        else:
            base = base[:120]
    return base


def _tenant_dir(tenant_id: int) -> Path:
    return RESUMES_ROOT / f"tenant_{int(tenant_id)}"


def _candidate_dir(tenant_id: int, candidate_id: int) -> Path:
    return _tenant_dir(tenant_id) / f"candidate_{int(candidate_id)}"


def save_resume(
    tenant_id: int,
    candidate_id: int,
    version: int,
    filename: str,
    file_bytes: bytes,
) -> str:
    """Write ``file_bytes`` to disk and return the *relative* path stored
    in the DB. Creates parent dirs as needed."""
    _ensure_root()
    cand_dir = _candidate_dir(tenant_id, candidate_id)
    cand_dir.mkdir(parents=True, exist_ok=True)
    safe = _safe_filename(filename)
    target = cand_dir / f"v{int(version)}_{safe}"
    # If the same version already exists (e.g. retry), overwrite — keeps
    # the row + file in sync.
    with open(target, "wb") as fh:
        fh.write(file_bytes)
    return str(target.relative_to(RESUMES_ROOT))


def _resolve_relative(rel_path: str) -> Optional[Path]:
    """Resolve a stored relative path back to an absolute one, guarding
    against directory traversal (`..` segments resolving outside root)."""
    if not rel_path:
        return None
    candidate = (RESUMES_ROOT / rel_path).resolve()
    try:
        candidate.relative_to(RESUMES_ROOT)
    except ValueError:
        return None
    return candidate


def load_resume(rel_path: str, tenant_id: int) -> Optional[bytes]:
    """Read bytes back. Returns ``None`` if the path is missing, escapes
    root, or doesn't belong to the given tenant."""
    path = _resolve_relative(rel_path)
    if path is None or not path.is_file():
        return None
    # Tenant scoping: the path must live under tenant_<tenant_id>/.
    try:
        first_segment = path.relative_to(RESUMES_ROOT).parts[0]
    except (ValueError, IndexError):
        return None
    if first_segment != f"tenant_{int(tenant_id)}":
        return None
    with open(path, "rb") as fh:
        return fh.read()


def delete_resume(rel_path: str) -> None:
    """Best-effort delete. Silently ignores missing paths."""
    path = _resolve_relative(rel_path)
    if path is None or not path.exists():
        return
    try:
        path.unlink()
    except OSError:
        pass


def delete_tenant_dir(tenant_id: int) -> None:
    """Remove an entire tenant's resume tree. Called on hard-delete."""
    d = _tenant_dir(tenant_id)
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)


def tenant_disk_usage(tenant_id: int) -> Tuple[int, int]:
    """Walk the tenant's directory and return ``(file_count, total_bytes)``.

    Returns ``(0, 0)`` if the directory doesn't exist yet — that's the
    default state for any tenant that hasn't uploaded a CV directly.
    """
    d = _tenant_dir(tenant_id)
    if not d.exists():
        return (0, 0)
    n = 0
    total = 0
    for root, _dirs, files in os.walk(d):
        for f in files:
            try:
                total += (Path(root) / f).stat().st_size
                n += 1
            except OSError:
                continue
    return (n, total)


def all_tenant_disk_usage() -> dict[int, Tuple[int, int]]:
    """Return ``{tenant_id: (file_count, total_bytes)}`` for every
    tenant dir on disk. Used by the admin storage report."""
    out: dict[int, Tuple[int, int]] = {}
    if not RESUMES_ROOT.exists():
        return out
    for entry in RESUMES_ROOT.iterdir():
        if not entry.is_dir() or not entry.name.startswith("tenant_"):
            continue
        try:
            tid = int(entry.name.split("_", 1)[1])
        except (ValueError, IndexError):
            continue
        n = 0
        total = 0
        for root, _dirs, files in os.walk(entry):
            for f in files:
                try:
                    total += (Path(root) / f).stat().st_size
                    n += 1
                except OSError:
                    continue
        out[tid] = (n, total)
    return out
