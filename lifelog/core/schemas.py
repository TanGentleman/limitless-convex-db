from dataclasses import dataclass, field
from typing import List, Optional, Union, Literal, Any
from datetime import datetime

@dataclass
class ContentItem:
    type: Union[Literal["heading1"], Literal["heading2"], Literal["blockquote"]]
    content: str
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    start_offset_ms: Optional[int] = None
    end_offset_ms: Optional[int] = None
    children: Optional[List[Any]] = field(default_factory=list)
    speaker_name: Optional[str] = None
    speaker_identifier: Optional[Union[Literal["user"], None]] = None

@dataclass
class Lifelog:
    id: str
    title: str
    markdown: str
    contents: List[ContentItem]
    timestamp: Optional[int] = None  # Unix timestamp (milliseconds since epoch)

@dataclass
class Metadata:
    local_sync_time: str  # ISO-8601 string
    local_log_count: int
    cloud_sync_time: str  # ISO-8601 string
    cloud_log_count: int
    ids: List[str] = field(default_factory=list)

# Helper functions for conversion between Python and JSON representations
def lifelog_to_dict(lifelog: Lifelog) -> dict:
    """Convert a Lifelog object to a dictionary suitable for JSON serialization"""
    return {
        "id": lifelog.id,
        "title": lifelog.title,
        "markdown": lifelog.markdown,
        "contents": [content_item_to_dict(item) for item in lifelog.contents],
        "timestamp": lifelog.timestamp
    }

def content_item_to_dict(item: ContentItem) -> dict:
    """Convert a ContentItem object to a dictionary suitable for JSON serialization"""
    result = {
        "type": item.type,
        "content": item.content
    }
    
    if item.start_time is not None:
        result["startTime"] = item.start_time
    if item.end_time is not None:
        result["endTime"] = item.end_time
    if item.start_offset_ms is not None:
        result["startOffsetMs"] = item.start_offset_ms
    if item.end_offset_ms is not None:
        result["endOffsetMs"] = item.end_offset_ms
    if item.children:
        result["children"] = [content_item_to_dict(child) for child in item.children]
    if item.speaker_name is not None:
        result["speakerName"] = item.speaker_name
    if item.speaker_identifier is not None:
        result["speakerIdentifier"] = item.speaker_identifier
    
    return result

def dict_to_lifelog(data: dict) -> Lifelog:
    """Convert a dictionary to a Lifelog object"""
    return Lifelog(
        id=data["id"],
        title=data["title"],
        markdown=data["markdown"],
        contents=[dict_to_content_item(item) for item in data["contents"]],
        timestamp=data.get("timestamp")
    )

def dict_to_content_item(data: dict) -> ContentItem:
    """Convert a dictionary to a ContentItem object"""
    children = None
    if "children" in data and data["children"]:
        children = [dict_to_content_item(child) for child in data["children"]]
    
    return ContentItem(
        type=data["type"],
        content=data["content"],
        start_time=data.get("startTime"),
        end_time=data.get("endTime"),
        start_offset_ms=data.get("startOffsetMs"),
        end_offset_ms=data.get("endOffsetMs"),
        children=children,
        speaker_name=data.get("speakerName"),
        speaker_identifier=data.get("speakerIdentifier")
    )

def metadata_to_dict(metadata: Metadata) -> dict:
    """Convert a Metadata object to a dictionary suitable for JSON serialization"""
    return {
        "localSyncTime": metadata.local_sync_time,
        "localLogCount": metadata.local_log_count,
        "cloudSyncTime": metadata.cloud_sync_time,
        "cloudLogCount": metadata.cloud_log_count,
        "ids": metadata.ids
    }

def dict_to_metadata(data: dict) -> Metadata:
    """Convert a dictionary to a Metadata object"""
    return Metadata(
        local_sync_time=data["localSyncTime"],
        local_log_count=data["localLogCount"],
        cloud_sync_time=data["cloudSyncTime"],
        cloud_log_count=data["cloudLogCount"],
        ids=data.get("ids", [])
    )
