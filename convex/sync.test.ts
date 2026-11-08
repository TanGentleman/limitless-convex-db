/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from './schema';
import { internal } from './_generated/api';
import { LimitlessLifelog } from './types';

const modules = import.meta.glob('./**/*.ts');
const DAY = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 10;

/**
 * A fake https://api.limitless.ai/v1/lifelogs: UTC dates, limit capped at the
 * documented 10, and (as observed live) a nextCursor even on a day's last page.
 */
function fakeLimitless(lifelogs: LimitlessLifelog[]) {
  const calls: URLSearchParams[] = [];
  const failures = new Map<number, Response>();
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    expect(url.origin + url.pathname).toBe('https://api.limitless.ai/v1/lifelogs');
    expect(new Headers(init?.headers).get('X-API-Key')).toBe('test-key');
    const params = url.searchParams;
    calls.push(params);
    const failure = failures.get(calls.length);
    if (failure) return failure;

    const date = params.get('date');
    let matches = lifelogs
      .filter((l) => !date || l.startTime.startsWith(date))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (params.get('direction') !== 'asc') matches = matches.reverse();
    const offset = Number(params.get('cursor') ?? 0);
    const limit = Math.min(Number(params.get('limit') ?? 3), MAX_LIMIT);
    const page = matches.slice(offset, offset + limit);
    return Response.json({
      data: { lifelogs: page },
      meta: { lifelogs: { nextCursor: page.length ? String(offset + page.length) : undefined, count: page.length } },
    });
  });
  return { fetch, calls, failAt: (call: number, response: Response) => failures.set(call, response) };
}

/** n lifelogs on a UTC date, 30 minutes apart from 08:00. */
function day(date: string, n: number): LimitlessLifelog[] {
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(`${date}T08:00:00.000Z`).getTime() + i * 30 * 60 * 1000;
    return {
      id: `${date}-${i}`,
      title: `Lifelog ${i} on ${date}`,
      markdown: `# Lifelog ${i}\n\nnotes from ${date}`,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 20 * 60 * 1000).toISOString(),
      contents: [{ type: 'blockquote', content: 'hi', speakerName: 'Tan', speakerIdentifier: 'user' }],
    };
  });
}

