# Convex Integration with Limitless API

You can port data easily from the Limitless pendant to a Convex database. All you need is a Limitless API key to start.

## Benefits

- **Scheduled Syncs**: Automate data transfers on your preferred schedule
- **Full Lifelog Management**: Maintain ownership and control of your personal data
- **Type Safety**: Seamlessly integrates with TypeScript/Python applications
- **Scalable Queries**: Handle large datasets with Convex's optimized engine
- **Deployment Options**: Self-host or use Convex's cloud infrastructure

## Installation
```bash
git clone https://github.com/TanGentleman/limitless-convex-db
cd limitless-convex-db/convex-app
npm install
```

## Setup
1. Set environment variables:

   **Required:**
   ```bash
   npx convex env set LIMITLESS_API_KEY=your_limitless_api_key
   ```

   **Optional:**
   ```bash
   # For Slack notifications on sync completion
   npx convex env set SLACK_WEBHOOK_URL=your_slack_webhook_url
   
   # For timezone-aware lifelog processing (defaults to UTC)
   npx convex env set TIMEZONE="America/Los_Angeles"
   ```

   > **Alternative**: You can also set these variables from the [Convex dashboard](https://dashboard.convex.dev/)

2. Start development server:
```bash
npm run dev
```

   > **Note**: Your deployment URL will be displayed in the console output (e.g., `https://your-deployment.convex.cloud`)

## Usage

### Node.js (Convex CLI)
Run manual sync:
```bash
npx convex run dashboard/sync:runSync
```

### Python Scripts
Powerful Python tools for syncing and querying data:

| Script | Description |
|--------|-------------|
| [`sync.py`](python-src/sync.py) | Trigger/schedule data syncs |
| [`fetch_latest_lifelog.py`](python-src/fetch_latest_lifelog.py) | Retrieve and display lifelogs |

See [python-src/README.md](python-src/README.md) for full documentation and examples.

## Python Quick Start
```bash
cd python-src
pip install -r requirements.txt

# Run immediate sync
python sync.py --now

# Fetch latest lifelog
python fetch_latest_lifelog.py
```

## Support

If you encounter any issues or have questions about this integration, please feel free to open an issue in the repository.

Happy building!

-- Tan