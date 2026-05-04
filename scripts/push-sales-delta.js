const fs = require("fs");

const PRODUCTS_PATH = "data/products.json";
const SALES_STATE_PATH = "data/sales_state.json";

function getId(p, fallback) {
  return String(p.objectID ?? p.id ?? p.sku ?? p.handle ?? fallback);
}

function ensureObjectID(p, fallback) {
  if (p.objectID) return { ...p, objectID: String(p.objectID) };
  return { ...p, objectID: String(getId(p, fallback)) };
}

async function main() {
  const {
    ALGOLIA_APP_ID,
    ALGOLIA_ADMIN_API_KEY,
    ALGOLIA_DATA_REGION,
    ALGOLIA_COLLECTIONS_TASK_ID,
  } = process.env;

  if (
    !ALGOLIA_APP_ID ||
    !ALGOLIA_ADMIN_API_KEY ||
    !ALGOLIA_DATA_REGION ||
    !ALGOLIA_COLLECTIONS_TASK_ID
  ) {
    throw new Error("Missing Algolia env vars (check GitHub Actions secrets).");
  }

  if (!fs.existsSync(SALES_STATE_PATH)) {
    console.log("No sales_state.json yet; nothing to push.");
    return;
  }

  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
  if (!Array.isArray(products)) throw new Error(`${PRODUCTS_PATH} must be an array.`);

  const state = JSON.parse(fs.readFileSync(SALES_STATE_PATH, "utf8"));
  const changedIds = Array.isArray(state.changedIds) ? state.changedIds.map(String) : [];

  if (changedIds.length === 0) {
    console.log("No changedIds; nothing to push.");
    return;
  }

  const changedSet = new Set(changedIds);
  const subset = [];

  for (let i = 0; i < products.length; i++) {
    const id = getId(products[i], `index:${i}`);
    if (changedSet.has(id)) {
      subset.push(ensureObjectID(products[i], `index:${i}`));
    }
  }

  console.log(`Pushing ${subset.length} changed sale records`);

  const url = `https://data.${ALGOLIA_DATA_REGION}.algolia.com/2/tasks/${ALGOLIA_COLLECTIONS_TASK_ID}/push?watch=true`;
  const payload = { action: "updateObject", records: subset };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-algolia-application-id": ALGOLIA_APP_ID,
      "x-algolia-api-key": ALGOLIA_ADMIN_API_KEY,
      accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`pushTask failed (${res.status}): ${text}`);

  console.log("pushTask ok:", text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});