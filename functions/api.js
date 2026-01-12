/**
 * Cloudflare Pages Function: /api
 * Proxy to Google Apps Script Web App (your real backend).
 *
 * Why:
 * - Your UI calls /api?action=...
 * - Cloudflare Pages is static, so /api must be implemented as a Function.
 * - Your existing api.js is a mock (KV/in-memory) and does not match your GAS actions.
 *
 * Required env var:
 *   GAS_WEBAPP_URL = "https://script.google.com/macros/s/....../exec"
 *
 * Optional env var:
 *   GAS_API_KEY = "long-secret"
 *   - We pass it as query param `key` (Apps Script can read e.parameter.key)
 *   - And as header `x-api-key` (harmless; GAS may not read headers reliably)
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

async function readText(request) {
  try {
    return await request.text();
  } catch {
    return "";
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildGasUrl(env, requestUrl) {
  const inUrl = new URL(requestUrl);
  const outUrl = new URL(env.GAS_WEBAPP_URL);

  // Copy all query params the frontend passed (action, stationId, etc.)
  for (const [k, v] of inUrl.searchParams.entries()) {
    outUrl.searchParams.set(k, v);
  }

  // Optional shared secret (recommended)
  if (env.GAS_API_KEY && !outUrl.searchParams.has("key")) {
    outUrl.searchParams.set("key", env.GAS_API_KEY);
  }

  return outUrl.toString();
}

/**
 * Ensures Apps Script POST router receives body.action.
 * Your GAS routePost uses:
 *   const action = ((body.action||"")+"").toLowerCase();
 *
 * But your frontend might send action via query (/api?action=setweeklyday) OR in JSON body.
 * We normalize so GAS always gets body.action.
 */
function normalizePostBodyAction(inUrl, bodyObj) {
  const queryAction = (inUrl.searchParams.get("action") || "").trim();
  const bodyAction = (bodyObj && typeof bodyObj.action === "string") ? bodyObj.action.trim() : "";

  if (!bodyAction && queryAction) {
    return { ...(bodyObj || {}), action: queryAction };
  }
  return bodyObj || {};
}

export async function onRequest(context) {
  const { request, env } = context;

  if (!env.GAS_WEBAPP_URL) {
    return error(
      "Missing GAS_WEBAPP_URL environment variable (Apps Script Web App URL).",
      500
    );
  }

  // CORS preflight (safe)
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

  // Build outgoing headers
  const outHeaders = new Headers();
  outHeaders.set("accept", "application/json");

  const contentType = request.headers.get("content-type");
  if (contentType) outHeaders.set("content-type", contentType);

  if (env.GAS_API_KEY) {
    outHeaders.set("x-api-key", env.GAS_API_KEY);
  }

  // Forward GET directly (Apps Script uses e.parameter.action, etc.)
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

  // Forward POST, ensuring body.action is present for your GAS router
  if (request.method === "POST") {
    const raw = await readText(request);

    // If the frontend posts JSON, normalize it.
    // If it posts non-JSON, we’ll forward as-is (but your GAS expects JSON for routePost).
    const bodyObj = safeParseJson(raw);
    let outBody = raw;

    if (bodyObj) {
      const normalized = normalizePostBodyAction(inUrl, bodyObj);

      // Also pass key in body (optional). GAS can validate body.key if you implement it.
      if (env.GAS_API_KEY && !normalized.key) {
        normalized.key = env.GAS_API_KEY;
      }

      outBody = JSON.stringify(normalized);
      outHeaders.set("content-type", "application/json; charset=utf-8");
    }

    let gasResp;
    try {
      gasResp = await fetch(gasUrl, {
        method: "POST",
        headers: outHeaders,
        body: outBody,
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
