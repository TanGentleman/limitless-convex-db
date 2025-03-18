import json
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional, Union

class LifelogDataManager:
    """
    Manages local storage and retrieval of lifelog data with efficient
    caching and data validation.
    """
    
    def __init__(self, data_dir: Union[str, Path] = "data"):
        """
        Initialize the data manager with a data directory
        
        Args:
            data_dir: Path to store data files (will be created if doesn't exist)
        """
        self.data_dir = Path(data_dir)
        self.ensure_data_dir()
        self.db_file = self.data_dir / "lifelogs_db.json"
        self._cache = None  # In-memory cache
    
    def ensure_data_dir(self) -> None:
        """Ensure the data directory exists"""
        self.data_dir.mkdir(parents=True, exist_ok=True)
    
    def get_lifelog_hash(self, lifelog: Dict[str, Any]) -> str:
        """
        Generate a unique hash for a lifelog entry
        
        Args:
            lifelog: The lifelog entry to hash
            
        Returns:
            A unique hash string for the lifelog
        """
        # Use relevant fields to create a unique identifier
        # Prioritize id and timestamp, but fall back to other fields if needed
        unique_str = f"{lifelog.get('id', '')}-{lifelog.get('timestamp', '')}"
        if not unique_str.strip('-'):  # If no id or timestamp
            content = str(lifelog.get('content', '')) or str(lifelog)
            unique_str = f"{content}-{datetime.now().isoformat()}"
        return hashlib.md5(unique_str.encode()).hexdigest()
    
    def save_lifelogs(self, lifelogs: List[Dict[str, Any]]) -> Path:
        """
        Save lifelogs to the database
        
        Args:
            lifelogs: List of lifelog entries to save
            
        Returns:
            Path to the database file
        """
        if not lifelogs:
            return self.db_file
            
        # Create a timestamp for this update
        timestamp = datetime.now().isoformat()
        
        # Load existing database if it exists
        db = self.load_database()
        
        # Update database with new lifelogs
        for lifelog in lifelogs:
            lifelog_id = self.get_lifelog_hash(lifelog)
            db["lifelogs"][lifelog_id] = lifelog
        
        # Update metadata
        db["metadata"]["last_updated"] = timestamp
        db["metadata"]["total_entries"] = len(db["lifelogs"])
        
        # Save updated database
        with open(self.db_file, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
        
        # Update cache
        self._cache = db
        
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
                    end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieve lifelogs from the local database with optional filtering
        
        Args:
            limit: Maximum number of lifelogs to return
            direction: Sort direction ("asc" or "desc" by timestamp)
            start_date: Filter logs starting from this date (ISO format)
            end_date: Filter logs up to this date (ISO format)
        
        Returns:
            List of lifelog entries
        """
        db = self.load_database()
        lifelogs = list(db["lifelogs"].values())
        
        # Apply date filters if provided
        if start_date or end_date:
            filtered_logs = []
            start_dt = datetime.fromisoformat(start_date) if start_date else None
            end_dt = datetime.fromisoformat(end_date) if end_date else None
            
            for log in lifelogs:
                if "timestamp" not in log:
                    continue
                    
                try:
                    log_dt = datetime.fromisoformat(log["timestamp"])
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
            key=lambda x: x.get("timestamp", ""),
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
    
    def get_most_recent_timestamp(self) -> Optional[str]:
        """
        Get the timestamp of the most recent lifelog entry
        
        Returns:
            ISO timestamp string or None if no entries exist
        """
        lifelogs = self.get_lifelogs(limit=1, direction="desc")
        if lifelogs:
            return lifelogs[0].get("timestamp")
        return None
        
    def save_summary(self, 
                    summary: str, 
                    lifelogs: List[Dict[str, Any]], 
                    date: Optional[str] = None) -> Path:
        """
        Save the summary and related lifelogs to a JSON file
        
        Args:
            summary: The generated summary text
            lifelogs: List of lifelogs that were summarized
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
            "lifelog_ids": [self.get_lifelog_hash(lifelog) for lifelog in lifelogs],
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
        
    def export_markdown(self, lifelogs: List[Dict[str, Any]], output_file: Optional[Path] = None) -> Optional[Path]:
        """
        Export lifelogs to a markdown file
        
        Args:
            lifelogs: List of lifelogs to export
            output_file: Optional output file path
            
        Returns:
            Path to the output file or None if no output file was specified
        """
        if not output_file:
            # If no output file specified, just return None - caller will handle output
            return None
            
        with open(output_file, 'w', encoding='utf-8') as f:
            for lifelog in lifelogs:
                markdown = lifelog.get("markdown", "")
                if not markdown and "content" in lifelog:
                    # Create simple markdown if none exists
                    timestamp = lifelog.get("timestamp", "Unknown time")
                    try:
                        dt = datetime.fromisoformat(timestamp)
                        formatted_time = dt.strftime("%Y-%m-%d %H:%M:%S")
                    except (ValueError, TypeError):
                        formatted_time = timestamp
                        
                    markdown = f"## Entry at {formatted_time}\n\n{lifelog['content']}\n\n"
                
                f.write(markdown + "\n\n")
                
        return output_file 