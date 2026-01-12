const $ = (s) => document.querySelector(s);

function toast(msg, ms = 2200) {
  const t = $("#toast");
  $("#toastText").textContent = msg || "OK";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

async function apiGet(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api?${qs.toString()}`, { method: "GET" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Bad JSON from /api: ${text.slice(0, 200)}`); }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function apiPost(body) {
  const res = await fetch(`/api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Bad JSON from /api: ${text.slice(0, 200)}`); }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

let META = null;

function ymdTodayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtLocal(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso || "";
    return d.toLocaleString();
  } catch {
    return iso || "";
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStationOptions(meta) {
  const sel = $("#stationId");
  sel.innerHTML =
    `<option value="all">All Stations</option>` +
    (meta.stations || [])
      .map((s) => `<option value="${escapeHtml(s.stationId)}">${escapeHtml(s.stationName)}</option>`)
      .join("");
}

function setApparatusOptions(meta, stationId) {
  const sel = $("#apparatusId");
  let list = [];

  if (stationId && stationId !== "all") {
    const st = (meta.stations || []).find((x) => String(x.stationId) === String(stationId));
    list = st && st.apparatus ? st.apparatus : [];
  } else {
    // all stations -> merge apparatus
    const map = new Map();
    (meta.stations || []).forEach((st) => {
      (st.apparatus || []).forEach((a) => map.set(a.apparatusId, a));
    });
    list = Array.from(map.values()).sort((a, b) =>
      String(a.apparatusId).localeCompare(String(b.apparatusId), undefined, { numeric: true, sensitivity: "base" })
    );
  }

  sel.innerHTML =
    `<option value="all">All Apparatus</option>` +
    list
      .map((a) => {
        const id = String(a.apparatusId || "").trim();
        const name = String(a.apparatusName || a.apparatusId || "").trim();
        return `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`;
      })
      .join("");
}

function renderResults(rows) {
  const tb = $("#results tbody");
  tb.innerHTML = "";

  if (!rows || !rows.length) {
    tb.innerHTML = `<tr><td colspan="6" class="note">No matches.</td></tr>`;
    $("#resultCount").textContent = "0 results";
    return;
  }

  $("#resultCount").textContent = `${rows.length} result(s)`;

  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td data-label="Timestamp">${escapeHtml(fmtLocal(r.timestamp))}</td>
      <td data-label="Station">${escapeHtml(r.stationId || "")}</td>
      <td data-label="Apparatus">${escapeHtml(r.apparatusId || "")}</td>
      <td data-label="Category">${escapeHtml(r.category || "")}</td>
      <td data-label="Submitter">${escapeHtml(r.submitter || "")}</td>
      <td data-label="Summary">${escapeHtml(String(r.summary || ""))}</td>
    `;
    tb.appendChild(tr);
  }
}

/* IMPORTANT FIX:
   Your Code.gs defines getSearchMeta under doPost(), not doGet().
   So we must call POST /api {action:"getSearchMeta"}.
*/
async function loadMeta() {
  const res = await apiPost({ action: "getSearchMeta" });
  META = res.meta;

  setStationOptions(META);
  setApparatusOptions(META, "all");
}

function labelCategory_(cat) {
  const map = {
    apparatusDaily: "Apparatus Daily",
    medicalDaily: "Medical Daily",
    scbaWeekly: "SCBA Weekly",
    pumpWeekly: "Pump Weekly",
    aerialWeekly: "Aerial Weekly",
    sawWeekly: "Saws Weekly",
    batteriesWeekly: "Batteries Weekly",
    oosUnit: "Out of Service Units",
    oosEquipment: "Out of Service Equipment",
    issues: "Issues",
    medAlerts: "Drug Expiration Email Alerts"
  };
  return map[cat] || cat || "";
}

/* Category optional:
   - If user selects "All Categories", we run multiple searches (one per category)
     and merge results (newest first).
   Why we do it this way:
   - Your searchRecords_() currently requires a single category.
   - This makes “category optional” work without changing Code.gs today.
*/
const ALL_CATEGORIES = [
  "apparatusDaily",
  "medicalDaily",
  "scbaWeekly",
  "pumpWeekly",
  "aerialWeekly",
  "sawWeekly",
  "batteriesWeekly",
  "oosUnit",
  "oosEquipment",
  "issues",
  "medAlerts"
];

async function runSearch() {
  const stationId = $("#stationId").value || "all";
  const apparatusId = $("#apparatusId").value || "all";
  const category = $("#category").value || "all";
  const from = $("#from").value || "";
  const to = $("#to").value || "";
  const q = ($("#q").value || "").trim();
  const limit = Number($("#limit").value || 200);

  // single category
  if (category !== "all") {
    const res = await apiGet({
      action: "searchRecords",
      stationId,
      apparatusId,
      category,
      from,
      to,
      q,
      limit
    });
    renderResults(res.results || []);
    return;
  }

  // all categories (fan-out) and merge
  const perCatLimit = Math.max(25, Math.floor(limit / 3)); // keep requests reasonable
  const calls = ALL_CATEGORIES.map((cat) =>
    apiGet({
      action: "searchRecords",
      stationId,
      apparatusId,
      category: cat,
      from,
      to,
      q,
      limit: String(perCatLimit)
    }).then((r) => (r.results || []).map((x) => ({ ...x, category: x.category || cat })))
      .catch(() => []) // don’t fail everything if one category errors
  );

  const parts = await Promise.all(calls);
  let merged = parts.flat();

  // sort newest first
  merged.sort((a, b) => {
    const at = new Date(a.timestamp || 0).getTime();
    const bt = new Date(b.timestamp || 0).getTime();
    return bt - at;
  });

  // trim to requested limit
  merged = merged.slice(0, limit);

  // prettify category labels in table (optional)
  merged = merged.map(r => ({ ...r, category: labelCategory_(r.category) }));

  renderResults(merged);
}

async function boot() {
  $("#btnPrint").addEventListener("click", () => window.print());

  $("#stationId").addEventListener("change", () => {
    if (!META) return;
    setApparatusOptions(META, $("#stationId").value);
  });

  $("#btnSearch").addEventListener("click", async () => {
    try {
      $("#resultCount").textContent = "Searching…";
      $("#results tbody").innerHTML = `<tr><td colspan="6" class="note">Searching…</td></tr>`;
      await runSearch();
      toast("Search complete");
    } catch (err) {
      toast(err.message, 3200);
      $("#resultCount").textContent = "—";
      $("#results tbody").innerHTML = `<tr><td colspan="6" class="note">${escapeHtml(err.message)}</td></tr>`;
    }
  });

  // defaults
  $("#to").value = ymdTodayLocal();
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const pad = (n) => String(n).padStart(2, "0");
  $("#from").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  try {
    await loadMeta();
    toast("Loaded");
  } catch (err) {
    toast(err.message, 3200);
  }
}

document.addEventListener("DOMContentLoaded", boot);
