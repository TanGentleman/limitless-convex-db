/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import schema from './schema';
import { convertToConvexFormat, LimitlessLifelog } from './types';

const modules = import.meta.glob('./**/*.ts');
const KEY = 'test-key';
const auth = { headers: { 'X-API-Key': KEY } };

function lifelog(id: string, start: string, end: string, extra: Partial<LimitlessLifelog> = {}): LimitlessLifelog {
  const { markdown, ...rest } = extra;
  return {
    id,
    title: `Lifelog ${id}`,
    markdown: `# Lifelog ${id}\n\nrecorded ${markdown ?? 'small talk'}`,
    startTime: start,
    endTime: end,
    contents: [
      { type: 'heading1', content: `Lifelog ${id}` },
      {
        type: 'blockquote',
        content: 'hello there',
        startTime: start,
        endTime: end,
        startOffsetMs: 0,
        endOffsetMs: 1500,
        speakerName: 'Tan',
        speakerIdentifier: 'user',
      },
    ],
    ...rest,
  };
}

const LIFELOGS = [
  lifelog('a', '2025-07-01T15:00:00.000Z', '2025-07-01T15:30:00.000Z', { markdown: 'coffee with Priya about the roadmap' }),
  lifelog('b', '2025-07-02T06:50:00.000Z', '2025-07-02T07:10:00.000Z', { isStarred: true, markdown: 'late night standup' }),
  lifelog('c', '2025-07-02T18:00:00.000Z', '2025-07-02T18:45:00.000Z', { markdown: 'roadmap review and lunch' }),
  lifelog('d', '2025-07-03T09:00:00.000Z', '2025-07-03T09:05:00.000Z', { isStarred: true, markdown: 'gym' }),
];

async function setup() {
  vi.stubEnv('LIMITLESS_API_KEY', KEY);
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const doc of convertToConvexFormat(LIFELOGS)) {
      await ctx.db.insert('lifelogs', doc);
    }
  });
  return t;
}

async function get(t: Awaited<ReturnType<typeof setup>>, path: string) {
  const response = await t.fetch(path, auth);
  return { status: response.status, body: await response.json() };
}

const ids = (body: any) => body.data.lifelogs.map((l: LimitlessLifelog) => l.id);

