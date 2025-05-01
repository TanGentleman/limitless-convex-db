"""
Simple script to fetch the latest lifelog entry using Convex's getPreviewLifelog query.
"""

import os
from dotenv import load_dotenv
from convex import ConvexClient
from typing import Optional, TypedDict, List, Union, Any, Literal

class LifelogContent(TypedDict):
    content: str
    type: Literal["heading1", "heading2", "heading3", "blockquote"]
    startTime: Optional[float]
    endTime: Optional[float]
    children: Optional[List[Any]]
    speakerIdentifier: Optional[Union[Literal["user"], None]]
    speakerName: Optional[Union[str, None]]
    startOffsetMs: Optional[float]
    endOffsetMs: Optional[float]

class Lifelog(TypedDict):
    _id: str
    _creationTime: float
    contents: List[LifelogContent]
    embeddingId: str  # ID reference to markdownEmbeddings table
    endTime: float
    lifelogId: str
    markdown: Union[str, None]
    startTime: float
    title: str

def get_latest_lifelog() -> Optional[Lifelog]:
    """
    Fetch the latest lifelog entry using the getPreviewLifelog query.
    
    Returns:
        Optional[Lifelog]: The latest lifelog entry or None if no entries exist
    """
    # Load environment variables
    load_dotenv()
    
    # Get Convex URL from environment
    convex_url = os.getenv("CONVEX_URL")
    if not convex_url:
        raise ValueError("CONVEX_URL not set in .env")
    
    # Initialize Convex client
    client = ConvexClient(convex_url)
    
    # Fetch latest lifelog using the getPreviewLifelog query
    latest_lifelog = client.query("queries/dashboard:getPreviewLifelog")
    
    return latest_lifelog

def main():
    try:
        latest = get_latest_lifelog()
        if latest:
            print("Latest Lifelog Entry:")
            print(f"Title: {latest['title']}")
            print(f"Start Time: {latest['startTime']}")
            print(f"End Time: {latest['endTime']}")
            print(f"Lifelog ID: {latest['lifelogId']}")
            if latest['markdown']:
                print("\nMarkdown Content:")
                print(latest['markdown'])
            print("\nContents:")
            for content in latest['contents']:
                print(f"- {content['type']}: {content['content']}")
        else:
            print("No lifelog entries found.")
    except Exception as e:
        print(f"Error fetching latest lifelog: {e}")

if __name__ == "__main__":
    main() 