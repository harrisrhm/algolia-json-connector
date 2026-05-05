const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PRODUCTS_PATH = "data/products.json";
const CHANGELOG_PATH = "data/changes.jsonl";
const SALES_STATE_PATH = "data/sales_state.json";

// How many products to change each run
const NUM_TO_MUTATE = 10;

// Utility
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandomIndices(n, maxIndex) {
  const s = new Set();
  while (s.size < n) s.add(randInt(0, maxIndex));
  return [...s];
}

function safeNumber(x) {
  return typeof x === "number" && Number.isFinite(x);
}

function changeId() {
  // short unique id for tracking
  return crypto.randomBytes(6).toString("hex");
}

// Load products
if (!fs.existsSync(PRODUCTS_PATH)) {
  throw new Error(`Missing ${PRODUCTS_PATH}. Make sure this matches your Worker GH_PATH.`);
}

const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));
if (!Array.isArray(products)) {
  throw new Error(`${PRODUCTS_PATH} must be a JSON array of product objects.`);
}
if (products.length === 0) {
  throw new Error(`${PRODUCTS_PATH} is empty.`);
}

// Ensure changelog directory exists
fs.mkdirSync(path.dirname(CHANGELOG_PATH), { recursive: true });

// Choose items
const n = Math.min(NUM_TO_MUTATE, products.length);
const idxs = pickRandomIndices(n, products.length - 1);

const now = new Date().toISOString();
const runId = changeId();

const changes = [];

for (const i of idxs) {
  const p = products[i];
  const id = p.objectID ?? p.id ?? p.sku ?? p.handle ?? `index:${i}`;

  // Record "before"
  const before = {
    price: p.price,
    inventory_qty: p.inventory_qty,
    published: p.published,
  };

  // Mutations (keep them simple + safe)
  // 1) tweak price +/- up to 10% if numeric
  if (safeNumber(p.price)) {
    const factor = 1 + (Math.random() * 0.2 - 0.1);
    p.price = Math.round(p.price * factor * 100) / 100;
  }

  // 2) randomly bump inventory within [-5, +5] if numeric
  if (safeNumber(p.inventory_qty)) {
    p.inventory_qty = Math.max(0, Math.round(p.inventory_qty + randInt(-5, 5)));
  }

  // 3) occasionally flip published
  if (typeof p.published === "boolean" && Math.random() < 0.1) {
    p.published = !p.published;
  }

  // Tracking fields INSIDE the record (useful to inspect in Algolia too)
  p.updatedAt = now;
  p.lastChangeId = runId;

  const after = {
    price: p.price,
    inventory_qty: p.inventory_qty,
    published: p.published,
  };

  changes.push({ objectID: id, before, after });
}

// --- Sales collection assignment (delta-aware: only changed records matter) ---
const SALES_COUNT = 5;

function getStableId(p, fallback) {
  return String(p.objectID ?? p.id ?? p.sku ?? p.handle ?? fallback);
}

// Read previous selection (if any)
let prevSalesIds = [];
if (fs.existsSync(SALES_STATE_PATH)) {
  try {
    const state = JSON.parse(fs.readFileSync(SALES_STATE_PATH, "utf8"));
    prevSalesIds = Array.isArray(state.salesIds) ? state.salesIds.map(String) : [];
  } catch {
    prevSalesIds = [];
  }
}

// Pick new 5
const salesIdxs = pickRandomIndices(
  Math.min(SALES_COUNT, products.length),
  products.length - 1
);
const newSalesIds = salesIdxs.map(i => getStableId(products[i], `index:${i}`));

// Only these records need to be pushed for immediate collections sync
const changedSalesIds = Array.from(new Set([...prevSalesIds, ...newSalesIds]));

// Apply on_sale ONLY to the changed set (don’t touch other records)
const newSet = new Set(newSalesIds);

// Force correct state for ALL records (guarantees exactly 5 true)
for (let i = 0; i < products.length; i++) {
  const id = getStableId(products[i], `index:${i}`);
  const shouldBeOnSale = newSet.has(id);

  if (products[i].on_sale !== shouldBeOnSale) {
    products[i].on_sale = shouldBeOnSale;
    products[i].salesUpdatedAt = now;
    products[i].salesChangeId = runId;
  }
}

// Persist state for next run
fs.writeFileSync(
  SALES_STATE_PATH,
  JSON.stringify({ salesIds: newSalesIds, changedIds: changedSalesIds, updatedAt: now, runId }, null, 2) + "\n",
  "utf8"
);

// Append changelog line (JSONL)
const logLine = {
  runId,
  timestamp: now,
  mutatedCount: changes.length,
  changes,
  sales: {
    count: newSalesIds.length,
    ids: newSalesIds,
    changedIds: changedSalesIds,
  },
};

fs.appendFileSync(CHANGELOG_PATH, JSON.stringify(logLine) + "\n", "utf8");

// Write back products
fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + "\n", "utf8");

console.log(`Mutated ${changes.length} products. runId=${runId} timestamp=${now}`);

