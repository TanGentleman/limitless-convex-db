# Convex Integration with Limitless API

You can port data easily from the Limitless pendant to a Convex database. All you need is a Limitless API key to start.

## Benefits

- **Scheduled Syncs**: Automate data transfers on your preferred schedule
- **Full Lifelog Management**: Maintain ownership and control of your personal data
- **Type Safety**: Seamlessly integrates with your existing TypeScript/Python applications
- **Scalable Queries**: Handle large datasets with Convex's optimized query engine
- **Deployment Options**: Self-host or use Convex's cloud infrastructure

## Quick Start

1. Navigate to the project directory:
   ```bash
   cd convex-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Obtain your Convex deployment URL from the console output:
   ```
   https://your-deployment.convex.cloud
   ```

5. Set environment variables (This is important!):
   - Via [Convex Dashboard](https://dashboard.convex.dev/): Add `LIMITLESS_API_KEY`
  
   - Or via CLI:
   ```bash
   npx convex env set LIMITLESS_API_KEY=your_limitless_api_key
   ```
   - Optionally add `SLACK_WEBHOOK_URL` to enable Slack notifications
   - Optionally add `TIMEZONE` to make the timezone available to the backend, such as `America/Los_Angeles` (IANA timezone name).


6. Run a manual sync to fetch your latest lifelogs from Limitless:
   ```bash
   npx convex run dashboard/sync:runSync
   ```


For Python integration:
   ```bash
   cd python-src
   pip install -r requirements.txt
   python sync.py
   ```
   See `python-src/README.md` for more details.


## Support

If you encounter any issues or have questions about this integration, please feel free to open an issue in the repository.

Happy building!

-- Tan