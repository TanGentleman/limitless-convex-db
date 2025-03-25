# Convex Integration with Limitless API

You can port data easily from the Limitless pendant to a Convex database. All you need is a Limitless API key to start.

Advantages:
- Schedule syncs
- Full lifelog management (It's your data after all)
- Type safety that plays nice with your existing software stack
- Queries scale beautifully, and Convex can be self-hosted

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
   - Via [Convex Dashboard](https://dashboard.convex.dev/): Add `LIMITLESS_API_KEY` and `TIMEZONE`
   - Or via CLI:
     ```bash
     npx convex env set LIMITLESS_API_KEY=your_limitless_api_key
     npx convex env set TIMEZONE=your_IANA_timezone
     ```

6. (Optional) For Python integration, see `python-src/README.md`

## Requirements

- Limitless API key
- Convex Deployment URL

## License

MIT licensed. Have fun!

