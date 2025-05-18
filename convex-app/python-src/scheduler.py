# This file is pure boilerplate, but shows how you can easily schedule syncs!

from sync import sync_later

"""
Schedule recurring Limitless data syncs with Convex.

Usage:
    python scheduler.py hourly 6                  # Schedule hourly syncs for the next 6 hours
    python scheduler.py daily 7                   # Schedule daily syncs for the next 7 days
    python scheduler.py weekly 4                  # Schedule weekly syncs for the next 4 weeks
    python scheduler.py hourly 12 --start 22:00   # Schedule 12 hourly syncs starting at 10 PM
    python scheduler.py daily 5 --start 08:30     # Schedule 5 daily syncs starting at 8:30 AM

Arguments:
    interval    Type of interval (hourly, daily, weekly)
    count       Number of sync operations to schedule
    --start     Optional start time in HH:MM format (24-hour)
"""

import argparse
import sys
from datetime import datetime, timedelta
from typing import List, Dict, Any, TypedDict, Optional, Union, Literal

from sync import get_client, sync_later

class ScheduledFunctionStatePending(TypedDict):
    kind: Literal["pending"]

class ScheduledFunctionStateInProgress(TypedDict):
    kind: Literal["inProgress"]

class ScheduledFunctionStateSuccess(TypedDict):
    kind: Literal["success"]

class ScheduledFunctionStateFailed(TypedDict):
    kind: Literal["failed"]
    error: str

class ScheduledFunctionStateCanceled(TypedDict):
    kind: Literal["canceled"]

ScheduledFunctionState = Union[
    ScheduledFunctionStatePending,
    ScheduledFunctionStateInProgress,
    ScheduledFunctionStateSuccess,
    ScheduledFunctionStateFailed,
    ScheduledFunctionStateCanceled
]

class ScheduledFunction(TypedDict):
    # _id: str
    _creationTime: float
    name: str
    # args: List[Any]
    scheduledTime: float
    completedTime: Optional[float]
    state: ScheduledFunctionState

def print_scheduled_syncs() -> List[ScheduledFunction]:
    client = get_client()
    scheduled_syncs = client.query("extras/schedules:listSchedules", {"limit": 10})
    
    # Print the scheduled syncs for debugging
    try:
        print("Scheduled Syncs:")
        for i, sync in enumerate(scheduled_syncs, 1):
            status = sync['state']['kind']
            scheduled_time = datetime.fromtimestamp(sync['scheduledTime']/1000).strftime('%Y-%m-%d %H:%M:%S')
            completed_str = ""
            if sync['completedTime']:
                completed_time = datetime.fromtimestamp(sync['completedTime']/1000).strftime('%Y-%m-%d %H:%M:%S')
                completed_str = f", Completed: {completed_time}"
            
            print(f"  {i}. {sync['name']} - Status: {status}, Scheduled: {scheduled_time}{completed_str}")
        if not scheduled_syncs:
            print("  No scheduled syncs found")
    except Exception as e:
        print(f"Error: {e}")
    
    return scheduled_syncs

def schedule_recurring_syncs(
    interval: str, 
    count: int, 
    start_time: str = None
) -> List[Dict[str, Any]]:
    """
    Schedule multiple sync operations at regular intervals
    
    Args:
        interval: Time interval (hourly, daily, weekly)
        count: Number of sync operations to schedule
        start_time: Optional start time in format HH:MM (24-hour)
        
    Returns:
        List of scheduled sync operations with timestamps
    """
    client = get_client()
    scheduled_syncs = []
    
    # Parse start time if provided
    start_datetime = datetime.now()
    if start_time:
        try:
            hour, minute = map(int, start_time.split(':'))
            current = datetime.now()
            start_datetime = current.replace(hour=hour, minute=minute)
            
            # If specified time is in the past, schedule for tomorrow
            if start_datetime < current:
                start_datetime += timedelta(days=1)
        except ValueError:
            print(f"Invalid time format: {start_time}. Using current time instead.")
            start_datetime = datetime.now()
    
    # Calculate intervals
    for i in range(count):
        if interval == "hourly":
            target_time = start_datetime + timedelta(hours=i)
            seconds_diff = int((target_time - datetime.now()).total_seconds())
            if seconds_diff > 0:
                sync_later(client, seconds=seconds_diff)
                scheduled_syncs.append({
                    "index": i + 1,
                    "scheduled_at": target_time.strftime("%Y-%m-%d %H:%M:%S")
                })
        elif interval == "daily":
            target_time = start_datetime + timedelta(days=i)
            seconds_diff = int((target_time - datetime.now()).total_seconds())
            if seconds_diff > 0:
                sync_later(client, seconds=seconds_diff)
                scheduled_syncs.append({
                    "index": i + 1,
                    "scheduled_at": target_time.strftime("%Y-%m-%d %H:%M:%S")
                })
        elif interval == "weekly":
            target_time = start_datetime + timedelta(weeks=i)
            seconds_diff = int((target_time - datetime.now()).total_seconds())
            if seconds_diff > 0:
                sync_later(client, seconds=seconds_diff)
                scheduled_syncs.append({
                    "index": i + 1,
                    "scheduled_at": target_time.strftime("%Y-%m-%d %H:%M:%S")
                })
    
    return scheduled_syncs


def main():
    parser = argparse.ArgumentParser(description="Schedule recurring Limitless data syncs")
    parser.add_argument("interval", choices=["hourly", "daily", "weekly"], 
                        help="Interval between syncs")
    parser.add_argument("count", type=int, help="Number of syncs to schedule")
    parser.add_argument("--start", type=str, help="Start time in format HH:MM (24-hour)")
    
    if len(sys.argv) == 1:
        parser.print_help()
        return
        
    args = parser.parse_args()
    
    scheduled = schedule_recurring_syncs(args.interval, args.count, args.start)
    
    if scheduled:
        print(f"Successfully scheduled {len(scheduled)} {args.interval} sync operations:")
        for sync in scheduled:
            print(f"  {sync['index']}. Scheduled for: {sync['scheduled_at']}")
    else:
        print("No sync operations were scheduled. Check your parameters.")


if __name__ == "__main__":
    main()