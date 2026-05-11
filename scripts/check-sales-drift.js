// scripts/check-sales-drift.js
const fs = require("fs");

const SALES_STATE_PATH = "data/sales_state.json";
const INDEX_NAME = process.env.ALGOLIA_INDEX_NAME || "json_connector";

async function algoliaQuery({ appId, apiKey, indexName, params }) {
  const url = `https://${appId}-dsn.algolia.net/1/indexes/${encodeURIComponent(indexName)}/query`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": appId,
      "X-Algolia-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ params: new URLSearchParams(params).toString() }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Algolia query failed (${res.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function main() {
  const { ALGOLIA_APP_ID, ALGOLIA_ADMIN_API_KEY } = process.env;
  if (!ALGOLIA_APP_ID || !ALGOLIA_ADMIN_API_KEY) {
    throw new Error("Missing ALGOLIA_APP_ID / ALGOLIA_ADMIN_API_KEY");
  }

  if (!fs.existsSync(SALES_STATE_PATH)) {
    throw new Error(`Missing ${SALES_STATE_PATH}`);
  }

  const state = JSON.parse(fs.readFileSync(SALES_STATE_PATH, "utf8"));
  const expected = Array.isArray(state.salesIds) ? state.salesIds.map(String) : [];
  if (expected.length !== 5) {
    throw new Error(`Expected 5 salesIds in sales_state.json, got ${expected.length}`);
  }
  const expectedSet = new Set(expected);

  // 1) Data correctness: on_sale:true
  const onSaleRes = await algoliaQuery({
    appId: ALGOLIA_APP_ID,
    apiKey: ALGOLIA_ADMIN_API_KEY,
    indexName: INDEX_NAME,
    params: {
      query: "",
      filters: "on_sale:true",
      attributesToRetrieve: "objectID",
      hitsPerPage: "50",
    },
  });

  const onSaleIds = new Set(onSaleRes.hits.map((h) => String(h.objectID)));
  const onSaleExtra = [...onSaleIds].filter((id) => !expectedSet.has(id));
  const onSaleMissing = expected.filter((id) => !onSaleIds.has(id));

  // 2) Collection assignment: _collections:sales
  const colRes = await algoliaQuery({
    appId: ALGOLIA_APP_ID,
    apiKey: ALGOLIA_ADMIN_API_KEY,
    indexName: INDEX_NAME,
    params: {
      query: "",
      filters: "_collections:sales",
      attributesToRetrieve: "objectID,_collections,on_sale",
      hitsPerPage: "50",
    },
  });

  const colIds = new Set(colRes.hits.map((h) => String(h.objectID)));
  const colExtra = [...colIds].filter((id) => !expectedSet.has(id));
  const colMissing = expected.filter((id) => !colIds.has(id));

  const malformed = colRes.hits
    .filter((h) => !Array.isArray(h._collections) || !h._collections.includes("sales"))
    .map((h) => String(h.objectID));

  const report = {
    checkedAtUtc: new Date().toISOString(),
    indexName: INDEX_NAME,
    expectedSalesIds: expected,
    onSale: {
      count: onSaleRes.nbHits,
      extraIds: onSaleExtra,
      missingIds: onSaleMissing,
    },
    collectionsSales: {
      count: colRes.nbHits,
      extraIds: colExtra,
      missingIds: colMissing,
      malformedHits: malformed,
    },
  };

  fs.writeFileSync("data/drift_report.json", JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));

  const hasDrift =
    onSaleRes.nbHits !== expected.length ||
    onSaleExtra.length > 0 ||
    onSaleMissing.length > 0 ||
    colRes.nbHits !== expected.length ||
    colExtra.length > 0 ||
    colMissing.length > 0 ||
    malformed.length > 0;

  const mode = process.env.DRIFT_MODE || "pre"; // "pre" or "post"

// Write a simple flag for the workflow to read
fs.writeFileSync("data/drift_detected.txt", hasDrift ? "true\n" : "false\n", "utf8");

// In pre mode, never fail the job (we only record drift)
// In post mode, fail if drift still exists
if (mode === "post" && hasDrift) process.exit(2);
process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});