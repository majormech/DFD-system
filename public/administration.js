/* DFD Administration UI (Cloudflare Pages)
   Admin UI now handles ONLY:
     - Apparatus status dashboard
     - Issues (ACK / NEW / OLD / RESOLVED)

   Talks ONLY to /api (Cloudflare Function proxy).

   Endpoints used:
     GET  /api?action=getAdminStatus
     GET  /api?action=listIssues&stationId=1&includeCleared=false
     POST /api  {action:"updateIssue"...}

   NOTE:
     Overall (All Stations) issues are loaded by fetching each station (1..7)
     and merging results client-side. No GAS changes needed.
*/

const $ = (s) => document.querySelector(s);
const STATIONS = ["1", "2", "3", "4", "5", "6", "7", "R"];

function toast(msg, ms = 2200) {
  const t = $("#toast");
  const txt = $("#toastText");
  if (!t || !txt) return;
  txt.textContent = msg || "Saved";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

function loadPrefs() {
  const name = localStorage.getItem("dfd_admin_name") || "";
  const nameEl = $("#adminName");
  if (nameEl) nameEl.value = name;

  const filter = localStorage.getItem("dfd_admin_station_filter") || "all";
  const sel = $("#adminStationFilter");
  if (sel) sel.value = filter;
}

function savePrefs() {
  const nameEl = $("#adminName");
  if (nameEl) localStorage.setItem("dfd_admin_name", (nameEl.value || "").trim());

  const sel = $("#adminStationFilter");
  if (sel) localStorage.setItem("dfd_admin_station_filter", sel.value || "all");
}

function adminName() {
  const el = $("#adminName");
  const n = (el?.value || "").trim();
  if (!n) throw new Error("Enter Admin Name (for logging)");
  return n;
}

function selectedStationFilter() {
  return ($("#adminStationFilter")?.value || "all").trim() || "all";
}

async function apiGet(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api?${qs.toString()}`, { method: "GET" });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from /api: ${text.slice(0, 160)}`);
  }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function apiPost(body) {
  const res = await fetch(`/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from /api: ${text.slice(0, 160)}`);
  }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

/* ---------- Apparatus requirement rules (ADMIN UI only) ----------
  Your rules:
  - E-1: NO Saws Weekly, NO Aerial Weekly
  - R-1: NO Pump Weekly, NO Aerial Weekly, NO Medical Daily
  - T-1/T-2/T-3: DO have pumps, so YES Pump Weekly
*/
function requirementsFor(apparatusIdRaw) {
  const id = String(apparatusIdRaw || "").toUpperCase().trim();

  const HAS_PUMP = new Set(["T-2", "E-3", "E-4", "E-5", "E-6", "E-7", "T-3", "E-8", "E-9"]);
  const HAS_AERIAL = new Set(["T-2", "E-5", "T-3"]);
  const HAS_SAWS = new Set(["T-2", "T-3", "R-1"]);

  return {
    apparatusDaily: true,
    medicalDaily: id !== "R-1",
    scbaWeekly: true,
    pumpWeekly: HAS_PUMP.has(id),
    aerialWeekly: HAS_AERIAL.has(id),
    sawWeekly: HAS_SAWS.has(id),
    batteriesWeekly: true,
  };
}

/* ---------- Helpers ---------- */
function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pill(okOrNull, lastIso) {
  if (okOrNull === null) {
    return `<span class="pill na">N/A</span><span class="sub">—</span>`;
  }
  const last = lastIso ? new Date(lastIso) : null;
  const lastStr = last ? last.toLocaleString() : "—";
  const cls = okOrNull ? "ok" : "bad";
  const label = okOrNull ? "DONE" : "NOT DONE";
  return `<span class="pill ${cls}">${label}</span><span class="sub">Last: ${escapeHtml(
    lastStr
  )}</span>`;
}

/* ---------- Status ---------- */
let LAST_ADMIN_STATUS = null;

