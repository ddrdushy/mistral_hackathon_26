"""
Usage:
  docker exec -it hireops-backend python scripts/make_superadmin.py user@example.com

Promotes a user (identified by email) to is_superadmin=True. The user must
have signed up first.

In production, the SUPERADMIN_EMAILS env var is preferred (comma-separated)
because it auto-applies on every startup. This CLI is for ad-hoc promotion.
"""
import sys
from pathlib import Path

# Allow running from /app or /app/scripts
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal  # noqa: E402
from models import User  # noqa: E402


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)

    email = sys.argv[1].strip().lower()
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if not user:
            print(f"No user found with email '{email}'. Have they signed up?")
            sys.exit(1)
        if user.is_superadmin:
            print(f"User '{email}' is already a superadmin.")
            return
        user.is_superadmin = True
        db.commit()
        print(f"OK — '{email}' is now a superadmin.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
