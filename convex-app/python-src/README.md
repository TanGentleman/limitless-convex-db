# Python Integration

This integration allows you to interact with your Convex backend from Python applications. You can query data, run mutations, and subscribe to real-time updates using the official Convex Python client.

## Features

- **Query Lifelogs**: Fetch your lifelog entries with filtering options
- **Slack Notifications**: Trigger notifications when new data is available
- **Scheduled Syncs**: Automate data synchronization with cron jobs
- **HTTP Fallback**: Use standard HTTP requests when needed

**Usage**:
```bash
python sync.py [options] [delay]
```

- **Options**:
  - `--now`: Run sync immediately
  - `--show`: Show the last lifelog entry
  - `--http`: Trigger sync via HTTP endpoint
  - `--quiet`: Don't send Slack notification

- **Delay**: Schedule sync after specified time interval (e.g., `10s`, `5m`, `2h`, `1d`)

**Examples**:
```bash
# Run sync immediately
python sync.py --now

# Schedule sync in 5 minutes
python sync.py 5m

# Trigger sync via HTTP
python sync.py --http

# Show last lifelog entry without notification
python sync.py --show --quiet
```

### `fetch_latest_lifelog.py`
Fetches and displays the latest lifelog entry from Convex.

**Usage**:
```bash
python fetch_latest_lifelog.py
```

**Features**:
- Displays metadata (title, timestamps, ID)
- Shows formatted markdown content
- Supports timezone configuration via `.env`

**Configuration**:
Create a `.env` file with:
```env
CONVEX_URL=<your_convex_url>
TIMEZONE=<your_timezone>  # Optional, defaults to UTC
```

## Dependencies
Install required packages:
```bash
pip install -r requirements.txt
```

## Environment Setup
1. Create `.env` file with your Convex URL
2. Install dependencies as shown above
