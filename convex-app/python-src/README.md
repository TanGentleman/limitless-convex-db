# Python Integration with Convex

# Python Integration with Convex

This integration allows you to interact with your Convex backend from Python applications. You can query data, run mutations, and subscribe to real-time updates using the official Convex Python client.

## Features

- **Query Lifelogs**: Fetch your lifelog entries with filtering options
- **Slack Notifications**: Trigger notifications when new data is available
- **Scheduled Syncs**: Automate data synchronization with cron jobs
- **HTTP Fallback**: Use standard HTTP requests when needed

Check out the `main.py` file for examples of both client-based and HTTP-based interactions with your Convex deployment.


## Prerequisites

Before you begin, ensure you have:

- Python 3.8+ installed
- A Convex project set up and deployed
- Your Convex deployment URL (follow steps in convex-app/README.md)

1. Create a virtual environment:
   ```bash
   cd convex-app/python-src
   python -m venv .venv
   ```

2. Activate the virtual environment:
   - On Windows:
     ```bash
     .venv\Scripts\activate
     ```
   - On macOS/Linux:
     ```bash
     source .venv/bin/activate
     ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
   
   Or install directly:
   ```bash
   pip install convex python-dotenv
   ```

## Configuration

1. Create a `.env` file in the root directory with your Convex URL:
   ```
   CONVEX_URL=your_convex_deployment_url
   ```

   You can find your deployment URL in the Convex dashboard.

## Running the Code

Execute the main script:
```bash
python main.py --help
```
