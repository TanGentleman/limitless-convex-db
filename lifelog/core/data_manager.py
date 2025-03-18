import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
from convex import ConvexClient

from lifelog.core.schemas import (
    Lifelog, Metadata,
    lifelog_to_dict, dict_to_lifelog,
    metadata_to_dict, dict_to_metadata
)

class LifelogDataManager:
    """
    Manages local storage and retrieval of lifelog data with efficient
    caching and data validation using strongly typed schema objects.
    """
    
    def __init__(self, data_dir: Union[str, Path] = "data", convex_url: Optional[str] = None):
        """
        Initialize the data manager with a data directory and Convex client
        
        Args:
            data_dir: Path to store data files (will be created if doesn't exist)
            convex_url: URL for Convex backend
        """
        self.data_dir = Path(data_dir)
        self.ensure_data_dir()
        self.db_file = self.data_dir / "lifelogs_db.json"
        self._cache = None  # In-memory cache
        
        if convex_url:
            self.convex_client = ConvexClient(convex_url)
        else:
            self.convex_client = None
    
    def ensure_data_dir(self) -> None:
        """Ensure the data directory exists"""
        self.data_dir.mkdir(parents=True, exist_ok=True)
    
    def save_lifelogs(self, lifelogs: List[Lifelog]) -> Path:
        """
        Save lifelogs to both local storage and Convex
        
        Args:
            lifelogs: List of Lifelog objects to save
            
        Returns:
            Path to the database file
        """
        if not lifelogs:
            return self.db_file
            
        # Save to local storage
        timestamp = datetime.now().isoformat()
        db = self.load_database()
        
        for lifelog in lifelogs:
            db["lifelogs"][lifelog.id] = lifelog_to_dict(lifelog)
        
        db["metadata"]["last_updated"] = timestamp
        db["metadata"]["total_entries"] = len(db["lifelogs"])
        
        with open(self.db_file, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
        
        self._cache = db
        
        # Save to Convex if configured
        if self.convex_client:
            try:
                # Convert to dictionary format for API
                lifelog_dicts = [lifelog_to_dict(log) for log in lifelogs]
                self.convex_client.mutation("lifelogs:batchAdd", {
                    "lifelogs": lifelog_dicts
                })
            except Exception as e:
                print(f"Error saving to Convex: {e}")
        
        return self.db_file
    
    def load_database(self) -> Dict[str, Any]:
        """
        Load the lifelog database or create a new one if it doesn't exist
        
        Returns:
            The database as a dictionary
        """
        # Return cached version if available
        if self._cache is not None:
            return self._cache
            
        if self.db_file.exists():
            with open(self.db_file, 'r', encoding='utf-8') as f:
                try:
                    db = json.load(f)
                    self._cache = db
                    return db
                except json.JSONDecodeError:
                    # Handle corrupted file
                    default_db = {"lifelogs": {}, "metadata": {"last_updated": None, "total_entries": 0}}
                    self._cache = default_db
                    return default_db
        else:
            default_db = {"lifelogs": {}, "metadata": {"last_updated": None, "total_entries": 0}}
            self._cache = default_db
            return default_db
    
    def get_lifelogs(self, 
                    limit: Optional[int] = None, 
                    direction: str = "desc",
                    start_date: Optional[str] = None,
                    end_date: Optional[str] = None) -> List[Lifelog]:
        """
        Retrieve lifelogs from local storage or Convex
        
        Args:
            limit: Maximum number of lifelogs to return
            direction: Sort direction ('asc' or 'desc')
            start_date: Optional start date filter (ISO format)
            end_date: Optional end date filter (ISO format)
            
        Returns:
            List of Lifelog objects
        """
        # Try Convex first if configured
        if self.convex_client:
            try:
                convex_logs = self.convex_client.query("lifelogs:get", {
                    "limit": limit,
                    "start_date": start_date,
                    "end_date": end_date
                })
                
                if convex_logs:
                    # Convert to Lifelog objects
                    lifelogs = [dict_to_lifelog(dict(log)) for log in convex_logs]
                    lifelogs.sort(
                        key=lambda x: x.timestamp if x.timestamp else 0,
                        reverse=(direction.lower() == "desc")
                    )
                    return lifelogs[:limit] if limit else lifelogs
            except Exception as e:
                print(f"Error fetching from Convex: {e}")
        
        # Fall back to local storage
        db = self.load_database()
        lifelogs = [dict_to_lifelog(log_dict) for log_dict in db["lifelogs"].values()]
        
        # Apply date filters if provided
        if start_date or end_date:
            filtered_logs = []
            start_dt = datetime.fromisoformat(start_date) if start_date else None
            end_dt = datetime.fromisoformat(end_date) if end_date else None
            
            for log in lifelogs:
                if log.timestamp is None:
                    continue
                    
                try:
                    # Convert timestamp (ms since epoch) to datetime
                    log_dt = datetime.fromtimestamp(log.timestamp / 1000)
                    if start_dt and log_dt < start_dt:
                        continue
                    if end_dt and log_dt > end_dt:
                        continue
                    filtered_logs.append(log)
                except (ValueError, TypeError):
                    continue
                    
            lifelogs = filtered_logs
        
        # Sort by timestamp
        lifelogs.sort(
            key=lambda x: x.timestamp if x.timestamp else 0,
            reverse=(direction.lower() == "desc")
        )
        
        # Apply limit if specified
        if limit and isinstance(limit, int) and limit > 0:
            lifelogs = lifelogs[:limit]
            
        return lifelogs
    
    def is_api_call_needed(self, freshness_threshold_minutes: int = 10) -> bool:
        """
        Determine if an API call is needed based on data freshness
        
        Args:
            freshness_threshold_minutes: Maximum age of data in minutes before refresh is needed
            
        Returns:
            True if API call is needed, False if local data is fresh enough
        """
        db = self.load_database()
        
        # If no data exists, definitely need an API call
        if not db["lifelogs"]:
            return True
            
        # Check when the database was last updated
        last_updated = db["metadata"].get("last_updated")
        if not last_updated:
            return True
            
        try:
            # Parse the last updated timestamp
            last_updated_dt = datetime.fromisoformat(last_updated)
            
            # Calculate how old the data is
            current_time = datetime.now()
            data_age = current_time - last_updated_dt
            
            # If data is older than threshold, need a refresh
            return data_age > timedelta(minutes=freshness_threshold_minutes)
        except (ValueError, TypeError):
            # If there's any issue parsing the timestamp, be safe and refresh
            return True
    
    def get_most_recent_timestamp(self) -> Optional[int]:
        """
        Get the timestamp of the most recent lifelog entry
        
        Returns:
            Unix timestamp (milliseconds) or None if no entries exist
        """
        lifelogs = self.get_lifelogs(limit=1, direction="desc")
        if lifelogs:
            return lifelogs[0].timestamp
        return None
        
    def save_summary(self, 
                    summary: str, 
                    lifelogs: List[Lifelog], 
                    date: Optional[str] = None) -> Path:
        """
        Save the summary and related lifelogs to a JSON file
        
        Args:
            summary: The generated summary text
            lifelogs: List of Lifelog objects that were summarized
            date: Optional date string for the filename (YYYY-MM-DD)
            
        Returns:
            Path to the saved summary file
        """
        date_str = date or datetime.now().strftime("%Y-%m-%d")
        summary_file = self.data_dir / f"summary_{date_str}.json"
        
        summary_data = {
            "summary": summary,
            "generated_at": datetime.now().isoformat(),
            "lifelog_count": len(lifelogs),
            "lifelog_ids": [lifelog.id for lifelog in lifelogs],
            "date": date_str
        }
        
        with open(summary_file, 'w', encoding='utf-8') as f:
            json.dump(summary_data, f, indent=2, ensure_ascii=False)
        
        return summary_file
    
    def get_summary(self, date: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieve a summary by date
        
        Args:
            date: Date string in YYYY-MM-DD format
            
        Returns:
            Summary data dictionary or None if not found
        """
        date_str = date or datetime.now().strftime("%Y-%m-%d")
        summary_file = self.data_dir / f"summary_{date_str}.json"
        
        if summary_file.exists():
            with open(summary_file, 'r', encoding='utf-8') as f:
                try:
                    return json.load(f)
                except json.JSONDecodeError:
                    return None
        return None
        
    def export_markdown(self, lifelogs: List[Lifelog], output_file: Optional[Path] = None) -> Optional[Path]:
        """
        Export lifelogs to a markdown file
        
        Args:
            lifelogs: List of Lifelog objects to export
            output_file: Optional output file path
            
        Returns:
            Path to the output file or None if no output file was specified
        """
        if not output_file:
            # If no output file specified, just return None - caller will handle output
            return None
            
        with open(output_file, 'w', encoding='utf-8') as f:
            for lifelog in lifelogs:
                markdown = lifelog.markdown
                if not markdown:
                    # Create simple markdown if none exists
                    timestamp = lifelog.timestamp
                    if timestamp:
                        try:
                            dt = datetime.fromtimestamp(timestamp / 1000)
                            formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                        except (ValueError, TypeError):
                            formatted_time = "Unknown time"
                    else:
                        formatted_time = "Unknown time"
                        
                    # Generate simple markdown from title and contents
                    markdown = f"## {lifelog.title}\n\n"
                    for item in lifelog.contents:
                        markdown += f"{item.content}\n\n"
                
                f.write(markdown + "\n\n")
                
        return output_file

    def save_metadata(self, metadata: Metadata) -> None:
        """
        Save metadata to the database
        
        Args:
            metadata: Metadata object to save
        """
        db = self.load_database()
        db["metadata"] = metadata_to_dict(metadata)
        
        with open(self.db_file, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
        
        self._cache = db
    
    def get_metadata(self) -> Metadata:
        """
        Get the current metadata
        
        Returns:
            Metadata object with current values or default values if not found
        """
        db = self.load_database()
        if "metadata" in db and isinstance(db["metadata"], dict):
            try:
                # Attempt to convert the existing metadata
                return dict_to_metadata(db["metadata"])
            except KeyError:
                # If the metadata is missing required fields, fall back to defaults
                pass
        
        # Return default metadata
        return Metadata(
            local_sync_time=datetime.now().isoformat(),
            local_log_count=len(db.get("lifelogs", {})),
            cloud_sync_time=datetime.now().isoformat(),
            cloud_log_count=0,
            ids=[]
        ) 