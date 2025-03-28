"""
Convex client for syncing Limitless data and scheduling sync operations.

Usage:
    python sync.py --now                # Run sync immediately
    python sync.py --show               # Show the last lifelog entry
    python sync.py 10s                  # Schedule sync in 10 seconds
    python sync.py 5m                   # Schedule sync in 5 minutes
    python sync.py 2h                   # Schedule sync in 2 hours
    python sync.py 1d                   # Schedule sync in 1 day
"""

import os
import argparse
from dotenv import load_dotenv
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
    return client.action("extras/hooks:sync", {"sendNotification": send_notification})

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
    return client.action("extras/hooks:getLastLifelog", {"sendNotification": send_notification})

def main():
    parser = argparse.ArgumentParser(description="Sync Limitless data with Convex")
    parser.add_argument("--now", action="store_true", help="Run sync immediately")
    parser.add_argument("--show", action="store_true", help="Show the last lifelog entry")
    parser.add_argument("delay", nargs="?", help="Delay for sync (e.g. 10s, 1m, 1h, 1d)", default=None)
    args = parser.parse_args()
    
    client = get_client()
    
    if args.show:
        print("Showing last lifelog entry...")
        show_last_lifelog(client, SEND_SLACK_NOTIFICATION)
        print("Done")
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
        sync_now(client, SEND_SLACK_NOTIFICATION)
        print("Sync complete")
    else:
        # print("No action specified. Use --now to run sync immediately.")
        sync_later(client)
        print("All taken care of!")

if __name__ == "__main__":
    main()