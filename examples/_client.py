import os
import requests
import tzlocal
from typing import List, Optional, Dict, Any

# from dataclasses import dataclass
# @dataclass
# class LifelogRequest:
#     """
#     Request parameters for retrieving lifelogs.
#     Matches the Limitless API query parameters.
#     """
#     timezone: Optional[str] = None  # IANA timezone specifier. If missing, UTC is used
#     date: Optional[str] = None  # Format: YYYY-MM-DD
#     start: Optional[str] = None  # Modified ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
#     end: Optional[str] = None  # Modified ISO-8601 format (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS)
#     cursor: Optional[str] = None  # Cursor for pagination
#     direction: str = "desc"  # Sort direction: "asc" or "desc"
#     include_markdown: bool = True  # Whether to include markdown content
#     include_headings: bool = False  # Whether to include headings
#     limit: Optional[int] = None  # Maximum number of entries to return

def get_lifelogs(
    api_key: str,
    api_url: str = os.getenv("LIMITLESS_API_URL") or "https://api.limitless.ai",
    endpoint: str = "v1/lifelogs",
    limit: Optional[int] = 50,
    batch_size: int = 10,
    includeMarkdown: bool = True,
    includeHeadings: bool = False,
    date: Optional[str] = None,
    start: Optional[str] = None,
    end: Optional[str] = None,
    timezone: Optional[str] = os.getenv("TIMEZONE") or None,
    direction: str = "asc",
    cursor: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Fetch lifelogs from the Limitless API with pagination support.
    
    Args:
        api_key: API key for authentication
        api_url: Base URL for the API
        endpoint: API endpoint for lifelogs
        limit: Maximum number of lifelogs to return (None for all available)
        batch_size: Number of lifelogs to fetch per request
        includeMarkdown: Whether to include markdown content in the response
        includeHeadings: Whether to include headings in the response
        date: Date filter in YYYY-MM-DD format
        start: Start datetime filter
        end: End datetime filter
        timezone: IANA timezone specifier (defaults to local timezone)
        direction: Sort direction ("asc" or "desc")
        cursor: Initial cursor for pagination
        
    Returns:
        List of lifelog objects
    """
    all_lifelogs = []
    current_cursor = cursor
    
    # If limit is None, fetch all available lifelogs
    # Otherwise, set a batch size and fetch until we reach the limit
    if limit is not None:
        batch_size = min(batch_size, limit)
    
    while True:
        params = {
            "limit": batch_size,
            "includeMarkdown": str(includeMarkdown).lower(),
            "includeHeadings": str(includeHeadings).lower(),
            "direction": direction,
            "timezone": timezone if timezone else str(tzlocal.get_localzone())
        }
        
        # Add optional parameters if provided
        if date:
            params["date"] = date
        if start:
            params["start"] = start
        if end:
            params["end"] = end
        if current_cursor:
            params["cursor"] = current_cursor
            
        response = requests.get(
            f"{api_url}/{endpoint}",
            headers={"X-API-Key": api_key},
            params=params,
        )

        if not response.ok:
            raise Exception(f"HTTP error! Status: {response.status_code}, Response: {response.text}")

        data = response.json()
        lifelogs = data.get("data", {}).get("lifelogs", [])
        
        # Add lifelogs from this batch
        all_lifelogs.extend(lifelogs)
        
        # Check if we've reached the requested limit
        if limit is not None and len(all_lifelogs) >= limit:
            return all_lifelogs[:limit]
        
        # Get the next cursor from the response
        next_cursor = data.get("meta", {}).get("lifelogs", {}).get("nextCursor")
        
        # If there's no next cursor or we got fewer results than requested, we're done
        if not next_cursor or len(lifelogs) < batch_size:
            break
            
        print(f"Fetched {len(lifelogs)} lifelogs, next cursor: {next_cursor}")
        current_cursor = next_cursor
    
    return all_lifelogs
