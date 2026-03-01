"""
One-time setup: run locally to get a Gmail API refresh token.

Prerequisites:
  1. Go to Google Cloud Console > APIs & Services > Library
     Enable "Gmail API"
  2. Go to APIs & Services > Credentials
     Create OAuth2 Client ID (type: Desktop app)
     Download JSON as credentials.json in this directory
  3. Run:  python setup_gmail_oauth.py
  4. Copy the printed env vars to HF Spaces Settings > Variables

Scopes requested: gmail.readonly + gmail.send
"""
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]


def main():
    flow = InstalledAppFlow.from_client_secrets_file("credentials.json", SCOPES)
    creds = flow.run_local_server(port=0)

    print("\n" + "=" * 60)
    print("  Copy these to HF Spaces Environment Variables")
    print("=" * 60)
    print(f"GMAIL_CLIENT_ID={creds.client_id}")
    print(f"GMAIL_CLIENT_SECRET={creds.client_secret}")
    print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
    print()
    print("Also set: GMAIL_EMAIL=<your-gmail-address>")
    print("=" * 60)
    print("\nDone! You can delete credentials.json now.")


if __name__ == "__main__":
    main()
