import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { formatDate } from './extras/utils';
import { LifelogQueryParams, LifelogRequest } from './types';
import { convertToLimitlessFormat } from './types';
import { dateParamToTimestamp } from './dateUtils';

const http = httpRouter();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Every route needs the same X-API-Key as the Limitless API (LIMITLESS_API_KEY).
 * Returns an error response, or null when the key matches. Fails closed when
 * LIMITLESS_API_KEY is unset.
 */
function checkApiKey(request: Request): Response | null {
  const expected = process.env.LIMITLESS_API_KEY;
  if (!expected) {
    console.error('LIMITLESS_API_KEY is not set in env vars');
    return jsonResponse({ error: 'Server is not configured' }, 500);
  }
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) {
    return jsonResponse({ error: 'Unauthorized: Missing API key' }, 401);
  }
  if (!constantTimeEqual(apiKey, expected)) {
    return jsonResponse({ error: 'Unauthorized: Invalid API key' }, 401);
  }
  return null;
}

/**
 * Parses URL parameters and returns both LifelogRequest and database query parameters
 * @param params URLSearchParams object containing the query parameters
 * @returns Object containing both LifelogRequest and database query parameters
 */
function parseLifelogHttpParams(params: URLSearchParams): {
  requestOptions: LifelogRequest;
  queryParams: LifelogQueryParams;
} {
  const defaultDirection = 'asc';
  const defaultLimit = 10;  

  // Build LifelogRequest from query parameters
  const requestOptions: LifelogRequest = {
    timezone: params.get('timezone') ?? undefined,
    date: params.get('date') ?? undefined,
    start: params.get('start') ?? undefined,
    end: params.get('end') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
    direction: (params.get('direction') ?? defaultDirection) as 'asc' | 'desc',
    includeMarkdown:
      params.get('includeMarkdown') === 'false' ? false : undefined,
    includeHeadings:
      params.get('includeHeadings') === 'false' ? false : undefined,
    limit: params.has('limit')
      ? parseInt(params.get('limit') as string)
      : undefined,
  };

  // Parse date parameter and calculate time boundaries
  const dateTimestamp = requestOptions.date
    ? dateParamToTimestamp(requestOptions.date, requestOptions.timezone)
    : undefined;

  const startTime = requestOptions.start
    ? new Date(requestOptions.start).getTime()
    : dateTimestamp;

  // Set end time to exactly 24 hours after start time if using date parameter
  const endTime = requestOptions.end
    ? new Date(requestOptions.end).getTime()
    : dateTimestamp && startTime !== undefined
    ? startTime + 86400000 // Add exactly 24 hours (86400000 ms)
    : undefined;

  // log the start and end times in the timezone
  // console.log("startTime", startTime, "endTime", endTime, "timezone", requestOptions.timezone,
  //   startTime ? new Date(startTime).toLocaleString('en-US', { timeZone: requestOptions.timezone }) : undefined,
  //   endTime ? new Date(endTime).toLocaleString('en-US', { timeZone: requestOptions.timezone }) : undefined);
  // Build database query parameters
  const queryParams = {
    startTime,
    endTime,
    direction: requestOptions.direction ?? defaultDirection,
    paginationOpts: {
      numItems: requestOptions.limit ?? defaultLimit,
      cursor: requestOptions.cursor || null,
    },
  };

  return {
    requestOptions,
    queryParams,
  };
}

/**
 * Endpoint: /sync
 * Method: GET
 * Description: Triggers a sync operation to fetch and process new Limitless data
 * Authentication: Requires the X-API-Key header
 * Response: JSON with sync status, timestamp, and whether new entries were added
 */