function renderStatus(status) {
  const tb = $("#statusTable tbody");
  if (!tb) return;

  tb.innerHTML = "";

  const filter = selectedStationFilter();
  let rows = status?.rows || [];

  if (filter !== "all") {
    rows = rows.filter((r) => String(r.stationId || "") === String(filter));
  }

  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="9" class="note">No apparatus for this view.</td></tr>`;
    return;
  }

  for (const r of rows) {
    const c = r.checks || {};
    const req = requirementsFor(r.apparatusId);

    const cell = (required, obj) => {
      if (!required) return pill(null);
      return pill(!!obj?.ok, obj?.last);
    };

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Station">${escapeHtml(r.stationName || "Station " + r.stationId)}</td>
      <td data-label="Apparatus">${escapeHtml(r.apparatusId)}</td>
      <td data-label="Apparatus Daily">${cell(req.apparatusDaily, c.apparatusDaily)}</td>
      <td data-label="Medical Daily">${cell(req.medicalDaily, c.medicalDaily)}</td>
      <td data-label="SCBA Weekly">${cell(req.scbaWeekly, c.scbaWeekly)}</td>
      <td data-label="Pump Weekly">${cell(req.pumpWeekly, c.pumpWeekly)}</td>
      <td data-label="Aerial Weekly">${cell(req.aerialWeekly, c.aerialWeekly)}</td>
      <td data-label="Saws Weekly">${cell(req.sawWeekly, c.sawWeekly)}</td>
      <td data-label="Batteries Weekly">${cell(req.batteriesWeekly, c.batteriesWeekly)}</td>
    `;
    tb.appendChild(tr);
  }
}

/* ---------- Issues ---------- */
function computedIssueStatus_(iss) {
  const raw = String(iss.status || "").toUpperCase();
  if (raw === "RESOLVED") return "RESOLVED";
  if (raw === "OLD") return "OLD";
  if (raw === "NEW") return "NEW";

  const createdAt = issueCreatedAt_(iss);
  const created = createdAt ? new Date(createdAt).getTime() : null;
  if (!created) return "NEW";
  const ageHours = (Date.now() - created) / (1000 * 60 * 60);
  return ageHours >= 96 ? "OLD" : "NEW";
}

function issueIdFor_(iss) {
  return String(iss?.issueId || iss?.id || iss?.issue_id || "").trim();
}

function issueCreatedAt_(iss) {
  return iss?.createdAt || iss?.created_ts || iss?.createdTs || iss?.created;
}

function issueUpdatedAt_(iss) {
  return iss?.lastUpdatedAt || iss?.updatedAt || iss?.updated_ts || iss?.updatedTs;
}

function issueTextFor_(iss) {
  return iss?.issueText || iss?.text || iss?.issue || "";
}

function issueNoteFor_(iss) {
  return iss?.bulletNote || iss?.note || "";
}

function issueAcknowledged_(iss) {
  return Boolean(iss?.acknowledged || iss?.ack_ts || iss?.acknowledgedAt);
}

