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
let CURRENT_RESULTS = [];
let FILTERED_RESULTS = [];

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

function normalizeText(s) {
  return String(s || "").toLowerCase();
}

function safeUuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function attentionLevelForRow(row) {
  const combined = normalizeText(
    `${row.category || ""} ${row.summary || ""} ${row.submitter || ""}`
  );
  if (/(out of service|oos|critical|expired|missing|failed|failure)/.test(combined)) {
    return "critical";
  }
  if (/(fail|needs mechanic|broken|leak|not working|immediate)/.test(combined)) {
    return "high";
  }
  if (/(warning|maintenance|service|needs attention|soon|low)/.test(combined)) {
    return "medium";
  }
  return "low";
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
    const priority = attentionLevelForRow(r);
    const priorityLabel = priority[0].toUpperCase() + priority.slice(1);
    tr.innerHTML = `
      <td data-label="Timestamp">${escapeHtml(fmtLocal(r.timestamp))}</td>
      <td data-label="Station">${escapeHtml(r.stationId || "")}</td>
      <td data-label="Apparatus">${escapeHtml(r.apparatusId || "")}</td>
      <td data-label="Category">${escapeHtml(r.category || "")}</td>
      <td data-label="Submitter">${escapeHtml(r.submitter || "")}</td>
      <td data-label="Summary">
        ${escapeHtml(String(r.summary || ""))}
        <span class="pill priority-${escapeHtml(priority)}" style="margin-left:6px">${escapeHtml(priorityLabel)}</span>
      </td>
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

const TEMPLATE_KEY = "dfd_search_templates_v1";

function loadTemplates() {
  try {
    const raw = localStorage.getItem(TEMPLATE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTemplates(list) {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(list));
}

function refreshTemplateOptions() {
  const sel = $("#templateSelect");
  if (!sel) return;
  const templates = loadTemplates();
  sel.innerHTML =
    `<option value="">Select template…</option>` +
    templates
      .map(
        (t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`
      )
      .join("");
}

function currentFilters() {
  return {
    stationId: $("#stationId").value || "all",
    apparatusId: $("#apparatusId").value || "all",
    category: $("#category").value || "all",
    from: $("#from").value || "",
    to: $("#to").value || "",
    q: ($("#q").value || "").trim(),
    limit: $("#limit").value || "200",
    priority: $("#priorityFilter").value || "all",
    periodPreset: $("#periodPreset").value || "",
  };
}

function applyTemplate(template) {
  if (!template) return;
  $("#stationId").value = template.stationId || "all";
  setApparatusOptions(META, $("#stationId").value);
  $("#apparatusId").value = template.apparatusId || "all";
  $("#category").value = template.category || "all";
  $("#from").value = template.from || "";
  $("#to").value = template.to || "";
  $("#q").value = template.q || "";
  $("#limit").value = template.limit || "200";
  $("#priorityFilter").value = template.priority || "all";
  $("#periodPreset").value = template.periodPreset || "";
}

function applyPeriodPreset(value) {
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (date) =>
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  let from = "";
  let to = ymd(today);

  const start = new Date(today);

  switch (value) {
    case "today":
      from = to;
      break;
    case "last7":
      start.setDate(start.getDate() - 6);
      from = ymd(start);
      break;
    case "last30":
      start.setDate(start.getDate() - 29);
      from = ymd(start);
      break;
    case "last90":
      start.setDate(start.getDate() - 89);
      from = ymd(start);
      break;
    case "monthToDate":
      start.setDate(1);
      from = ymd(start);
      break;
    case "yearToDate":
      start.setMonth(0, 1);
      from = ymd(start);
      break;
    case "lastMonth": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      from = ymd(first);
      to = ymd(last);
      break;
    }
    default:
      return;
  }

  $("#from").value = from;
  $("#to").value = to;
}

function applyClientFilters(rows) {
  const priority = $("#priorityFilter").value || "all";
  if (priority === "all") return rows;
  return rows.filter((row) => attentionLevelForRow(row) === priority);
}

