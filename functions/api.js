export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response("", { status: 204, headers: corsHeaders() });
  }

  try {
    if (request.method === "GET") {
      const action = (url.searchParams.get("action") || "").toLowerCase();
      const out = await handleGet(action, url.searchParams, env);
      return json(out);
    }

    // POST
    const bodyText = await request.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    const action = String(body.action || "").toLowerCase();

    // Optional write protection
    if (isWriteAction(action)) {
      const token = request.headers.get("X-INGEST-TOKEN") || "";
      if (env.INGEST_TOKEN && token !== env.INGEST_TOKEN) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
    }

    const out = await handlePost(action, body, env);
    return json(out);
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err) }, 500);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, X-INGEST-TOKEN",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isWriteAction(action) {
  return ["savecheck", "updateissue", "setweeklyday", "setemailrecipients"].includes(action);
}

/* -------------------
   CONFIG DATA
   Update this to your real station/apparatus list + drug list.
------------------- */
const STATIONS = [
  { stationId: "1", stationName: "Station 1", apparatus: ["E-1", "T-1"] },
  { stationId: "2", stationName: "Station 2", apparatus: ["T-2"] },
  { stationId: "3", stationName: "Station 3", apparatus: ["E-3"] },
  { stationId: "4", stationName: "Station 4", apparatus: ["E-4"] },
  { stationId: "5", stationName: "Station 5", apparatus: ["E-5"] },
  { stationId: "6", stationName: "Station 6", apparatus: ["E-6"] },
  { stationId: "7", stationName: "Station 7", apparatus: ["E-7"] },
  { stationId: "R", stationName: "Reserve Apparatus", apparatus: ["T-3", "E-8", "E-9", "R-1"] },
];

const CONFIG = {
  stationIdDefault: "1",
  stations: STATIONS.map((s) => ({ stationId: s.stationId, stationName: s.stationName })),
  drugs: [],       // optional: put your drug list here
  defaultQty: {},  // optional
};

function apparatusListForStation(stationId) {
  const st = STATIONS.find((s) => String(s.stationId) === String(stationId));
  const list = st?.apparatus || [];
  return list.map((id) => ({ apparatusId: id, apparatusName: id }));
}

async function handleGet(action, qs, env) {
  switch (action) {
    case "getconfig":
      return { ok: true, config: CONFIG };

    case "getapparatus": {
      const stationId = (qs.get("stationId") || "1").trim();
      return { ok: true, apparatus: apparatusListForStation(stationId) };
    }

    case "getactiveissues": {
      const stationId = (qs.get("stationId") || "1").trim();
      const apparatusId = (qs.get("apparatusId") || "").trim();
      const r = await env.DB.prepare(
        `SELECT * FROM issues
         WHERE stationId=? AND apparatusId=? AND status='open'
         ORDER BY created_ts DESC`
      )
        .bind(stationId, apparatusId)
        .all();
      return { ok: true, issues: r.results || [] };
    }

    case "getadminstatus": {
      // weeklyConfig
      const weekly = await env.DB.prepare(`SELECT checkKey, weekday FROM weekly_config`).all();
      const weeklyConfig = {};
      (weekly.results || []).forEach((r) => (weeklyConfig[r.checkKey] = r.weekday));

      // emailRecipients
      const emails = await env.DB.prepare(`SELECT groupKey, emails_json FROM email_recipients`).all();
      const emailRecipients = {};
      (emails.results || []).forEach((r) => {
        try {
          emailRecipients[r.groupKey] = JSON.parse(r.emails_json || "[]");
        } catch {
          emailRecipients[r.groupKey] = [];
        }
      });

      // apparatus status rows (computed by last check timestamps)
      const rows = [];
      for (const st of STATIONS) {
        for (const ap of st.apparatus) {
          const checks = await latestChecksFor(env, st.stationId, ap);
          rows.push({
            stationId: st.stationId,
            stationName: st.stationName,
            apparatusId: ap,
            checks,
            weeklyConfig,
            emailRecipients,
          });
        }
      }
      return { ok: true, status: { rows, weeklyConfig, emailRecipients } };
    }

    case "searchrecords": {
      const category = (qs.get("category") || "").trim();
      const stationId = (qs.get("stationId") || "all").trim();
      const apparatusId = (qs.get("apparatusId") || "all").trim();
      const q = (qs.get("q") || "").trim().toLowerCase();
      const from = (qs.get("from") || "").trim();
      const to = (qs.get("to") || "").trim();
      const limit = Number(qs.get("limit") || 200);

      const where = [];
      const args = [];

      if (category && category !== "all") {
        where.push(`checkType=?`);
        args.push(category);
      }
      if (stationId !== "all") {
        where.push(`stationId=?`);
        args.push(stationId);
      }
      if (apparatusId !== "all") {
        where.push(`apparatusId=?`);
        args.push(apparatusId);
      }
      if (from) {
        where.push(`timestamp >= ?`);
        args.push(from + "T00:00:00.000Z");
      }
      if (to) {
        where.push(`timestamp <= ?`);
        args.push(to + "T23:59:59.999Z");
      }
      if (q) {
        where.push(`(LOWER(summary) LIKE ? OR LOWER(payload_json) LIKE ? OR LOWER(submitter) LIKE ?)`);
        args.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }

      const sql = `
        SELECT timestamp, stationId, apparatusId, checkType as category, submitter, summary
        FROM checks
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY timestamp DESC
        LIMIT ?
      `;
      const r = await env.DB.prepare(sql).bind(...args, limit).all();
      return { ok: true, results: r.results || [] };
    }

    default:
      return { ok: false, error: "Unknown action" };
  }
}

