#!/usr/bin/env python
from lifelog.core.data_manager import LifelogDataManager
from lifelog.core.api_client import LifelogAPIClient
from lifelog.commands.export import export_markdown
from lifelog.utils.helpers import load_environment

def main():
    # Load environment variables
    load_environment()
    
    # Initialize components
    data_manager = LifelogDataManager()
    
    # Check if API call is needed
    if data_manager.is_api_call_needed(freshness_threshold_minutes=20):
        print("Fetching fresh data...")
        api_client = LifelogAPIClient()
        lifelogs = api_client.get_lifelogs(limit=5)
        data_manager.save_lifelogs(lifelogs)
    else:
        print("Using cached data...")
        lifelogs = data_manager.get_lifelogs(limit=5)
    
    # Export to stdout
    export_markdown(lifelogs, stdout=True)

if __name__ == "__main__":
    main() 