import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional, Union
from convex import ConvexClient

from lifelog.core.schemas import (
    Lifelog, LocalMetadata,
    lifelog_to_dict, dict_to_lifelog
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
        db = self.load_database()
        
        for lifelog in lifelogs:
            db["lifelogs"][lifelog.id] = lifelog_to_dict(lifelog)
        
        # Update metadata
        current_timestamp = datetime.now().isoformat()
        
        # Update meta
        if "meta" not in db:
            db["meta"] = {}
        
        db["meta"]["source_update_time"] = current_timestamp
        db["meta"]["total_entries"] = len(db["lifelogs"])
        db["meta"]["ids"] = list(db["lifelogs"].keys())
        
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
                # Update cloud sync time
                db["meta"]["cloud_update_time"] = current_timestamp
                with open(self.db_file, 'w', encoding='utf-8') as f:
                    json.dump(db, f, indent=2, ensure_ascii=False)
                self._cache = db
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
                    
                    # Ensure we have the required structure
                    if "lifelogs" not in db:
                        db["lifelogs"] = {}
                        
                    # Ensure we have the meta structure
                    if "meta" not in db:
                        db["meta"] = {
                            "source_update_time": datetime.now().isoformat(),
                            "cloud_update_time": None,
                            "total_entries": len(db.get("lifelogs", {})),
                            "ids": list(db.get("lifelogs", {}).keys())
                        }
                    
                    self._cache = db
                    return db
                except json.JSONDecodeError:
                    # Handle corrupted file
                    default_db = self._create_default_db()
                    self._cache = default_db
                    return default_db
        else:
            default_db = self._create_default_db()
            self._cache = default_db
            return default_db
    
    def _create_default_db(self) -> Dict[str, Any]:
        """Create a default database structure"""
        return {
            "lifelogs": {}, 
            "meta": {
                "source_update_time": datetime.now().isoformat(),
                "cloud_update_time": None,
                "total_entries": 0,
                "ids": []
            }
        }
    
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
        last_updated = db["meta"].get("source_update_time")
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

    def get_local_metadata(self) -> LocalMetadata:
        """
        Get the current local metadata
        
        Returns:
            LocalMetadata object with current values
        """
        db = self.load_database()
        
        if "meta" not in db:
            # Create default metadata if it doesn't exist
            meta = {
                "source_update_time": datetime.now().isoformat(),
                "cloud_update_time": None,
                "total_entries": len(db.get("lifelogs", {})),
                "ids": list(db.get("lifelogs", {}).keys())
            }
            db["meta"] = meta
            self._cache = db
        
        return LocalMetadata(**db["meta"])

    def update_local_metadata(self, update_source: bool = True, update_cloud: bool = False) -> LocalMetadata:
        """
        Update the local metadata with current information
        
        Args:
            update_source: Whether to update the source_update_time
            update_cloud: Whether to update the cloud_update_time
        
        Returns:
            Updated LocalMetadata
        """
        db = self.load_database()
        
        if "meta" not in db:
            db["meta"] = {}
        
        current_time = datetime.now().isoformat()
        
        if update_source:
            db["meta"]["source_update_time"] = current_time
        
        if update_cloud:
            db["meta"]["cloud_update_time"] = current_time
        
        # Always update these fields to ensure accuracy
        lifelogs = db.get("lifelogs", {})
        db["meta"]["total_entries"] = len(lifelogs)
        db["meta"]["ids"] = list(lifelogs.keys())
        
        # Save updates to file
        with open(self.db_file, 'w', encoding='utf-8') as f:
            json.dump(db, f, indent=2, ensure_ascii=False)
        
        self._cache = db
        return LocalMetadata(**db["meta"])

    def sync_with_cloud(self, force: bool = False) -> Dict[str, Any]:
        """
        Synchronize local data with cloud data
        
        Args:
            force: Whether to force synchronization regardless of last sync time
            
        Returns:
            Dictionary with sync statistics
        """
        if not self.convex_client:
            return {"success": False, "error": "No Convex client configured"}
        
        local_metadata = self.get_local_metadata()
        
        # If not forcing sync, check if we need to sync based on update times
        if not force:
            if local_metadata["cloud_update_time"]:
                # Check if we've recently synced
                try:
                    cloud_update_time = datetime.fromisoformat(local_metadata["cloud_update_time"])
                    time_since_sync = datetime.now() - cloud_update_time
                    # Skip sync if we've synced in the last 5 minutes
                    if time_since_sync < timedelta(minutes=5):
                        return {
                            "success": True, 
                            "skipped": True,
                            "reason": "Recent sync",
                            "last_sync": local_metadata["cloud_update_time"]
                        }
                except (ValueError, TypeError):
                    # Invalid timestamp format, proceed with sync
                    pass
        
        try:
            # Get all lifelogs from cloud
            cloud_logs = self.convex_client.query("lifelogs:getAll")
            
            # Get local logs
            db = self.load_database()
            local_logs = db.get("lifelogs", {})
            
            # Stats to return
            stats = {
                "success": True,
                "cloud_count": len(cloud_logs),
                "local_count_before": len(local_logs),
                "added_to_local": 0,
                "added_to_cloud": 0,
            }
            
            # Process cloud logs that might not be local
            cloud_ids = set()
            for cloud_log in cloud_logs:
                cloud_ids.add(cloud_log["id"])
                if cloud_log["id"] not in local_logs:
                    # Add cloud log to local storage
                    db["lifelogs"][cloud_log["id"]] = dict(cloud_log)
                    stats["added_to_local"] += 1
            
            # Process local logs that might not be in cloud
            local_ids = set(local_logs.keys())
            missing_from_cloud = local_ids - cloud_ids
            
            if missing_from_cloud:
                # Convert missing logs to proper format and upload
                missing_logs = [local_logs[id] for id in missing_from_cloud]
                if missing_logs:
                    self.convex_client.mutation("lifelogs:batchAdd", {
                        "lifelogs": missing_logs
                    })
                    stats["added_to_cloud"] = len(missing_logs)
            
            # Update metadata
            current_time = datetime.now().isoformat()
            db["meta"]["source_update_time"] = current_time
            db["meta"]["cloud_update_time"] = current_time
            db["meta"]["total_entries"] = len(db["lifelogs"])
            db["meta"]["ids"] = list(db["lifelogs"].keys())
            
            # Save updates
            with open(self.db_file, 'w', encoding='utf-8') as f:
                json.dump(db, f, indent=2, ensure_ascii=False)
            
            self._cache = db
            
            stats["local_count_after"] = len(db["lifelogs"])
            return stats
            
        except Exception as e:
            return {"success": False, "error": str(e)}

    def needs_sync(self) -> bool:
        """
        Check if synchronization with cloud is needed
        
        Returns:
            True if sync is needed, False otherwise
        """
        if not self.convex_client:
            return False
        
        local_metadata = self.get_local_metadata()
        
        # If never synced with cloud, definitely need to sync
        if not local_metadata["cloud_update_time"]:
            return True
        
        try:
            # Compare source and cloud update times
            source_time = datetime.fromisoformat(local_metadata["source_update_time"])
            cloud_time = datetime.fromisoformat(local_metadata["cloud_update_time"])
            
            # If local data was updated after the last cloud sync, we need to sync
            return source_time > cloud_time
        except (ValueError, TypeError):
            # If there's an issue with the timestamps, be safe and sync
            return True 