/**
 * Cloudflare Pages Function: /api
 *
 * Supports both:
 *   GET  /api?action=getadminstatus&...
 *   POST /api?action=setweeklyday   (with JSON body)
 *
 * Optional persistence:
 *   - If you bind KV as DFD_KV, it will persist.
 *   - If not, it falls back to in-memory (works but resets on cold start).
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function ok(payload = {}) {
  return json({ ok: true, ...payload });
}

function err(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function getAction(url) {
  // Primary style: /api?action=...
  const action = url.searchParams.get("action");
  if (action) return action;

  // Secondary style (just in case): /api/getadminstatus
  const parts = url.pathname.split("/").filter(Boolean);
  // e.g. ["api", "getadminstatus"]
  if (parts.length >= 2 && parts[0] === "api") return parts[1];

  return null;
}

async function readJsonBody(request) {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- Optional KV persistence helpers ----
async function kvGet(env, key, fallback) {
  if (!env?.DFD_KV) return fallback;
  const raw = await env.DFD_KV.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function kvPut(env, key, value) {
  if (!env?.DFD_KV) return false;
  await env.DFD_KV.put(key, JSON.stringify(value));
  return true;
}

// ---- In-memory fallback (non-persistent) ----
const mem = {
  weeklyConfig: {
    scbaWeekly: "Sunday",
    pumpWeekly: "Sunday",
    aerialWeekly: "Sunday",
    sawWeekly: "Sunday",
    batteriesWeekly: "Sunday",
  },
  emailConfig: {
    // key: `${group}:${stationId}`
    recipients: {},
  },
  inventoryMaster: [
    {
      itemId: "INV-001",
      category: "Medical",
      type: "Bag",
      identifier: "Trauma Kit",
      description: "Trauma kit refill pack",
      stationId: "1",
      unit: "E1",
      slot: "Compartment A",
      status: "In Service",
      lastUpdated: new Date().toISOString(),
      updatedBy: "System",
      notes: "",
    },
  ],
  issues: [
    {
      apparatusId: "E1",
      issueText: "SCBA bottle hydro due soon",
      note: "Check dates on Bottle #12",
      status: "OPEN",
      stationId: "1",
      timestamp: new Date().toISOString(),
    },
  ],
};

// Keys if using KV
const KV_KEYS = {
  weekly: "dfd:weeklyConfig",
  email: "dfd:emailConfig",
  invMaster: "dfd:inventoryMaster",
  issues: "dfd:issues",
};

// ---- Action handlers ----
async function handleGetAdminStatus(env) {
  // Your admin dashboard expects:
  // response.status.rows[].checks.<checkName>.ok
  // See renderStatusDashboard usage. 6

  // Minimal synthetic dataset
  const rows = [
    {
      stationId: "1",
      stationName: "Station 1",
      apparatusId: "E1",
      checks: {
        apparatusDaily: { ok: true },
        medicalDaily: { ok: true },
        scbaWeekly: { ok: true },
        pumpWeekly: { ok: true },
        aerialWeekly: null, // not applicable
        sawWeekly: { ok: true },
        batteriesWeekly: { ok: true },
      },
    },
    {
      stationId: "2",
      stationName: "Station 2",
      apparatusId: "E2",
      checks: {
        apparatusDaily: { ok: false },
        medicalDaily: { ok: true },
        scbaWeekly: { ok: true },
        pumpWeekly: null,
        aerialWeekly: null,
        sawWeekly: { ok: true },
        batteriesWeekly: { ok: true },
      },
    },
  ];

  return ok({ status: { rows } });
}

async function handleGetActiveIssues(url, env) {
  const stationId = url.searchParams.get("stationId") || "";
  const issues = (await kvGet(env, KV_KEYS.issues, mem.issues)) || [];

  const filtered = stationId
    ? issues.filter((i) => String(i.stationId || "") === String(stationId))
    : issues;

  // Front-end expects response.issues and fields issue.apparatusId/issue.issueText/status/note 7
  return ok({ issues: filtered });
}

async function handleSearchRecords(url, env) {
  // Front-end expects response.results[] with:
  // timestamp, stationId, apparatusId, category, submitter, summary 8

  const category = url.searchParams.get("category") || "all";
  const stationId = url.searchParams.get("stationId") || "all";
  const apparatusId = url.searchParams.get("apparatusId") || "all";
  const query = (url.searchParams.get("query") || "").toLowerCase();

  // You can later swap this to a real DB.
  const all = [
    {
      timestamp: new Date().toISOString(),
      stationId: "1",
      apparatusId: "E1",
      category: "inventory",
      submitter: "System",
      summary: "Example inventory update",
    },
    {
      timestamp: new Date().toISOString(),
      stationId: "2",
      apparatusId: "E2",
      category: "maintenance",
      submitter: "System",
      summary: "Example maintenance note",
    },
  ];

  const results = all.filter((r) => {
    if (category !== "all" && r.category !== category) return false;
    if (stationId !== "all" && r.stationId !== stationId) return false;
    if (apparatusId !== "all" && r.apparatusId !== apparatusId) return false;
    if (query && !(r.summary || "").toLowerCase().includes(query)) return false;
    return true;
  });

  return ok({ results });
}

async function handleGetInventoryItems(url, env) {
  // Inventory expects response.items array used by renderInventoryTable 9
  // tab param is optional (you currently call master inventory)
  const tab = url.searchParams.get("tab") || "Inventory_Master";

  // For now: only master list implemented
  const master = (await kvGet(env, KV_KEYS.invMaster, mem.inventoryMaster)) || [];
  if (tab !== "Inventory_Master") {
    // Return empty but valid
    return ok({ items: [] });
  }

  return ok({ items: master });
}

async function handleAddInventoryItem(request, url, env) {
  const body = (await readJsonBody(request)) || {};
  // Accept either query params or JSON body
  const tab = body.tab || url.searchParams.get("tab") || "Inventory_Master";

  const master = (await kvGet(env, KV_KEYS.invMaster, mem.inventoryMaster)) || [];
  if (tab !== "Inventory_Master") return err("Only Inventory_Master is implemented in this starter API.");

  const item = {
    itemId: body.itemId || `INV-${String(Date.now()).slice(-6)}`,
    category: body.category || "",
    type: body.type || "",
    identifier: body.identifier || "",
    description: body.description || body.name || "",
    stationId: body.stationId || "",
    unit: body.unit || "",
    slot: body.slot || "",
    status: body.status || "In Service",
    lastUpdated: new Date().toISOString(),
    updatedBy: body.user || body.updatedBy || "Unknown",
    notes: body.notes || "",
  };

  master.unshift(item);
  await kvPut(env, KV_KEYS.invMaster, master);

  return ok({ item, items: master });
}

async function handleRemoveInventoryItem(request, url, env) {
  const body = (await readJsonBody(request)) || {};
  const tab = body.tab || url.searchParams.get("tab") || "Inventory_Master";
  const itemId = body.itemId || url.searchParams.get("itemId");

  if (!itemId) return err("Missing itemId");

  const master = (await kvGet(env, KV_KEYS.invMaster, mem.inventoryMaster)) || [];
  if (tab !== "Inventory_Master") return err("Only Inventory_Master is implemented in this starter API.");

  const next = master.filter((x) => String(x.itemId) !== String(itemId));
  await kvPut(env, KV_KEYS.invMaster, next);

  return ok({ removed: itemId, items: next });
}

async function handleGetWeeklyConfig(env) {
  const weeklyConfig = await kvGet(env, KV_KEYS.weekly, mem.weeklyConfig);
  return ok({ weeklyConfig });
}

async function handleSetWeeklyDay(request, env) {
  const body = (await readJsonBody(request)) || {};
  const checkType = body.checkType;
  const dueWeekday = body.dueWeekday;

  if (!checkType || !dueWeekday) return err("Missing checkType or dueWeekday");

  const weeklyConfig = await kvGet(env, KV_KEYS.weekly, mem.weeklyConfig);
  weeklyConfig[checkType] = dueWeekday;

  await kvPut(env, KV_KEYS.weekly, weeklyConfig);
  return ok({ weeklyConfig });
}

async function handleGetEmailConfig(env) {
  const emailConfig = await kvGet(env, KV_KEYS.email, mem.emailConfig);
  return ok({ emails: emailConfig });
}

async function handleSetEmailConfig(request, env) {
  const body = (await readJsonBody(request)) || {};
  const group = body.group;
  const stationId = body.stationId;
  const emails = body.emails;

  if (!group || !stationId || !Array.isArray(emails)) {
    return err("Expected { group, stationId, emails: [] }");
  }

  const emailConfig = await kvGet(env, KV_KEYS.email, mem.emailConfig);
  const key = `${group}:${stationId}`;
  emailConfig.recipients[key] = emails;

  await kvPut(env, KV_KEYS.email, emailConfig);
  return ok({ emails: emailConfig });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Preflight (if you ever hit this cross-origin)
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  const action = getAction(url);
  if (!action) return err("Missing action", 400);

  try {
    // GET actions
    if (request.method === "GET") {
      switch (action) {
        case "getadminstatus":
          return await handleGetAdminStatus(env);

        case "getactiveissues":
          return await handleGetActiveIssues(url, env);

        case "searchrecords":
          return await handleSearchRecords(url, env);

        case "getinventoryitems":
          return await handleGetInventoryItems(url, env);

        case "getweeklyconfig":
          return await handleGetWeeklyConfig(env);

        case "getemailconfig":
          return await handleGetEmailConfig(env);

        default:
          return err(`Unknown action: ${action}`, 404);
      }
    }

    // POST actions
    if (request.method === "POST") {
      switch (action) {
        case "addinventoryitem":
          return await handleAddInventoryItem(request, url, env);

        case "removeinventoryitem":
          return await handleRemoveInventoryItem(request, url, env);

        case "setweeklyday":
          return await handleSetWeeklyDay(request, env);

        case "setemailconfig":
          return await handleSetEmailConfig(request, env);

        default:
          return err(`Unknown action: ${action}`, 404);
      }
    }

    return err("Method not allowed", 405);
  } catch (e) {
    return err("Server error", 500, { detail: e?.message || String(e) });
  }
}