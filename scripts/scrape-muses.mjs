// Weekly Muses Cabinets dealer-catalog scraper. Run by
// .github/workflows/scrape-muses.yml (schedule + manual dispatch), or locally
// for testing: MUSE_ACCOUNT=... MUSE_PASSWORD=... SUPABASE_URL=... \
// SUPABASE_SERVICE_ROLE_KEY=... node scripts/scrape-muses.mjs
//
// Reverse-engineered from the real dealer portal (shop.musescabinets.com) —
// see project memory for how this was found. No headless browser needed:
// login is a plain POST that returns a Cognito access token, then the full
// catalog (~2400 items, 25 pages at limit=100) is one paginated GET.
// Never touches /api/carts or /api/orders — read-only against the catalog.

const SUPPLIER = "muses";
const TARGET_COMPANY_ID = process.env.TARGET_COMPANY_ID || "wish_cabinets";
const PAGE_LIMIT = 100;
const MIN_EXPECTED_ITEMS = 500; // sanity floor — abort rather than upsert a broken partial scrape

const MUSE_ACCOUNT = requireEnv("MUSE_ACCOUNT");
const MUSE_PASSWORD = requireEnv("MUSE_PASSWORD");
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error(`Missing required env var: ${name}`); process.exit(1); }
  return v;
}

// Parses ` 30"W*42"H*12"D ` style dimensions out of the free-text `detail`
// field — Muses embeds them in prose rather than exposing separate fields.
function parseDimensions(detail) {
  if (!detail) return { width_in: null, height_in: null, depth_in: null };
  const m = detail.match(/(\d+(?:\.\d+)?)\s*"?\s*W\s*\*\s*(\d+(?:\.\d+)?)\s*"?\s*H\s*\*\s*(\d+(?:\.\d+)?)\s*"?\s*D/i);
  if (!m) return { width_in: null, height_in: null, depth_in: null };
  return { width_in: Number(m[1]), height_in: Number(m[2]), depth_in: Number(m[3]) };
}

async function login() {
  const res = await fetch("https://api.musescabinets.com/api/accounts/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: MUSE_ACCOUNT, password: MUSE_PASSWORD })
  });
  if (!res.ok) throw new Error(`Muses login failed: ${res.status} ${await res.text()}`);
  const { accessToken } = await res.json();
  if (!accessToken) throw new Error("Muses login response had no accessToken");
  return accessToken;
}

async function fetchAllProducts(accessToken) {
  const first = await fetchProductsPage(accessToken, 1);
  const items = [...first.products];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await fetchProductsPage(accessToken, page);
    items.push(...next.products);
  }
  if (items.length < MIN_EXPECTED_ITEMS) {
    throw new Error(`Only got ${items.length} products (expected >= ${MIN_EXPECTED_ITEMS}) — aborting without writing, catalog fetch likely broke`);
  }
  return items;
}

async function fetchProductsPage(accessToken, page) {
  const url = `https://api.musescabinets.com/api/products/search?keyword=&page=${page}&limit=${PAGE_LIMIT}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Muses product page ${page} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function toRow(p) {
  const dims = parseDimensions(p.detail);
  return {
    company_id: TARGET_COMPANY_ID,
    supplier: SUPPLIER,
    external_id: p.id,
    sku: p.sku,
    item_class: p.itemClass || null,
    item_category: p.itemCategory || null,
    cabinet_type: p.cabinetType || null,
    color: p.color || null,
    detail: p.detail || null,
    description: p.description || null,
    ...dims,
    weight: p.weight ?? null,
    price: p.price === undefined || p.price === null ? null : Number(p.price),
    stock: p.stock ?? null,
    is_available: p.isAvailable ?? null,
    is_fixed_price: p.isFixedPrice ?? null,
    raw: p,
    scraped_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

async function supabaseRequest(path, init) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  });
  if (!res.ok) throw new Error(`Supabase ${init.method || "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Muses' pagination isn't strictly disjoint — the same product id can show up
// on more than one page. A batch upsert with two rows sharing a conflict key
// fails outright ("ON CONFLICT DO UPDATE command cannot affect row a second
// time"), so collapse to one row per external_id before upserting.
function dedupeByExternalId(rows) {
  const byId = new Map();
  for (const r of rows) byId.set(r.external_id, r);
  return [...byId.values()];
}

async function main() {
  console.log(`Logging in to Muses as ${MUSE_ACCOUNT}...`);
  const accessToken = await login();

  console.log("Fetching full catalog...");
  const products = await fetchAllProducts(accessToken);
  console.log(`Got ${products.length} products.`);

  const existing = await supabaseRequest(
    `supplier_products?company_id=eq.${TARGET_COMPANY_ID}&supplier=eq.${SUPPLIER}&select=external_id,price,stock`,
    { method: "GET" }
  );
  const existingByExternalId = new Map(existing.map(r => [r.external_id, r]));

  const rows = dedupeByExternalId(products.map(toRow));
  const changed = rows.filter(r => {
    const prev = existingByExternalId.get(r.external_id);
    return !prev || String(prev.price) !== String(r.price) || prev.stock !== r.stock;
  });

  console.log(`Upserting ${rows.length} products (${changed.length} new or changed)...`);
  for (const batch of chunk(rows, 500)) {
    await supabaseRequest(`supplier_products?on_conflict=company_id,supplier,external_id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(batch)
    });
  }

  if (changed.length > 0) {
    const historyRows = changed.map(r => ({
      company_id: r.company_id, supplier: r.supplier, external_id: r.external_id,
      sku: r.sku, price: r.price, stock: r.stock
    }));
    for (const batch of chunk(historyRows, 500)) {
      await supabaseRequest("supplier_price_history", { method: "POST", body: JSON.stringify(batch) });
    }
    console.log(`Recorded ${historyRows.length} price-history rows.`);
  } else {
    console.log("No price/stock changes since last run — no history rows written.");
  }

  console.log("Done.");
}

main().catch(err => { console.error(err); process.exit(1); });
