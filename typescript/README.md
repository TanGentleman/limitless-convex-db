# Limitless API TypeScript Examples

This directory contains TypeScript examples for using the Limitless API. These examples demonstrate how to:

- Fetch lifelogs from the API
- Export lifelogs as markdown
- Summarize lifelogs using OpenAI

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file in the root directory with your API keys:

```
LIMITLESS_API_KEY=your_limitless_api_key
OPENAI_API_KEY=your_openai_api_key
LIMITLESS_API_URL=https://api.limitless.ai  # Optional, defaults to this value
```

## Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run export-markdown` - Run the markdown export example
- `npm run summarize-day` - Run the lifelog summarization example

## Examples

### Export Markdown

The `export_markdown.ts` script demonstrates how to fetch and export lifelogs as markdown. By default, it fetches the most recent lifelog.

### Summarize Day

The `summarize_day.ts` script shows how to fetch lifelogs and use OpenAI to generate a summary. It fetches the 10 most recent lifelogs by default.

## API Client

The `_client.ts` file contains the core API client functionality. It provides a `getLifelogs` function that handles pagination and supports various options for fetching lifelogs.
