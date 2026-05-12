# Algolia JSON Connector Demo

This repo hosts sample product data used by an Algolia **JSON connector** via a **Cloudflare Worker** proxy. It also includes automation to (1) mutate product data, (2) manage multiple collections (dynamic + manual) and track drift across them, and (3) sync Algolia **Collections** immediately after the connector run using Algolia’s **Ingestion pushTask**.

## What’s in here
- `data/products.json` — source JSON file (pulled by the Worker)
- `data/changes.jsonl` — append-only change log written by GitHub Actions (before/after for mutated fields)
- `data/sales_state.json` — persisted Sales state (`salesIds`, `changedIds`) used for delta syncing
- `data/collections_config.json` — configuration for tracking multiple collections (dynamic + manual)
- `scripts/mutate-products.js` — mutates a subset of products and assigns exactly 5 items as `on_sale: true`
- `scripts/push-sales-delta.js` — pushes only the **changed** Sales records to Algolia via **Ingestion pushTask** (`watch=true`) for immediate Collections availability
- `scripts/check-sales-drift.js` — checks collection drift (index vs `_collections`) and writes drift reports (Dynamic + Manually configured collections)
- `.github/workflows/mutate-products.yml` — runs mutation + Sales assignment daily at **22:00 UTC**, commits changes
- `.github/workflows/push-sales-after-connector.yml` — runs daily at **00:10 UTC** to push the Sales delta via pushTask (after the connector reindex)

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

### 3) Manual collection tracking (example: "Gadget sales")

In addition to the dynamic **Sales** collection, this demo tracks a manually curated collection:

- Collection: `Gadget sales`
- Config: `data/collections_config.json` (`type: "manual"` with `expectedObjectIDs`)

The dashboard and `/status` endpoint compare the expected IDs against:
- `filters: _collections:"Gadget sales"`

### 4) Immediate Collections sync (no waiting window)
Collections can refresh on a cadence. To make the collection visible immediately after indexing, the workflow uses Algolia’s **Ingestion pushTask** endpoint with `watch=true` to push only the **delta records** that affect collections (currently the dynamic **Sales** set).
- `scripts/push-sales-delta.js`

This requires GitHub Actions secrets:
- `ALGOLIA_APP_ID`
- `ALGOLIA_ADMIN_API_KEY`
- `ALGOLIA_DATA_REGION` (e.g. `us`)
- `ALGOLIA_COLLECTIONS_TASK_ID` (Push Task ID from the Collections “Indexing Guidelines”)

### 5) Collections drift check + alerting

To confirm collections are fully synchronized (not just the index data), the workflow runs drift checks that compare:
- **Index state** (e.g. `filters: "on_sale:true"` for the dynamic Sales set)
- **Collections assignment** (e.g. `filters: "_collections:sales"` and other configured collections)

Expected membership comes from:
- `data/sales_state.json` (`salesIds`) for the dynamic **Sales** set
- `data/collections_config.json` for additional collections (e.g. manual **"Gadget sales"** via `expectedObjectIDs`)

Drift check script:
- `scripts/check-sales-drift.js`

If drift is detected:
- a GitHub Issue is created/updated (labels: `drift`, `sales`)
- a drift report is uploaded as a GitHub Actions artifact with **4-day retention**
- after `push-sales-delta.js` runs, a post-check confirms drift is resolved (and the issue can be auto-closed when resolved)

### 6) Dashboard

A simple GitHub Pages dashboard (https://harrisrhm.github.io/algolia-json-connector/) is included to visualize the end-to-end flow and collection synchronization status (dynamic + manual).

- UI: `docs/index.html` (served via GitHub Pages)
- Backend: Cloudflare Worker `GET /status`
- The dashboard compares:
  - expected Sales IDs (from `data/sales_state.json`)
  - current `on_sale:true` IDs in the index
  - current `_collections:sales` IDs (collection assignment)
- It highlights drift vs synced state and refreshes automatically.

## Data flow (daily)
1. **22:00 UTC** — GitHub Action (`mutate-products.yml`)
   - Mutates `data/products.json`
   - Assigns 5 products to `on_sale: true`
   - Updates `data/changes.jsonl` and `data/sales_state.json`
   - Commits and pushes changes to the repo
2. **00:00 UTC** — Algolia JSON connector reindexes
   - Fetches JSON from the Cloudflare Worker endpoint (Basic Auth)
3. **00:10 UTC** — GitHub Action (`push-sales-after-connector.yml`)
   - Runs `scripts/push-sales-delta.js`
   - Pushes only the changed Sales records via **pushTask** (`watch=true`)
   - Makes the Sales collection available immediately (no multi-hour wait)

## Notes
- The Worker fetches the JSON from this repo using a GitHub PAT.
- The Algolia connector authenticates to the Worker using Basic Auth.
- Dynamic collection example: Sales uses `on_sale:true`.
- Manual collection example: `Gadget sales` uses a curated list of `objectID`s from `data/collections_config.json`
