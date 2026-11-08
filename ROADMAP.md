# limitless-convex-db roadmap

limitless-convex-db is a Convex app (`convex-app/`) that mirrors a Limitless pendant's
lifelogs into Tan's own database. It syncs from `https://api.limitless.ai/v1/lifelogs`
with a resumable, rate-limit-aware algorithm (`sync-docs.md` explains the design),
serves the mirrored data at a drop-in `/v1/lifelogs` route, and adds full-text search.
It was written 2025-03 to 2025-07 on a GitHub fork of `limitless-ai-inc/limitless-api-examples`.

Verdict: worth reviving. The sync design is the interesting part. Most of the repo is
the upstream example code it was forked from.

## Upstream status (main 626480a, 2025-07-02, checked 2026-11-08)

- Fork of `limitless-ai-inc/limitless-api-examples` (MIT). No LICENSE file;
  `convex-app/package.json` says MIT.
- No tests (`npm test` exits 1), no CI, no lockfile (`package-lock.json` is
  gitignored), `convex ^1.24.1` (latest 1.49.0).
- Anyone with the deployment URL could read transcripts and spend the Limitless rate
  limit: `dashboard/previews:getPreviewLifelog` (query), `getLastLifelog` (action),
  `dashboard/sync:sync`, `extras/schedules:scheduleSync` and `listSchedules` were public
  Convex functions, and `GET /sync` had no key check (it also fires the Slack webhook).
- `http.ts`: the OPTIONS route was `/search` (endpoint is `/v1/search`); CORS
  `Allow-Headers` omitted the `X-API-Key` header the routes require.
- No credentials in the history (`git log --all -p`, no `.env` ever committed).
- Open issues: #1 Convex integration with tests, #6 auth, #7 template repo, #9 sync and
  rate limiting, #10 new API schema, #11 webhook success conditions.
- Branch `experimental` (24 commits, last 2025-07-07) has unmerged Slack/Discord webhook
  helpers, a public notification endpoint and a "native ts SDK" rewrite (b7ee220). Not
  imported; review it separately.

## Stack

Each branch is based on the previous one.

- `limitless-convex-db-1`: exact import of 626480a, this file. Every Convex function
  is internal; all HTTP routes, `/sync` included, need `X-API-Key` equal to the
  deployment's `LIMITLESS_API_KEY` and return 500 when it is unset (fail closed).
  CORS allows `X-API-Key`; OPTIONS answers `/v1/search`. The duplicate public
  `dashboard/sync:sync` is gone (`runSync` is the internal one). `python-src/` called
  the removed public functions; it is cut on `-2`.
- `limitless-convex-db-2`: the repo is the Convex app. `convex-app/` moved to the root;
  `python/`, `typescript/`, `notebooks/`, `assets/`, `convex-app/python-src/` and the
  upstream README cut (`openapi.yml`, the Limitless spec the mirror follows, stays).
  convex 1.49.0, moment-timezone 0.6.6, TypeScript 7.0.2; `@slack/webhook` replaced by a
  `fetch` POST, so no function needs the Node runtime. `package-lock.json` and
  `convex/_generated` committed; `npm run typecheck`.
- `limitless-convex-db-3`: `/v1/lifelogs` and `/v1/search` follow `openapi.yml`, with
  offline tests (`convex/http.test.ts`, convex-test). Fixed: `date` parsed MM-DD-YYYY
  (spec: YYYY-MM-DD, both now accepted); `start`/`end` ignored `timezone`; a lifelog
  crossing midnight was dropped from both days; default `direction` was `asc` (spec:
  `desc`); `nextCursor` was never null, so clients paging to the end looped on an empty
  page; `isStarred` was ignored; sync dropped `speakerName`, `speakerIdentifier`,
  offsets and children from `contents`; bad parameters were a 500. `/v1/search` takes
  `start`/`end` like `/v1/lifelogs` (it read integer `startTime`/`endTime`), ignored its
  start filter when both were given, and returned bare markdown strings in
  `data.results`; it now returns lifelog objects in `data.lifelogs`. `limit` is 1-100.
- `limitless-convex-db-4`: tests for the sync in `sync-docs.md` against a fake Limitless
  API (`convex/sync.test.ts`): first sync, multi-page days, resume after a gap, no
  duplicates on rerun, the 2-minute freshness skip, 429 and 5xx. Fixed: the first sync
  on an empty database was skipped as "fresh" (it creates the metadata row it then
  checks), and after that stored only the oldest lifelog; it now catches up in the same
  run. A failed fetch (401, 429, 5xx) was recorded as a successful sync and `/sync`
  answered 200; it now keeps the lifelogs it got, records a failed operation with the
  status and `retryAfter`, and fails the sync. Pages are 10 lifelogs (the documented
  maximum; was 25), because a short page is what marks a day done.
- `limitless-convex-db-5`: CI (`npm ci`, typecheck, tests on Node 22 and 24, SHA-pinned
  actions).
- `limitless-convex-db-6`: README rewritten around the design (the sync problem, the
  algorithm as a diagram, the drop-in API, search, limitations) and a search benchmark,
  `scripts/bench-search.mjs`. Measured on a local backend (Docker `ubuntu:24.04`, 8
  cores) with 10,000 synthetic lifelogs (142 MB), whole HTTP requests over localhost:
  `/v1/search` p50 11 ms, p95 15-29 ms at `limit=10`; p50 22-28 ms, p95 33-91 ms at
  `limit=50`. The "under 200 ms" claim holds locally; a cloud deployment wasn't measured.

## Verified / not verified

- Verified: the stack applies with `git am` to a fresh clone of upstream 626480a and
  `npm ci`, typecheck and 22 offline tests pass there; the README's local commands
  (`convex dev`, `env set`, `run`, the curls, the benchmark) against a local backend.
- Not verified: any sync against the real `api.limitless.ai` (no key; it answers 401,
  which the sync now records as a failure); the 10-per-page cap and the cursor on a
  day's last page come from the docs and from notes in the code; Slack notifications;
  cloud latency.

## Apply a branch upstream

```bash
# in a kranti-sandbox clone: everything after the import commit
git fetch origin
base=$(git log -1 --format=%H --grep='^Import limitless-convex-db upstream' origin/limitless-convex-db-1)
git format-patch --relative=limitless-convex-db "$base"..origin/limitless-convex-db-6 -o /tmp/lcdb
# in a clean upstream clone at 626480a
git clone https://github.com/TanGentleman/limitless-convex-db && cd limitless-convex-db
git am /tmp/lcdb/*.patch
npm ci && npm run typecheck && npm test    # -3 and later (typecheck from -2)
```

## Needs Tan

- Detach the fork? It is still a GitHub fork of `limitless-ai-inc/limitless-api-examples`;
  after `-2` none of that code is left. Detaching makes it searchable and lets it hold
  its own issues as a standalone repo. Also add a LICENSE (package.json says MIT).
- Run one live sync with your key after applying, then `npm test` stays the safety net.
  If the API now returns more than 10 per page, `CONFIG.maxBatchSize` can go back up.
- Set `LIMITLESS_API_KEY` on the deployment: HTTP routes now refuse every request
  without it. Clients that called the public functions (`python-src/`) stop working.
