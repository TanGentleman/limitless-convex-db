import { httpRouter } from 'convex/server';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import { formatDate } from './extras/utils';
import { Doc } from './_generated/dataModel';
import { convertToLimitlessFormat, LimitlessLifelog } from './types';
import { dateParamToTimestamp, timeParamToTimestamp, isValidTimezone } from './dateUtils';

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

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

class BadRequest extends Error {}

type LifelogHttpParams = {
  startTime?: number;
  endTime?: number;
  direction: 'asc' | 'desc';
  isStarred?: boolean;
  includeMarkdown: boolean;
  includeHeadings: boolean;
  paginationOpts: { numItems: number; cursor: string | null };
};

function parseBoolean(params: URLSearchParams, name: string): boolean | undefined {
  const value = params.get(name);
  if (value === null) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequest(`${name} must be true or false`);
}

/**
 * Parses the Limitless /v1/lifelogs query parameters (openapi.yml): timezone, date,
 * start, end, cursor, direction, includeMarkdown, includeHeadings, limit, isStarred.
 * `date` (YYYY-MM-DD) and `start`/`end` (YYYY-MM-DD or YYYY-MM-DD HH:mm:SS, offsets
 * ignored) are read in `timezone`, UTC by default. Throws BadRequest on bad input.
 */
function parseLifelogHttpParams(params: URLSearchParams): LifelogHttpParams {
  const timezone = params.get('timezone') ?? 'UTC';
  if (!isValidTimezone(timezone)) {
    throw new BadRequest(`Unknown timezone: ${timezone}`);
  }

  const direction = params.get('direction') ?? 'desc';
  if (direction !== 'asc' && direction !== 'desc') {
    throw new BadRequest('direction must be asc or desc');
  }

  const limitParam = params.get('limit');
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new BadRequest(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }

  let startTime: number | undefined;
  let endTime: number | undefined;
  const date = params.get('date');
  if (date !== null) {
    const day = dateParamToTimestamp(date, timezone);
    if (day === undefined) {
      throw new BadRequest('date must be YYYY-MM-DD');
    }
    startTime = day.start;
    endTime = day.end;
  }
  const start = params.get('start');
  const end = params.get('end');
  try {
    if (start !== null) startTime = timeParamToTimestamp(start, timezone);
    if (end !== null) endTime = timeParamToTimestamp(end, timezone);
  } catch (error) {
    throw new BadRequest((error as Error).message);
  }

  const isStarred = parseBoolean(params, 'isStarred');
  return {
    startTime,
    endTime,
    direction,
    isStarred: isStarred === true ? true : undefined,
    includeMarkdown: parseBoolean(params, 'includeMarkdown') ?? true,
    includeHeadings: parseBoolean(params, 'includeHeadings') ?? true,
    paginationOpts: { numItems: limit, cursor: params.get('cursor') || null },
  };
}

function toLimitlessLifelogs(
  docs: Doc<'lifelogs'>[],
  options: { includeMarkdown: boolean; includeHeadings: boolean },
): LimitlessLifelog[] {
  return convertToLimitlessFormat(docs).map((lifelog) => ({
    ...lifelog,
    markdown: options.includeMarkdown ? lifelog.markdown : null,
    contents: options.includeHeadings
      ? lifelog.contents
      : lifelog.contents.filter((content) => !content.type.startsWith('heading')),
  }));
}

function lifelogsResponse(
  lifelogs: LimitlessLifelog[],
  page: { isDone: boolean; continueCursor: string | null },
): Response {
  return jsonResponse(
    {
      data: { lifelogs },
      meta: {
        lifelogs: {
          nextCursor: page.isDone ? null : page.continueCursor,
          count: lifelogs.length,
        },
      },
    },
    200,
  );
}

function errorResponse(error: unknown, route: string): Response {
  if (error instanceof BadRequest) {
    return jsonResponse({ error: error.message }, 400);
  }
  console.error(`Error in ${route}:`, error);
  return jsonResponse({ error: `An unexpected error occurred in ${route}` }, 500);
}

/**
 * Endpoint: /sync
 * Method: GET
 * Description: Runs one sync from the Limitless API and sends the Slack notification
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
      const isNewLifelogs = await ctx.runAction(internal.dashboard.sync.runSync, {
        sendNotification: true,
      });
      return jsonResponse(
        {
          success: true,
          timestamp: formatDate(new Date()),
          newEntriesAdded: isNewLifelogs,
        },
        200,
      );
    } catch (error) {
      console.error('Error in sync HTTP action:', error);
      return jsonResponse(
        { success: false, error: 'An unexpected error occurred during sync' },
        500,
      );
    }
  }),
});

/**
 * Endpoint: /v1/lifelogs
 * Method: GET
 * Description: The Limitless GET /v1/lifelogs, served from the mirror
 * Authentication: Requires the X-API-Key header
 * Query Parameters: as in openapi.yml (see parseLifelogHttpParams); limit 1-100, default 10
 * Response: { data: { lifelogs }, meta: { lifelogs: { nextCursor, count } } }
 */
http.route({
  path: '/v1/lifelogs',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = checkApiKey(request);
    if (denied) return denied;
    try {
      const params = parseLifelogHttpParams(new URL(request.url).searchParams);
      const page = await ctx.runQuery(internal.lifelogs.paginatedDocs, {
        paginationOpts: params.paginationOpts,
        startTime: params.startTime,
        endTime: params.endTime,
        direction: params.direction,
        isStarred: params.isStarred,
      });
      return lifelogsResponse(toLimitlessLifelogs(page.page, params), page);
    } catch (error) {
      return errorResponse(error, '/v1/lifelogs');
    }
  }),
});

/**
 * Endpoint: /v1/search
 * Method: GET
 * Description: Full-text search over lifelog markdown, best matches first
 * Authentication: Requires the X-API-Key header
 * Query Parameters: query (required), plus the /v1/lifelogs filters except direction
 * Response: the same shape as /v1/lifelogs
 */
http.route({
  path: '/v1/search',
  method: 'GET',
  handler: httpAction(async (ctx, request) => {
    const denied = checkApiKey(request);
    if (denied) return denied;
    try {
      const searchParams = new URL(request.url).searchParams;
      const query = searchParams.get('query')?.trim();
      if (!query) {
        throw new BadRequest('Missing required query parameter: query');
      }
      const params = parseLifelogHttpParams(searchParams);
      const page = await ctx.runQuery(internal.lifelogs.searchMarkdown, {
        query,
        paginationOpts: params.paginationOpts,
        startTime: params.startTime,
        endTime: params.endTime,
        isStarred: params.isStarred,
      });
      return lifelogsResponse(toLimitlessLifelogs(page.page, params), page);
    } catch (error) {
      return errorResponse(error, '/v1/search');
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
