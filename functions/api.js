export async function onRequest(context) {
  const { request, env } = context;

  
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders(request) });
  }

  const gasUrl =
    env.GAS_URL ||
    "https://script.google.com/macros/s/AKfycbylaEuhoPauzxZK9ob_Q-xvc35gEVbsHCcSgvRV-OFs098yWHrNitrTeednxEYA2qpJag/exec";
  if (!gasUrl) {
    return json(
      { ok: false, error: "Server not configured: missing GAS_URL (Pages env var)." },
      500,
      request
    );
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const qs = url.searchParams.toString();
      const target = qs ? `${gasUrl}?${qs}` : gasUrl;

      const res = await fetch(target, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      return await passthroughJson(res, request);
    }

    if (request.method === "POST") {
      const bodyText = await request.text();

      const res = await fetch(gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") || "application/json",
          Accept: "application/json",
        },
        body: bodyText,
      });

      return await passthroughJson(res, request);
    }

    return json({ ok: false, error: "Method not allowed" }, 405, request);
  } catch (err) {
    return json(
      { ok: false, error: `Proxy error: ${err?.message || String(err)}` },
      500,
      request
    );
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Accept,X-Requested-With",
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}

async function passthroughJson(res, request) {
  const text = await res.text();

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = {
      ok: false,
      error: "Non-JSON response from GAS",
      status: res.status,
      body: text.slice(0, 2000),
    };
  }

  return new Response(JSON.stringify(payload), {
    status: res.ok ? 200 : (res.status || 500),
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(request),
    },
  });
}
