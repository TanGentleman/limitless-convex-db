"""
This script:
1. Initializes a Convex client using environment variables
2. Triggers a sync operation
3. Optionally sends a Slack notification with the sync status
"""

import os

from dotenv import load_dotenv
from convex import ConvexClient

# Set after adding SLACK_WEBHOOK_URL to Convex Environment
SEND_SLACK_NOTIFICATION = True

def get_client():
    """Initialize Convex client. Requires .env with CONVEX_URL."""
    load_dotenv()
    backend_url = os.getenv("CONVEX_URL")
    if not backend_url:
        raise ValueError("CONVEX_URL not set in .env")
    return ConvexClient(backend_url)

def main():
    client = get_client()
    print(client.action("extras/hooks:sync", {"sendNotification": SEND_SLACK_NOTIFICATION}))

if __name__ == "__main__":
    main()