function groupByApparatus_(issues) {
  const map = new Map();
  for (const iss of issues || []) {
    const ap = String(iss.apparatusId || "Unknown").trim() || "Unknown";
    if (!map.has(ap)) map.set(ap, []);
    map.get(ap).push(iss);
  }
  const keys = Array.from(map.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
  return keys.map((k) => [k, map.get(k)]);
}

function summarizeUnitIssues_(unitIssues) {
  let newCt = 0,
    oldCt = 0,
    ackCt = 0;
  for (const iss of unitIssues) {
    const computed = computedIssueStatus_(iss);
    if (issueAcknowledged_(iss)) ackCt++;
    else if (computed === "OLD") oldCt++;
    else newCt++;
  }
  return { newCt, oldCt, ackCt, total: unitIssues.length };
}

function renderIssueRow_(iss) {
  const wrap = document.createElement("div");
  wrap.className = "issue";

  const issueId = issueIdFor_(iss);
  const updatedAt = issueUpdatedAt_(iss);
  const updated = updatedAt ? new Date(updatedAt).toLocaleString() : "—";
  const computedStatus = computedIssueStatus_(iss);
  const acknowledged = issueAcknowledged_(iss);

  wrap.classList.remove("hl-new", "hl-old", "hl-ack");
  if (acknowledged) wrap.classList.add("hl-ack");
  else if (computedStatus === "OLD") wrap.classList.add("hl-old");
  else wrap.classList.add("hl-new");

  wrap.innerHTML = `
    <div style="min-width:0">
      <h3>${escapeHtml(iss.apparatusId)} — ${escapeHtml(issueTextFor_(iss))}</h3>
      <div class="meta">
        Status: <b>${escapeHtml(computedStatus)}</b>
        ${acknowledged ? `• <b>ACK</b>` : ``}
        • Updated: ${escapeHtml(updated)}
      </div>
      ${
        issueNoteFor_(iss)
          ? `<div class="meta">Note: ${escapeHtml(issueNoteFor_(iss))}</div>`
          : ``
      }
    </div>

    <div class="right">
      <label class="toggle" title="Checked = Administration has seen it and is working it (green highlight)">
        <input type="checkbox" data-ack="${escapeHtml(issueId)}" ${
          acknowledged ? "checked" : ""
        }>
        ACK
      </label>

      <select data-issue="${escapeHtml(issueId)}">
        <option value="NEW" ${computedStatus === "NEW" ? "selected" : ""}>New</option>
        <option value="OLD" ${computedStatus === "OLD" ? "selected" : ""}>Old</option>
        <option value="RESOLVED">Resolved</option>
      </select>

      <button class="btn" data-apply="${escapeHtml(issueId)}" ${
        issueId ? "" : "disabled"
      }>Apply</button>
    </div>
  `;

  if (!issueId) {
    wrap
      .querySelector(".right")
      ?.insertAdjacentHTML("afterbegin", `<div class="note">Missing issue ID; updates disabled.</div>`);
    return wrap;
  }

  // ACK toggle
  wrap
    .querySelector(`input[data-ack="${CSS.escape(issueId)}"]`)
    ?.addEventListener("change", async (e) => {
      try {
        savePrefs();
        const user = adminName();
        const ack = !!e.target.checked;

        await apiPost({
          action: "updateIssue",
          issueId,
          changes: { acknowledged: ack },
          user,
        });

        toast(ack ? "Acknowledged" : "Un-acknowledged");
        await refreshIssues();
      } catch (err) {
        toast(err.message, 3200);
      }
    });

  // Apply status
  wrap
    .querySelector(`button[data-apply="${CSS.escape(issueId)}"]`)
    ?.addEventListener("click", async () => {
      try {
        savePrefs();
        const user = adminName();
        const status = wrap.querySelector(
          `select[data-issue="${CSS.escape(issueId)}"]`
        ).value;
        const ack = !!wrap.querySelector(`input[data-ack="${CSS.escape(issueId)}"]`).checked;

        await apiPost({
          action: "updateIssue",
          issueId,
          changes: { status, acknowledged: ack },
          user,
        });

        toast(status === "RESOLVED" ? "Issue resolved" : "Issue updated");
        await refreshIssues();
      } catch (err) {
        toast(err.message, 3200);
      }
    });

  return wrap;
}

function renderIssues(issues) {
  const box = $("#issuesBox");
  if (!box) return;

  box.innerHTML = "";

  const active = (issues || []).filter(
    (x) => String(x.status || "").toUpperCase() !== "RESOLVED"
  );
  if (!active.length) {
    box.innerHTML = `<div class="note">No active issues.</div>`;
    return;
  }

  const grouped = groupByApparatus_(active);

  for (const [apparatusId, unitIssuesRaw] of grouped) {
    const unitIssues = [...unitIssuesRaw].sort((a, b) => {
      const aAck = issueAcknowledged_(a),
        bAck = issueAcknowledged_(b);
      if (aAck !== bAck) return aAck ? 1 : -1;

      const aSt = computedIssueStatus_(a);
      const bSt = computedIssueStatus_(b);
      const rank = (st) => (st === "OLD" ? 0 : 1);
      if (rank(aSt) !== rank(bSt)) return rank(aSt) - rank(bSt);

      const aT = new Date(issueUpdatedAt_(a) || issueCreatedAt_(a) || 0).getTime();
      const bT = new Date(issueUpdatedAt_(b) || issueCreatedAt_(b) || 0).getTime();
      return bT - aT;
    });

    const sum = summarizeUnitIssues_(unitIssues);

    const details = document.createElement("details");
    details.className = "unit-group";
    details.open = sum.newCt + sum.oldCt > 0;

    details.innerHTML = `
      <summary class="unit-summary">
        <div class="unit-left">
          <span class="unit-title">${escapeHtml(apparatusId)}</span>
          <span class="unit-meta">
            ${sum.newCt ? `<span class="badge b-new">${sum.newCt} new</span>` : ``}
            ${sum.oldCt ? `<span class="badge b-old">${sum.oldCt} old</span>` : ``}
            ${sum.ackCt ? `<span class="badge b-ack">${sum.ackCt} ack</span>` : ``}
          </span>
        </div>
        <div class="unit-count">${sum.total}</div>
      </summary>
      <div class="unit-body"></div>
    `;

    const body = details.querySelector(".unit-body");
    for (const iss of unitIssues) body.appendChild(renderIssueRow_(iss));
    box.appendChild(details);
  }
}

/* ---------- Filtered Issues Title ---------- */
function stationLabel_(id) {
  if (id === "all") return "Overall (All Stations)";
  if (String(id) === "R") return "Reserve Apparatus";
  return `Station ${id}`;
}

function setIssuesTitle_() {
  const f = selectedStationFilter();
  const el = $("#issuesTitle");
  if (!el) return;
  el.textContent =
    f === "all" ? "Active Issues (All Stations)" : `Active Issues (${stationLabel_(f)})`;
}

/* ---------- Refresh ---------- */
function apparatusSetForStation_(stationId) {
  const set = new Set();
  const rows = LAST_ADMIN_STATUS?.rows || [];
  for (const r of rows) {
    if (String(r.stationId) === String(stationId)) set.add(String(r.apparatusId || "").trim());
  }
  return set;
}

async function fetchIssuesForStation_(stationId) {
  const res = await apiGet({
    action: "listIssues",
    stationId: String(stationId),
    includeCleared: "false",
  });
  return res.issues || [];
}

function dedupeIssuesById_(issues) {
  const map = new Map();
  const noId = [];
  for (const iss of issues || []) {
    const id = issueIdFor_(iss);
    if (!id) {
      noId.push(iss);
      continue;
    }

    const prev = map.get(id);
    if (!prev) {
      map.set(id, iss);
      continue;
    }
    const pT = new Date(issueUpdatedAt_(prev) || issueCreatedAt_(prev) || 0).getTime();
    const nT = new Date(issueUpdatedAt_(iss) || issueCreatedAt_(iss) || 0).getTime();
    if (nT >= pT) map.set(id, iss);
  }
  return Array.from(map.values()).concat(noId);
}

async function refreshIssues() {
  const f = selectedStationFilter();
  let issues = [];

  if (f === "all") {
    const results = await Promise.all(STATIONS.map((st) => fetchIssuesForStation_(st).catch(() => [])));
    issues = dedupeIssuesById_(results.flat());
  } else {
    issues = await fetchIssuesForStation_(f);
  }

  // Extra safety filter if station view is selected
  if (f !== "all") {
    const allowedUnits = apparatusSetForStation_(f);
    issues = issues.filter((iss) => allowedUnits.has(String(iss.apparatusId || "").trim()));
  }

  setIssuesTitle_();
  renderIssues(issues);
}

async function refreshStatus() {
  const s = await apiGet({ action: "getAdminStatus" });
  LAST_ADMIN_STATUS = s.status || null;
  renderStatus(LAST_ADMIN_STATUS || { rows: [] });
}

async function refreshAll() {
  await refreshStatus();
  await refreshIssues();
}

/* ---------- Boot ---------- */
async function boot() {
  loadPrefs();
  setIssuesTitle_();

  $("#btnRefresh")?.addEventListener("click", async () => {
    try {
      savePrefs();
      await refreshAll();
      toast("Refreshed");
    } catch (err) {
      toast(err.message, 3200);
    }
  });

  $("#adminStationFilter")?.addEventListener("change", async () => {
    try {
      savePrefs();
      setIssuesTitle_();

      // re-render status from cache (or fetch if not yet)
      if (LAST_ADMIN_STATUS) renderStatus(LAST_ADMIN_STATUS);
      else await refreshStatus();

      await refreshIssues();
      toast("Filter applied");
    } catch (err) {
      toast(err.message, 3200);
    }
  });

  try {
    await refreshAll();
    toast("Loaded");
  } catch (err) {
    toast(err.message, 3200);
  }
}

document.addEventListener("DOMContentLoaded", boot);
