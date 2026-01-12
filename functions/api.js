/**
 * Cloudflare Pages Function: /api
 * Proxies requests to your Google Apps Script Web App backend.
 *
 * Required env var:
 *   GAS_WEBAPP_URL = "https://script.google.com/macros/s/...../exec"
 *
 * Optional env var:
 *   GAS_API_KEY = "long-secret"
 *
 * Compatibility shims included:
 * - Search: frontend uses `query`, Apps Script expects `q` (GET + POST)
 * - POST: if frontend sends action in query string but not in JSON body, we inject body.action
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function error(message, status = 400, extra = {}) {
  return json({ ok: false, error: message, ...extra }, status);
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function readText(request) {
  try {
    return await request.text();
  } catch {
    return "";
  }
}

function buildGasUrl(env, requestUrl) {
  const inUrl = new URL(requestUrl);
  const outUrl = new URL(env.GAS_WEBAPP_URL);

  // Copy all incoming query params through to GAS
  for (const [k, v] of inUrl.searchParams.entries()) {
    outUrl.searchParams.set(k, v);
  }

  // ---- Compatibility shim: frontend uses "query", GAS expects "q" ----
  if (!outUrl.searchParams.has("q") && outUrl.searchParams.has("query")) {
    outUrl.searchParams.set("q", outUrl.searchParams.get("query") || "");
  }

  // Optional: pass key as query param (Apps Script can read e.parameter.key)
  if (env.GAS_API_KEY && !outUrl.searchParams.has("key")) {
    outUrl.searchParams.set("key", env.GAS_API_KEY);
  }

  return outUrl.toString();
}

/**
 * Your GAS routePost reads body.action, but some frontends send action in query string.
 * This ensures body.action is always present for POST.
 */
function normalizePostBodyAction(inUrl, bodyObj) {
  const queryAction = (inUrl.searchParams.get("action") || "").trim();
  const bodyAction =
    bodyObj && typeof bodyObj.action === "string" ? bodyObj.action.trim() : "";

  if (!bodyAction && queryAction) {
    return { ...(bodyObj || {}), action: queryAction };
  }
  return bodyObj || {};
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.GAS_WEBAPP_URL) {
    return error("Missing GAS_WEBAPP_URL environment variable.", 500);
  }

  // CORS preflight
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

  const inUrl = new URL(request.url);
  const gasUrl = buildGasUrl(env, request.url);

  const outHeaders = new Headers();
  outHeaders.set("accept", "application/json");

  const contentType = request.headers.get("content-type");
  if (contentType) outHeaders.set("content-type", contentType);

  // Optional key as header too (harmless; GAS usually reads query params more reliably)
  if (env.GAS_API_KEY) outHeaders.set("x-api-key", env.GAS_API_KEY);

  // ---- GET: forward directly to Apps Script doGet(e) ----
  if (request.method === "GET") {
    let gasResp;
    try {
      gasResp = await fetch(gasUrl, { method: "GET", headers: outHeaders });
    } catch (e) {
      return error("Failed to reach Apps Script backend.", 502, { detail: String(e) });
    }

    const text = await gasResp.text();
    const parsed = safeParseJson(text);

    if (!parsed) {
      return error("Apps Script did not return JSON.", 502, {
        statusFromGas: gasResp.status,
        bodySnippet: text.slice(0, 900),
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: gasResp.status,
      headers: JSON_HEADERS,
    });
  }

  // ---- POST: require JSON + forward to Apps Script doPost(e) ----
  if (request.method === "POST") {
    const raw = await readText(request);
    const bodyObj = safeParseJson(raw);

    // Your GAS routePost does JSON.parse(e.postData.contents), so we must send JSON.
    if (!bodyObj) return error("POST body must be JSON.", 400);

    let normalized = normalizePostBodyAction(inUrl, bodyObj);

    // ---- Compatibility shim: frontend might send "query", GAS expects "q" ----
    if (!normalized.q && normalized.query) normalized.q = normalized.query;

    // Optional key in body too (if you enforce it on GAS side later)
    if (env.GAS_API_KEY && !normalized.key) normalized.key = env.GAS_API_KEY;

    let gasResp;
    try {
      gasResp = await fetch(gasUrl, {
        method: "POST",
        headers: {
          ...Object.fromEntries(outHeaders.entries()),
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(normalized),
      });
    } catch (e) {
      return error("Failed to reach Apps Script backend.", 502, { detail: String(e) });
    }

    const text = await gasResp.text();
    const parsed = safeParseJson(text);

    if (!parsed) {
      return error("Apps Script did not return JSON.", 502, {
        statusFromGas: gasResp.status,
        bodySnippet: text.slice(0, 900),
      });
    }

    return new Response(JSON.stringify(parsed), {
      status: gasResp.status,
      headers: JSON_HEADERS,
    });
  }

  return error("Method not allowed", 405);
}
