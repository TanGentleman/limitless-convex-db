"""
Convex client for syncing Limitless data and scheduling sync operations.

Usage:
    python sync.py --now                # Run sync immediately
    python sync.py --show               # Show the last lifelog entry
    python sync.py 10s                  # Schedule sync in 10 seconds
    python sync.py 5m                   # Schedule sync in 5 minutes
    python sync.py 2h                   # Schedule sync in 2 hours
    python sync.py 1d                   # Schedule sync in 1 day
    python sync.py --http               # Trigger sync via HTTP endpoint
    python sync.py --quiet              # Run without sending Slack notification
"""

import os
import argparse
import requests
from dotenv import load_dotenv # type: ignore
from convex import ConvexClient

# Needs SLACK_WEBHOOK_URL to be set in Convex Environment
SEND_SLACK_NOTIFICATION = True

def get_client() -> ConvexClient:
    """Initialize Convex client from CONVEX_URL in .env"""
    load_dotenv()
    backend_url = os.getenv("CONVEX_URL")
    if not backend_url:
        raise ValueError("CONVEX_URL not set in .env")
    return ConvexClient(backend_url)

def sync_now(client: ConvexClient, send_notification: bool = True) -> None:
    """Trigger immediate sync with optional notification"""
    return client.action("dashboard/sync:sync", {"sendNotification": send_notification})

def sync_later(client: ConvexClient, seconds: int = 0, minutes: int = 0, hours: int = 0, days: int = 0) -> None:
    """Schedule sync after specified time interval"""
    return client.action("extras/schedules:scheduleSync", {
        "seconds": seconds,
        "minutes": minutes,
        "hours": hours,
        "days": days
    })

def show_last_lifelog(client: ConvexClient, send_notification: bool = True) -> None:
    """Show the last lifelog entry with optional notification"""
    if not send_notification:
        return client.query("dashboard/previews:getPreviewLifelog")
    return client.action("dashboard/previews:getLastLifelog", {"sendNotification": send_notification})

def trigger_sync_http() -> dict:
    """
    Trigger a sync operation on the Convex deployment using HTTP endpoint
    
    Returns:
        dict: Response from the server
    """
    convex_url = os.getenv("CONVEX_URL")
    if convex_url is None:
        raise ValueError("CONVEX_URL environment variable is not set")
    
    if ".cloud" not in convex_url:
        raise ValueError("CONVEX_URL must be a valid Convex deployment URL (ending with .cloud)")
    
    # Convert from .cloud to .site for HTTP routes
    deployment_url = convex_url.replace(".cloud", ".site")
        
    url = f"{deployment_url}/sync"
    
    response = requests.get(url)
    response.raise_for_status()  # Raise an exception for HTTP errors
    
    return response.json()

def main():
    parser = argparse.ArgumentParser(description="Sync Limitless data with Convex")
    parser.add_argument("--now", action="store_true", help="Run sync immediately")
    parser.add_argument("--show", action="store_true", help="Show the last lifelog entry")
    parser.add_argument("--http", action="store_true", help="Trigger sync via HTTP endpoint")
    parser.add_argument("--quiet", action="store_true", help="Don't send Slack notification")
    parser.add_argument("delay", nargs="?", help="Delay for sync (e.g. 10s, 1m, 1h, 1d)", default=None)
    args = parser.parse_args()
    
    client = get_client()
    
    # Use the global setting by default, override only if --quiet is specified
    send_notification = SEND_SLACK_NOTIFICATION
    if args.quiet:
        send_notification = False
    
    if args.show:
        print("Showing last lifelog entry...")
        show_last_lifelog(client, send_notification)
        print("Done")
    elif args.http:
        print("Triggering sync via HTTP endpoint...")
        response = trigger_sync_http()
        print(f"Response: {response}")
    elif args.delay:
        value = args.delay[:-1]
        unit = args.delay[-1].lower()
        
        try:
            value = int(value)
            if unit == 's':
                print(f"Scheduling sync in {value} seconds...")
                sync_later(client, seconds=value)
            elif unit == 'm':
                print(f"Scheduling sync in {value} minutes...")
                sync_later(client, minutes=value)
            elif unit == 'h':
                print(f"Scheduling sync in {value} hours...")
                sync_later(client, hours=value)
            elif unit == 'd':
                print(f"Scheduling sync in {value} days...")
                sync_later(client, days=value)
            else:
                print(f"Invalid time unit: {unit}. Use s, m, h, or d.")
        except ValueError:
            print(f"Invalid delay format: {args.delay}. Use format like 10s, 1m, 1h, 1d.")
    elif args.now:  # Default to immediate sync
        print("Running immediate sync...")
        sync_now(client, send_notification)
        print("Sync complete")
    else:
        # print("No action specified. Use --now to run sync immediately.")
        sync_later(client)
        print("All taken care of!")

if __name__ == "__main__":
    main()