async function handlePost(action, body, env) {
  switch (action) {
    case "getsearchmeta":
      return {
        ok: true,
        meta: {
          stations: STATIONS.map((s) => ({
            stationId: s.stationId,
            stationName: s.stationName,
            apparatus: s.apparatus.map((a) => ({ apparatusId: a, apparatusName: a })),
          })),
        },
      };

    case "setweeklyday": {
      const checkKey = String(body.checkKey || "").trim();
      const weekday = String(body.weekday || "").trim();
      const user = String(body.user || "").trim();
      if (!checkKey || !weekday || !user) return { ok: false, error: "Missing fields" };

      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO weekly_config(checkKey, weekday, updated_ts, updated_by)
         VALUES(?,?,?,?)
         ON CONFLICT(checkKey) DO UPDATE SET
           weekday=excluded.weekday, updated_ts=excluded.updated_ts, updated_by=excluded.updated_by`
      )
        .bind(checkKey, weekday, now, user)
        .run();

      return { ok: true, saved: true };
    }

    case "setemailrecipients": {
      const user = String(body.user || "").trim();
      const emails = body.emails || {};
      if (!user) return { ok: false, error: "Missing user" };

      const now = new Date().toISOString();
      for (const [groupKey, list] of Object.entries(emails)) {
        if (!Array.isArray(list)) continue;
        await env.DB.prepare(
          `INSERT INTO email_recipients(groupKey, emails_json, updated_ts, updated_by)
           VALUES(?,?,?,?)
           ON CONFLICT(groupKey) DO UPDATE SET
             emails_json=excluded.emails_json, updated_ts=excluded.updated_ts, updated_by=excluded.updated_by`
        )
          .bind(groupKey, JSON.stringify(list), now, user)
          .run();
      }
      return { ok: true, saved: true };
    }

    case "updateissue": {
      const issueId = String(body.issueId || "").trim();
      const user = String(body.user || "").trim();
      const changes = body.changes || {};
      if (!issueId || !user) return { ok: false, error: "Missing fields" };

      const now = new Date().toISOString();
      const set = [];
      const args = [];

      if (typeof changes.status === "string") {
        const s = changes.status.toLowerCase();
        set.push(`status=?`);
        args.push(s === "resolved" ? "cleared" : s);
        if (s === "resolved" || s === "cleared") {
          set.push(`cleared_ts=?`, `cleared_by=?`);
          args.push(now, user);
        }
      }

      if (typeof changes.acknowledged === "boolean") {
        if (changes.acknowledged) {
          set.push(`ack_ts=?`, `ack_by=?`);
          args.push(now, user);
        } else {
          set.push(`ack_ts=NULL`, `ack_by=NULL`);
        }
      }

      set.push(`updated_ts=?`);
      args.push(now);

      await env.DB.prepare(`UPDATE issues SET ${set.join(", ")} WHERE id=?`)
        .bind(...args, issueId)
        .run();

      return { ok: true, updated: true };
    }

    case "savecheck": {
      const stationId = String(body.stationId || "1").trim();
      const apparatusId = String(body.apparatusId || "").trim();
      const submitter = String(body.submitter || "").trim();
      const checkType = String(body.checkType || "").trim();
      const payload = body.checkPayload || {};

      if (!apparatusId || !submitter || !checkType) return { ok: false, error: "Missing fields" };

      const ts = new Date().toISOString();
      const id = crypto.randomUUID();
      const summary = String(checkType);

      await env.DB.prepare(
        `INSERT INTO checks(id, timestamp, stationId, apparatusId, checkType, submitter, payload_json, summary)
         VALUES(?,?,?,?,?,?,?,?)`
      )
        .bind(id, ts, stationId, apparatusId, checkType, submitter, JSON.stringify(payload), summary)
        .run();

      // Create issue if provided
      const newIssueText = String(body.newIssueText || "").trim();
      const newIssueNote = String(body.newIssueNote || "").trim();
      if (newIssueText) {
        const iid = crypto.randomUUID();
        await env.DB.prepare(
          `INSERT INTO issues(id, created_ts, updated_ts, stationId, apparatusId, text, note, created_by, status)
           VALUES(?,?,?,?,?,?,?,?, 'open')`
        )
          .bind(iid, ts, ts, stationId, apparatusId, newIssueText, newIssueNote, submitter)
          .run();

        // Email routing happens in the BACKUP worker or a separate notification worker if you want emails.
        // For now this endpoint just stores the issue.
      }

      return { ok: true, saved: true };
    }

    default:
      return { ok: false, error: "Unknown action" };
  }
}

async function latestChecksFor(env, stationId, apparatusId) {
  const keys = ["apparatusDaily", "medicalDaily", "scbaWeekly", "pumpWeekly", "aerialWeekly", "sawWeekly", "batteriesWeekly"];
  const out = {};
  for (const k of keys) {
    const r = await env.DB.prepare(
      `SELECT timestamp FROM checks
       WHERE stationId=? AND apparatusId=? AND checkType=?
       ORDER BY timestamp DESC LIMIT 1`
    )
      .bind(stationId, apparatusId, k)
      .first();
    if (r?.timestamp) out[k] = { ok: true, last: r.timestamp };
    else out[k] = { ok: false, last: null };
  }
  return out;
}
