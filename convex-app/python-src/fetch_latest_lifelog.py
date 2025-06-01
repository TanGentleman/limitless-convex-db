"""
Simple script to fetch the latest lifelog entry using Convex's getPreviewLifelog query.
"""

import os
from dotenv import load_dotenv
from convex import ConvexClient
from typing import Optional, TypedDict, List, Union, Any, Literal
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.table import Table
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

class LifelogContent(TypedDict):
    content: str
    type: Literal["heading1", "heading2", "heading3", "blockquote", "paragraph"]
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

def format_timestamp(timestamp: float) -> str:
    """Convert Unix timestamp to human readable format with timezone."""
    # Load environment variables if not already loaded
    load_dotenv()
    
    # Get timezone from environment variable, default to UTC
    timezone_str = os.getenv("TIMEZONE", "UTC")
    try:
        tz = ZoneInfo(timezone_str)
    except ZoneInfoNotFoundError:
        print(f"[yellow]Warning: Unknown timezone '{timezone_str}', falling back to UTC[/yellow]")
        tz = ZoneInfo("UTC")
    
    # Convert timestamp to datetime with timezone
    dt = datetime.fromtimestamp(timestamp/1000).replace(tzinfo=tz)
    
    # Format with AM/PM and timezone abbreviation
    return dt.strftime('%Y-%m-%d %I:%M:%S %p %Z')

def get_latest_lifelog() -> Optional[Lifelog]:
    """
    Fetch the latest lifelog entry using the getPreviewLifelog query.
    
    Returns:
        Optional[Lifelog]: The latest lifelog entry or None if no entries exist
    """
    
    # Get Convex URL from environment
    convex_url = os.getenv("CONVEX_URL")
    if not convex_url:
        raise ValueError("CONVEX_URL not set in .env")
    
    # Initialize Convex client
    client = ConvexClient(convex_url)
    
    # Fetch latest lifelog using the getPreviewLifelog query
    latest_lifelog = client.query("dashboard/previews:getPreviewLifelog")
    
    return latest_lifelog

def main():
    INCLUDE_STRUCTURED_CONTENTS = False
    
    # Load environment variables
    load_dotenv()

    try:
        console = Console()
        latest = get_latest_lifelog()
        
        if latest:
            # Create a table for metadata
            table = Table(show_header=False, box=None)
            table.add_row("Title", latest['title'])
            table.add_row("Start Time", format_timestamp(latest['startTime']))
            table.add_row("End Time", format_timestamp(latest['endTime']))
            table.add_row("Lifelog ID", latest['lifelogId'])
            
            # Display metadata in a panel
            console.print(Panel(table, title="📝 Latest Lifelog Entry", border_style="blue"))
            
            # Display markdown content if present
            if latest['markdown']:
                console.print("\n[bold blue]Markdown Content:[/bold blue]")
                md = Markdown(latest['markdown'])
                console.print(Panel(md, border_style="green"))
            
            # Display structured contents
            if INCLUDE_STRUCTURED_CONTENTS:
                console.print("\n[bold blue]Structured Contents:[/bold blue]")
                for content in latest['contents']:
                    content_type = content['type']
                    content_text = content['content']
                    
                    # Style different content types differently
                    if content_type == "heading1":
                        console.print(f"[bold red]# {content_text}[/bold red]")
                    elif content_type == "heading2":
                        console.print(f"[bold yellow]## {content_text}[/bold yellow]")
                    elif content_type == "heading3":
                        console.print(f"[bold green]### {content_text}[/bold green]")
                    elif content_type == "blockquote":
                        console.print(f"[italic blue]> {content_text}[/italic blue]")
                    elif content_type == "paragraph":
                        console.print(f"[bold blue]{content_text}[/bold blue]")
        else:
            console.print("[red]No lifelog entries found.[/red]")
    except Exception as e:
        console.print(f"[red]Error fetching latest lifelog: {e}[/red]")

if __name__ == "__main__":
    main()