let now = new Date('2025-07-10T12:00:00.000Z').getTime();
function later(ms = 3 * 60 * 1000) {
  now += ms;
  vi.setSystemTime(now);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  now = new Date('2025-07-10T12:00:00.000Z').getTime();
  vi.setSystemTime(now);
  vi.stubEnv('LIMITLESS_API_KEY', 'test-key');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(lifelogs: LimitlessLifelog[]) {
  const api = fakeLimitless(lifelogs);
  vi.stubGlobal('fetch', api.fetch);
  const t = convexTest(schema, modules);
  const sync = () => t.action(internal.dashboard.sync.syncLimitless, {});
  const stored = () =>
    t.run(async (ctx) => (await ctx.db.query('lifelogs').collect()).map((l) => l.lifelogId).sort());
  const lastOperation = () =>
    t.run(async (ctx) => (await ctx.db.query('operations').filter((q) => q.eq(q.field('operation'), 'sync')).order('desc').first())!);
  return { t, api, sync, stored, lastOperation };
}

const ids = (lifelogs: LimitlessLifelog[]) => lifelogs.map((l) => l.id).sort();

test('first sync on an empty database stores everything in one run', async () => {
  const all = [...day('2025-07-01', 3), ...day('2025-07-02', 23), ...day('2025-07-04', 2)];
  const { sync, stored, lastOperation } = setup(all);
  expect(await sync()).toBe(true);
  expect(await stored()).toEqual(ids(all));
  expect((await lastOperation()).success).toBe(true);
});

test('a day with more lifelogs than one page is fetched page by page', async () => {
  const all = [...day('2025-07-01', 1), ...day('2025-07-02', 23)];
  const { api, sync, stored } = setup(all);
  await sync();
  expect(await stored()).toEqual(ids(all));
  const july2 = api.calls.filter((c) => c.get('date') === '2025-07-02' && c.get('direction') === 'asc');
  expect(july2.map((c) => c.get('cursor'))).toEqual([null, '10', '20']);
  expect(api.calls.every((c) => Number(c.get('limit')) <= MAX_LIMIT)).toBe(true);
});

test('a later sync resumes after a gap without refetching old days', async () => {
  now = new Date('2025-07-02T12:00:00.000Z').getTime();
  vi.setSystemTime(now);
  const before = [...day('2025-07-01', 2), ...day('2025-07-02', 2)];
  const { api, sync, stored } = setup(before);
  await sync();
  expect(await stored()).toEqual(ids(before));

  // A week later: nothing for two days, then lifelogs on 07-05 and 07-09.
  before.push(...day('2025-07-05', 4), ...day('2025-07-09', 1));
  later(8 * DAY);
  api.calls.length = 0;
  expect(await sync()).toBe(true);
  expect(await stored()).toEqual(ids(before));
  const dates = new Set(api.calls.map((c) => c.get('date')));
  expect(dates.has('2025-07-01')).toBe(false);
});

test('rerunning stores no duplicates and reports nothing new', async () => {
  const all = [...day('2025-07-08', 5), ...day('2025-07-09', 5)];
  const { sync, stored, t } = setup(all);
  await sync();
  later();
  expect(await sync()).toBe(false);
  later();
  expect(await sync()).toBe(false);
  expect(await stored()).toEqual(ids(all));
  const docs = await t.run((ctx) => ctx.db.query('lifelogs').collect());
  expect(docs.length).toBe(all.length);
});

test('a sync within two minutes of the last one makes no API calls', async () => {
  const { api, sync } = setup(day('2025-07-09', 2));
  await sync();
  api.calls.length = 0;
  later(60 * 1000);
  expect(await sync()).toBe(false);
  expect(api.calls).toEqual([]);
});

test('on 429 it stops at once, keeps progress, records the failure and the next sync resumes', async () => {
  const all = [...day('2025-07-01', 1), ...day('2025-07-02', 25), ...day('2025-07-03', 3)];
  const { api, sync, stored, lastOperation } = setup(all);
  // Call 1 is the first-sync seed, 2 the date check, 3-4 pages of 07-01/07-02, 5 is limited.
  api.failAt(5, Response.json({ error: 'API key is rate limited', retryAfter: '60' }, { status: 429 }));
  await expect(sync()).rejects.toThrow(/rate|429/i);
  expect(api.calls.length).toBe(5);
  const kept = await stored();
  expect(kept.length).toBeGreaterThan(1);
  const op = await lastOperation();
  expect(op.success).toBe(false);
  expect(JSON.stringify(op)).toContain('HTTP 429, retry after 60s');

  later();
  expect(await sync()).toBe(true);
  expect(await stored()).toEqual(ids(all));
});

test('a server error is not recorded as a successful sync', async () => {
  const { api, sync, lastOperation, t } = setup([...day('2025-07-01', 1), ...day('2025-07-02', 3)]);
  api.failAt(2, new Response('upstream down', { status: 500 }));
  await expect(sync()).rejects.toThrow(/Sync failed/);
  expect((await lastOperation()).success).toBe(false);

  vi.stubEnv('LIMITLESS_API_KEY', 'test-key');
  const response = await t.fetch('/sync', { headers: { 'X-API-Key': 'test-key' } });
  expect(response.status).toBe(200);
});

test('a wrong Limitless key fails the sync and GET /sync reports it', async () => {
  const { api, t } = setup(day('2025-07-01', 1));
  api.failAt(1, Response.json({ error: 'Unauthorized' }, { status: 401 }));
  const response = await t.fetch('/sync', { headers: { 'X-API-Key': 'test-key' } });
  expect(response.status).toBe(500);
  expect((await response.json()).success).toBe(false);
});
