# Convex Integration with Limitless API

This project provides a Convex backend integration for managing data from the Limitless API.

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

4. Obtain your Convex deployment URL from the console output. It will look like:
   ```
   https://your-deployment.convex.cloud
   ```

5. Create a `.env` file and paste these values into the Convex Dashboard:
   ```
   LIMITLESS_API_KEY=your_limitless_api_key
   TIMEZONE=your_IANA_timezone
   ```

6. (Optional) If using Python integration, follow the setup instructions in `python-src/README.md`

## Features

- Sync Limitless API data to Convex
- Manage and query lifelog data
- Python integration for automated syncs

## Requirements

- Limitless API key
- Convex Deployment URL from Convex