This repo hosts sample product data used by an Algolia **JSON connector** via a **Cloudflare Worker** proxy.

## What’s in here
- `data/products.json` — source JSON file (pulled by the Worker)
- `data/changes.jsonl` — append-only change log written by GitHub Actions
- `scripts/mutate-products.js` — randomly mutates a handful of products and logs changes
- `.github/workflows/mutate-products.yml` — runs mutation daily at 23:50 UTC

## Data flow
1. GitHub Action mutates `data/products.json` at **23:50 UTC**
2. Cloudflare Worker serves the JSON with **Basic Auth**
3. Algolia JSON connector reindexes daily at **00:00 UTC**

## Notes
- The Worker fetches the JSON from this private repo using a GitHub PAT.
- The Algolia connector authenticates to the Worker using Basic Auth.