function renderSummary(rows) {
  const grid = $("#summaryGrid");
  const range = $("#summaryRange");
  if (!grid || !range) return;

  if (!rows.length) {
    grid.innerHTML = `<div class="summaryCard note">No data to summarize.</div>`;
    range.textContent = "—";
    return;
  }

  const from = $("#from").value || "Any";
  const to = $("#to").value || "Any";
  range.textContent = `Range: ${from} → ${to}`;

  const priorityCounts = rows.reduce((acc, row) => {
    const level = attentionLevelForRow(row);
    acc[level] = (acc[level] || 0) + 1;
    return acc;
  }, {});

  const categoryCounts = rows.reduce((acc, row) => {
    const cat = row.category || "Uncategorized";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const topCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  grid.innerHTML = `
    <div class="summaryCard">
      <div class="note">Total Records</div>
      <div style="font-size:22px;font-weight:900">${rows.length}</div>
    </div>
    <div class="summaryCard">
      <div class="note">Critical</div>
      <div class="pill priority-critical">${priorityCounts.critical || 0}</div>
    </div>
    <div class="summaryCard">
      <div class="note">High</div>
      <div class="pill priority-high">${priorityCounts.high || 0}</div>
    </div>
    <div class="summaryCard">
      <div class="note">Medium</div>
      <div class="pill priority-medium">${priorityCounts.medium || 0}</div>
    </div>
    <div class="summaryCard">
      <div class="note">Low</div>
      <div class="pill priority-low">${priorityCounts.low || 0}</div>
    </div>
    <div class="summaryCard" style="grid-column:1/-1">
      <div class="note" style="margin-bottom:6px">Top Categories</div>
      ${topCategories
        .map(
          ([cat, count]) =>
            `<div style="display:flex;justify-content:space-between;font-weight:700">
              <span>${escapeHtml(cat)}</span><span>${count}</span>
            </div>`
        )
        .join("")}
    </div>
  `;
}

function renderTrends(rows) {
  const list = $("#trendList");
  if (!list) return;
  if (!rows.length) {
    list.textContent = "No data to trend.";
    return;
  }

  const counts = new Map();
  rows.forEach((row) => {
    const date = new Date(row.timestamp || "");
    if (isNaN(date.getTime())) return;
    const key = date.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  const sorted = Array.from(counts.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  const max = Math.max(...sorted.map(([, count]) => count), 1);

  list.innerHTML = sorted
    .map(([date, count]) => {
      const width = Math.max(6, Math.round((count / max) * 100));
      return `
        <div class="trendRow">
          <div>${escapeHtml(date)}</div>
          <div class="trendBar" style="width:${width}%"></div>
          <div style="text-align:right;font-weight:800">${count}</div>
        </div>
      `;
    })
    .join("");
}

function downloadBlob(data, filename, type) {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportCsv(rows) {
  if (!rows.length) return toast("No data to export");
  const headers = ["Timestamp", "Station", "Apparatus", "Category", "Submitter", "Summary"];
  const lines = [
    headers.join(","),
    ...rows.map((r) =>
      [
        fmtLocal(r.timestamp),
        r.stationId || "",
        r.apparatusId || "",
        r.category || "",
        r.submitter || "",
        String(r.summary || "").replaceAll('"', '""'),
      ]
        .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
        .join(",")
    ),
  ];
  downloadBlob(lines.join("\n"), "dfd-report.csv", "text/csv;charset=utf-8;");
}

function exportExcel(rows) {
  if (!rows.length) return toast("No data to export");
  const tableRows = rows
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(fmtLocal(r.timestamp))}</td>
        <td>${escapeHtml(r.stationId || "")}</td>
        <td>${escapeHtml(r.apparatusId || "")}</td>
        <td>${escapeHtml(r.category || "")}</td>
        <td>${escapeHtml(r.submitter || "")}</td>
        <td>${escapeHtml(String(r.summary || ""))}</td>
      </tr>`
    )
    .join("");
  const html = `
    <table>
      <thead>
        <tr>
          <th>Timestamp</th>
          <th>Station</th>
          <th>Apparatus</th>
          <th>Category</th>
          <th>Submitter</th>
          <th>Summary</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>
  `;
  downloadBlob(html, "dfd-report.xls", "application/vnd.ms-excel");
}

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
    const rows = (res.results || []).map((r) => ({
      ...r,
      category: labelCategory_(r.category || category)
    }));
    CURRENT_RESULTS = rows;
    FILTERED_RESULTS = applyClientFilters(rows);
    renderResults(FILTERED_RESULTS);
    renderSummary(FILTERED_RESULTS);
    renderTrends(FILTERED_RESULTS);
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

  CURRENT_RESULTS = merged;
  FILTERED_RESULTS = applyClientFilters(merged);
  renderResults(FILTERED_RESULTS);
  renderSummary(FILTERED_RESULTS);
  renderTrends(FILTERED_RESULTS);
}

async function boot() {
  $("#btnPrint").addEventListener("click", () => window.print());
  $("#btnExportCsv").addEventListener("click", () => exportCsv(FILTERED_RESULTS));
  $("#btnExportExcel").addEventListener("click", () => exportExcel(FILTERED_RESULTS));
  $("#btnExportPdf").addEventListener("click", () => window.print());

  $("#stationId").addEventListener("change", () => {
    if (!META) return;
    setApparatusOptions(META, $("#stationId").value);
  });

  $("#periodPreset").addEventListener("change", (event) => {
    applyPeriodPreset(event.target.value);
  });

  $("#priorityFilter").addEventListener("change", () => {
    FILTERED_RESULTS = applyClientFilters(CURRENT_RESULTS);
    renderResults(FILTERED_RESULTS);
    renderSummary(FILTERED_RESULTS);
    renderTrends(FILTERED_RESULTS);
  });

  $("#btnSaveTemplate").addEventListener("click", () => {
    const name = ($("#templateName").value || "").trim();
    if (!name) return toast("Template name required");
    const templates = loadTemplates();
    const id = safeUuid();
    templates.push({ id, name, ...currentFilters() });
    saveTemplates(templates);
    $("#templateName").value = "";
    refreshTemplateOptions();
    toast("Template saved");
  });

  $("#btnDeleteTemplate").addEventListener("click", () => {
    const selected = $("#templateSelect").value;
    if (!selected) return toast("Select a template");
    const templates = loadTemplates().filter((t) => t.id !== selected);
    saveTemplates(templates);
    refreshTemplateOptions();
    toast("Template deleted");
  });

  $("#templateSelect").addEventListener("change", () => {
    const selected = $("#templateSelect").value;
    if (!selected) return;
    const template = loadTemplates().find((t) => t.id === selected);
    applyTemplate(template);
    toast("Template loaded");
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
      $("#summaryGrid").innerHTML = `<div class="summaryCard note">Search failed.</div>`;
      $("#trendList").textContent = "Search failed.";
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
    refreshTemplateOptions();
    toast("Loaded");
  } catch (err) {
    toast(err.message, 3200);
  }
}

document.addEventListener("DOMContentLoaded", boot);