http.route({
  path: '/sync',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = checkApiKey(request);
    if (denied) return denied;
    try {
      const isNewLifelogs = await ctx.runAction(
        internal.dashboard.sync.runSync,
        {
          sendNotification: true,
        },
      );
      // Return appropriate response
      return new Response(
        JSON.stringify({
          success: true,
          timestamp: formatDate(new Date()),
          newEntriesAdded: isNewLifelogs,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      console.error('Error in sync HTTP action:', 'See Dev logs.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'An unexpected error occurred during sync',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }
  }),
});

/**
 * Endpoint: /v1/lifelogs
 * Method: GET
 * Description: Retrieves lifelogs with optional filtering and pagination
 * Authentication: Requires the X-API-Key header
 * Query Parameters:
 *   - timezone: User's timezone for date calculations
 *   - date: Specific date to filter by
 *   - start: Start timestamp for range filtering
 *   - end: End timestamp for range filtering
 *   - cursor: Pagination cursor for fetching next batch
 *   - direction: Sort direction ('asc' or 'desc') (default: 'asc')
 *   - includeMarkdown: Whether to include markdown content (default: true)
 *   - includeHeadings: Whether to include headings (default: true)
 *   - limit: Maximum number of records to return (default: 10)
 * Response: JSON with lifelogs data and pagination metadata
 */
http.route({
  path: '/v1/lifelogs',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    try {
      const denied = checkApiKey(request);
      if (denied) return denied;

      // Parse query parameters from URL
      const url = new URL(request.url);
      const { requestOptions, queryParams } = parseLifelogHttpParams(
        url.searchParams,
      );

      // Read lifelogs using internal query
      const convexLifelogs = await ctx.runQuery(
        internal.lifelogs.paginatedDocs,
        queryParams,
      );

      // Convert lifelogs to Limitless format
      const limitlessLifelogs = convertToLimitlessFormat(convexLifelogs.page);

      // filter markdown and headings if requested
      if (requestOptions.includeMarkdown === false) {
        limitlessLifelogs.forEach((lifelog) => {
          lifelog.markdown = null;
        });
      }

      if (requestOptions.includeHeadings === false) {
        limitlessLifelogs.forEach((lifelog) => {
          lifelog.contents = lifelog.contents.filter(
            (content) =>
              content.type !== 'heading1' &&
              content.type !== 'heading2' &&
              content.type !== 'heading3',
          );
        });
      }

      // Format the response according to OpenAPI schema
      return new Response(
        JSON.stringify({
          data: {
            lifelogs: limitlessLifelogs,
          },
          meta: {
            lifelogs: {
              nextCursor: convexLifelogs.continueCursor || null,
              count: limitlessLifelogs.length,
              // TODO: Add isDone to the response
              // isDone: convexLifelogs.isDone || false,
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        },
      );
    } catch (error) {
      console.error('Error in lifelogs HTTP action:', 'See Dev logs.');
      return new Response(
        JSON.stringify({
          error: 'An unexpected error occurred during lifelogs retrieval',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }
  }),
});

/**
 * Endpoint: /v1/search
 * Method: GET
 * Description: Retrieves paginated lifelogs using full text search.
 * Authentication: Requires the X-API-Key header
 * Query Parameters:
 *   - query: Search query string
 *   - start: Start timestamp for range filtering
 *   - end: End timestamp for range filtering
 *   - cursor: Pagination cursor for fetching next batch
 *   - limit: Maximum number of records to return (default: 10)
 * Response: JSON with lifelogs data and pagination metadata
 */
http.route({
  path: '/v1/search',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    try {
      const denied = checkApiKey(request);
      if (denied) return denied;

      // Parse query parameters from URL
      const url = new URL(request.url);
      const query = url.searchParams.get('query');
      if (!query) {
        return new Response(
          JSON.stringify({
        error: 'Missing required query parameter: query',
          }),
          {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
          },
        );
      }
      
      const paginationOpts = {
        numItems: url.searchParams.has('limit')
          ? parseInt(url.searchParams.get('limit') as string)
          : 10, // Default limit
        cursor: url.searchParams.get('cursor') || null,
      };
      const startTime = url.searchParams.get('startTime') ?? undefined
      const endTime = url.searchParams.get('endTime') ?? undefined;
      
      // TODO: Implement isStarred filter
      const isStarred = url.searchParams.get('isStarred') === 'true' ? true : undefined;

      const args = {
        query,
        startTime: startTime ? parseInt(startTime) : undefined,
        endTime: endTime ? parseInt(endTime) : undefined,
        paginationOpts,
      };
      // Full text search using internal query
      const searchResults = await ctx.runQuery(
        internal.lifelogs.searchMarkdown,
        args,
      );

      // Format the response according to OpenAPI schema
      return new Response(
        JSON.stringify({
          data: {
            results: searchResults.page,
          },
          meta: {
            lifelogs: {
              nextCursor: searchResults.continueCursor || null,
              count: searchResults.page.length,
              // TODO: Add isDone to the response
              // isDone: convexLifelogs.isDone || false,
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        },
      );
    } catch (error) {
      console.error('Error in lifelogs HTTP action:', 'See Dev logs.');
      return new Response(
        JSON.stringify({
          error: 'An unexpected error occurred during lifelogs retrieval',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }
  }),
});

// Add OPTIONS handlers for CORS support
for (const path of ['/sync', '/v1/lifelogs', '/v1/search']) {
  http.route({
    path,
    method: 'OPTIONS',
    handler: httpAction(async () => {
      return new Response(null, {
        status: 204,
        headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
      });
    }),
  });
}

export default http;