beforeEach(() => {
  vi.stubEnv('LIMITLESS_API_KEY', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('auth', () => {
  test('every route fails closed when LIMITLESS_API_KEY is unset', async () => {
    const t = convexTest(schema, modules);
    for (const path of ['/sync', '/v1/lifelogs', '/v1/search?query=x']) {
      expect((await t.fetch(path, auth)).status).toBe(500);
    }
  });

  test('every route needs the matching X-API-Key header', async () => {
    const t = await setup();
    for (const path of ['/sync', '/v1/lifelogs', '/v1/search?query=x']) {
      expect((await t.fetch(path)).status).toBe(401);
      expect((await t.fetch(path, { headers: { 'X-API-Key': 'wrong' } })).status).toBe(401);
      expect((await t.fetch(path, { headers: { Authorization: `Bearer ${KEY}` } })).status).toBe(401);
    }
    expect((await t.fetch('/v1/lifelogs', auth)).status).toBe(200);
    expect((await t.fetch('/v1/search?query=gym', auth)).status).toBe(200);
  });

  test('preflight allows X-API-Key on every route', async () => {
    const t = await setup();
    for (const path of ['/sync', '/v1/lifelogs', '/v1/search']) {
      const response = await t.fetch(path, { method: 'OPTIONS' });
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key');
    }
    const response = await t.fetch('/v1/lifelogs', auth);
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-API-Key');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});

describe('/v1/lifelogs matches the Limitless API', () => {
  test('response shape round-trips what sync stored', async () => {
    const t = await setup();
    const { status, body } = await get(t, '/v1/lifelogs?limit=1&direction=asc');
    expect(status).toBe(200);
    expect(body.data.lifelogs).toEqual([LIFELOGS[0]].map(({ isStarred, ...rest }) => rest));
    expect(body.meta.lifelogs.count).toBe(1);
    expect(typeof body.meta.lifelogs.nextCursor).toBe('string');
  });

  test('newest first by default, asc on request', async () => {
    const t = await setup();
    expect(ids((await get(t, '/v1/lifelogs')).body)).toEqual(['d', 'c', 'b', 'a']);
    expect(ids((await get(t, '/v1/lifelogs?direction=asc')).body)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('cursor pagination visits every lifelog once and ends with a null cursor', async () => {
    const t = await setup();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const { body } = await get(t, `/v1/lifelogs?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...ids(body));
      cursor = body.meta.lifelogs.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual(['d', 'c', 'b', 'a']);
    expect(cursor).toBeNull();
  });

  test('date is a day in the given timezone and keeps lifelogs that cross midnight', async () => {
    const t = await setup();
    // b starts 23:50 on 07-01 in Los Angeles and ends 00:10 on 07-02.
    const la = await get(t, '/v1/lifelogs?date=2025-07-01&timezone=America/Los_Angeles&direction=asc');
    expect(ids(la.body)).toEqual(['a', 'b']);
    const utc = await get(t, '/v1/lifelogs?date=2025-07-02&direction=asc');
    expect(ids(utc.body)).toEqual(['b', 'c']);
    expect(ids((await get(t, '/v1/lifelogs?date=07-02-2025&direction=asc')).body)).toEqual(['b', 'c']);
  });

  test('start and end are local times in the timezone; offsets are ignored', async () => {
    const t = await setup();
    const range = '/v1/lifelogs?direction=asc&timezone=America/Los_Angeles';
    expect(ids((await get(t, `${range}&start=2025-07-02 00:00:00&end=2025-07-02 23:59:59`)).body)).toEqual(['c']);
    expect(ids((await get(t, `${range}&start=2025-07-02T00:00:00Z`)).body)).toEqual(['c', 'd']);
    expect(ids((await get(t, `/v1/lifelogs?direction=asc&end=2025-07-02`)).body)).toEqual(['a']);
  });

  test('includeMarkdown, includeHeadings and isStarred', async () => {
    const t = await setup();
    const { body } = await get(t, '/v1/lifelogs?includeMarkdown=false&includeHeadings=false&limit=1');
    expect(body.data.lifelogs[0].markdown).toBeNull();
    expect(body.data.lifelogs[0].contents.map((c: any) => c.type)).toEqual(['blockquote']);
    expect(ids((await get(t, '/v1/lifelogs?isStarred=true')).body)).toEqual(['d', 'b']);
    expect(ids((await get(t, '/v1/lifelogs?isStarred=false')).body)).toEqual(['d', 'c', 'b', 'a']);
  });

  test('bad parameters are a 400, not a 500', async () => {
    const t = await setup();
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'direction=up', 'date=2025-13-01',
      'timezone=Mars/Base', 'start=yesterday', 'includeMarkdown=no']) {
      const { status, body } = await get(t, `/v1/lifelogs?${query}`);
      expect(status, query).toBe(400);
      expect(body.error).toBeTruthy();
    }
  });
});

describe('/v1/search', () => {
  test('needs a query', async () => {
    const t = await setup();
    expect((await get(t, '/v1/search')).status).toBe(400);
    expect((await get(t, '/v1/search?query=%20')).status).toBe(400);
  });

  test('returns matching lifelogs in the /v1/lifelogs shape', async () => {
    const t = await setup();
    const { status, body } = await get(t, '/v1/search?query=roadmap');
    expect(status).toBe(200);
    expect(ids(body).sort()).toEqual(['a', 'c']);
    expect(body.data.lifelogs[0].contents[1].speakerName).toBe('Tan');
    expect(body.meta.lifelogs).toEqual({ count: 2, nextCursor: null });
  });

  test('filters by start/end like /v1/lifelogs and by isStarred', async () => {
    const t = await setup();
    expect(ids((await get(t, '/v1/search?query=roadmap&start=2025-07-02')).body)).toEqual(['c']);
    expect(ids((await get(t, '/v1/search?query=roadmap&end=2025-07-02')).body)).toEqual(['a']);
    expect(ids((await get(t, '/v1/search?query=recorded&isStarred=true')).body).sort()).toEqual(['b', 'd']);
  });

  test('paginates', async () => {
    const t = await setup();
    const first = await get(t, '/v1/search?query=recorded&limit=3');
    expect(first.body.meta.lifelogs.count).toBe(3);
    const cursor = encodeURIComponent(first.body.meta.lifelogs.nextCursor);
    const second = await get(t, `/v1/search?query=recorded&limit=3&cursor=${cursor}`);
    expect([...ids(first.body), ...ids(second.body)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(second.body.meta.lifelogs.nextCursor).toBeNull();
  });
});
