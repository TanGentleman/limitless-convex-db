# limitless-convex-db

A Convex mirror of the Limitless lifelog API. It syncs your Limitless pendant's lifelogs
into your own Convex deployment, serves them at a drop-in `/v1/lifelogs` route and adds
full-text search. `sync-docs.md` explains how the sync stays resumable and polite to the
upstream rate limit.

## Setup

```bash
git clone https://github.com/TanGentleman/limitless-convex-db
cd limitless-convex-db
npm ci
npx convex dev                                   # creates a deployment, pushes the functions
npx convex env set LIMITLESS_API_KEY <your Limitless API key>
npx convex run dashboard/sync:runSync            # one sync
```

Optional: `SLACK_WEBHOOK_URL` (sync notifications) and `TIMEZONE` (defaults to UTC).

Every route on `https://<deployment>.convex.site` requires the `X-API-Key` header with the
same Limitless API key:

```bash
curl -H "X-API-Key: $LIMITLESS_API_KEY" https://<deployment>.convex.site/v1/lifelogs
```
