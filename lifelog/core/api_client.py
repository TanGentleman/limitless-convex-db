import os
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
import tzlocal

class LifelogAPIClient:
    """Client for interacting with the Lifelog API"""
    
    def __init__(self, api_key: Optional[str] = None):
        """
        Initialize the API client
        
        Args:
            api_key: The API key for authentication
        """
        self.api_key = api_key or os.getenv("LIMITLESS_API_KEY")
        if not self.api_key:
            raise ValueError("API key is required. Set LIMITLESS_API_KEY environment variable or pass directly.")
        
    def get_lifelogs(self, 
                    limit: int = 50, 
                    batch_size: int = 10,
                    includeMarkdown: bool = True,
                    includeHeadings: bool = False,
                    date: Optional[str] = None,
                    timezone: Optional[str] = None,
                    direction: str = "asc") -> List[Dict[str, Any]]:
        """
        Fetch lifelogs from the API
        
        Args:
            limit: Maximum number of lifelogs to return
            batch_size: Number of lifelogs to fetch per request
            includeMarkdown: Whether to include markdown in the response
            includeHeadings: Whether to include headings in the response
            date: Optional date filter (YYYY-MM-DD format)
            timezone: Optional timezone for date filtering
            direction: Sort direction ("asc" or "desc")
            
        Returns:
            List of lifelog entries
        """
        all_lifelogs = []
        cursor = None
        
        # If limit is None, fetch all available lifelogs
        # Otherwise, set a batch size (e.g., 10) and fetch until we reach the limit
        if limit is not None:
            batch_size = min(batch_size, limit)
        
        while True:
            params = {  
                "limit": batch_size,
                "includeMarkdown": "true" if includeMarkdown else "false",
                "includeHeadings": "false" if includeHeadings else "true",
                "date": date,
                "direction": direction,
                "timezone": timezone if timezone else str(tzlocal.get_localzone())
            }
            
            # Add cursor for pagination if we have one
            if cursor:
                params["cursor"] = cursor
                
            response = requests.get(
                "https://api.limitless.ai/v1/lifelogs",
                headers={"X-API-Key": self.api_key},
                params=params,
            )

            if not response.ok:
                raise Exception(f"HTTP error! Status: {response.status_code}")

            data = response.json()
            lifelogs = data.get("data", {}).get("lifelogs", [])
            
            # Add transcripts from this batch
            for lifelog in lifelogs:
                all_lifelogs.append(lifelog)
            
            # Check if we've reached the requested limit
            if limit is not None and len(all_lifelogs) >= limit:
                return all_lifelogs[:limit]
            
            # Get the next cursor from the response
            next_cursor = data.get("meta", {}).get("lifelogs", {}).get("nextCursor")
            
            # If there's no next cursor or we got fewer results than requested, we're done
            if not next_cursor or len(lifelogs) < batch_size:
                break
                
            cursor = next_cursor
        
        return all_lifelogs