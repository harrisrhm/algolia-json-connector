# Algolia JSON Connector Demo

This repo hosts sample product data used by an Algolia **JSON connector** via a **Cloudflare Worker** proxy. It also includes automation to (1) mutate product data, (2) assign a dynamic “Sales” set, and (3) sync Algolia **Collections** immediately after the connector run using Algolia’s **Ingestion pushTask**.

## What’s in here
- `data/products.json` — source JSON file (pulled by the Worker)
- `data/changes.jsonl` — append-only change log written by GitHub Actions (before/after for mutated fields)
- `data/sales_state.json` — persisted Sales state (`salesIds`, `changedIds`) used for delta syncing
- `scripts/mutate-products.js` — mutates a subset of products and assigns exactly 5 items as `on_sale: true`
- `scripts/push-sales-delta.js` — pushes only the **changed** Sales records to Algolia via **Ingestion pushTask** (`watch=true`) for immediate Collections availability
- `.github/workflows/mutate-products.yml` — runs mutation + Sales assignment daily at **23:50 UTC**, commits changes
- `.github/workflows/push-sales-after-connector.yml` — runs daily at **00:05 UTC** to push the Sales delta via pushTask (after the connector reindex)

## Features
### 1) Random data mutation + audit log
Each run mutates a subset of products (for example: price, inventory, published) and appends before/after changes to:
- `data/changes.jsonl`

### 2) Dynamic “Sales” assignment (exactly 5 items)
Each run selects 5 random products and marks them:
- `on_sale: true`

The selection is persisted to:
- `data/sales_state.json`

This file contains:
- `salesIds` — the current 5 items in Sales
- `changedIds` — union of previous Sales + new Sales (typically ~10 records). These are the only records that need to be pushed for immediate sync.

### 3) Immediate Collections sync (no waiting window)
Collections can refresh on a cadence. To make the **Sales** collection available immediately after indexing, the workflow pushes only the changed Sales records using Algolia’s **Ingestion pushTask** endpoint with `watch=true`:
- `scripts/push-sales-delta.js`

This requires GitHub Actions secrets:
- `ALGOLIA_APP_ID`
- `ALGOLIA_ADMIN_API_KEY`
- `ALGOLIA_DATA_REGION` (e.g. `us`)
- `ALGOLIA_COLLECTIONS_TASK_ID` (Push Task ID from the Collections “Indexing Guidelines”)

## Data flow (daily)
1. **23:50 UTC** — GitHub Action (`mutate-products.yml`)
   - Mutates `data/products.json`
   - Assigns 5 products to `on_sale: true`
   - Updates `data/changes.jsonl` and `data/sales_state.json`
   - Commits and pushes changes to the repo
2. **00:00 UTC** — Algolia JSON connector reindexes
   - Fetches JSON from the Cloudflare Worker endpoint (Basic Auth)
3. **00:05 UTC** — GitHub Action (`push-sales-after-connector.yml`)
   - Runs `scripts/push-sales-delta.js`
   - Pushes only the changed Sales records via **pushTask** (`watch=true`)
   - Makes the Sales collection available immediately (no multi-hour wait)

## Notes
- The Worker fetches the JSON from this private repo using a GitHub PAT.
- The Algolia connector authenticates to the Worker using Basic Auth.
- The Sales collection is defined dynamically with a condition like: `on_sale = true`.
