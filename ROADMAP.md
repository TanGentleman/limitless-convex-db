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

## Apply a branch upstream

```bash
# in a kranti-sandbox clone: everything after the import commit
git fetch origin
base=$(git log -1 --format=%H --grep='^Import limitless-convex-db upstream' origin/limitless-convex-db-1)
git format-patch --relative=limitless-convex-db "$base"..origin/limitless-convex-db-1 -o /tmp/lcdb
# in a clean upstream clone at 626480a
git clone https://github.com/TanGentleman/limitless-convex-db && cd limitless-convex-db
git am /tmp/lcdb/*.patch
```

## Needs Tan

- Set `LIMITLESS_API_KEY` on the deployment: HTTP routes now refuse every request
  without it. Clients that called the public functions (`python-src/`) stop working.
