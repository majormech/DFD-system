/* app.js (Crew UI — DFD System)
   Talks ONLY to /api (Cloudflare Pages Functions + D1)

   Required API actions (case-insensitive):
     GET  /api?action=getConfig
     GET  /api?action=getApparatus&stationId=1
     GET  /api?action=getActiveIssues&stationId=1&apparatusId=E-1

     POST /api  { action:"saveCheck", ... }

   Optional:
     GET  /api?action=getDrugMaster&unit=E-1
*/

const $ = (s) => document.querySelector(s);

function setStatus(msg, isError = false) {
  const el = $("#status");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "#c81e1e" : "";
  el.style.fontWeight = isError ? "800" : "700";
}

function escapeHtml(s) {
  return String(s || "")
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

function attentionClassForText(text) {
  const t = normalizeText(text);
  if (!t) return "";
  if (/(out of service|oos|critical|expired|missing|failed|failure)/.test(t)) return "issue-critical";
  if (/(fail|needs mechanic|broken|leak|not working|immediate)/.test(t)) return "issue-high";
  if (/(warning|maintenance|service|needs attention|soon|low)/.test(t)) return "issue-medium";
  return "issue-low";
}

/* Normalize any incoming date-ish value to HTML date input format: YYYY-MM-DD */
function toYmdDateInput(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";

  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseYMD(s) {
  const m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]),
    mo = Number(m[2]) - 1,
    d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function daysUntil(expYmd) {
  const exp = parseYMD(expYmd);
  if (!exp) return null;

  const now = new Date();
  const todayUtc = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const diffMs = exp.getTime() - todayUtc.getTime();
  return Math.floor(diffMs / 86400000);
}

function drugClassForExp(expYmd) {
  const d = daysUntil(expYmd);
  if (d == null) return "";
  if (d < 14) return "drugRed";
  if (d < 30) return "drugYellow";
  return "drugGreen";
}

function prettyDaysLabel(expYmd) {
  const d = daysUntil(expYmd);
  if (d == null) return "";
  if (d < 0) return `Expired ${Math.abs(d)}d`;
  return `${d}d`;
}

async function apiGet(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api?${qs.toString()}`, { method: "GET" });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Bad JSON from /api: ${text.slice(0, 180)}`);
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
    throw new Error(`Bad JSON from /api: ${text.slice(0, 180)}`);
  }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

// Soft GET: if action doesn't exist (Unknown action), return null instead of crashing
async function apiGetSoft(params) {
  try {
    return await apiGet(params);
  } catch (e) {
    const m = String(e?.message || "").toLowerCase();
    if (m.includes("unknown action")) return null;
    throw e;
  }
}

/* ---------------- Offline queue + sync ---------------- */
const OFFLINE_QUEUE_KEY = "dfd_offline_queue_v1";
let SYNCING_QUEUE = false;

function loadOfflineQueue() {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOfflineQueue(queue) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
}

function updateSyncBadge() {
  const badge = $("#syncBadge");
  if (!badge) return;
  const queue = loadOfflineQueue();
  const count = queue.length;
  if (count === 0 && navigator.onLine) {
    badge.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = navigator.onLine
    ? `Pending sync: ${count}`
    : `Offline queue: ${count}`;
  badge.classList.toggle("warn", !navigator.onLine);
}

function isLikelyOfflineError(err) {
  const msg = normalizeText(err?.message || "");
  return !navigator.onLine || msg.includes("failed to fetch") || msg.includes("networkerror");
}

async function enqueueOfflineSave(payload, reason = "Offline") {
  const queue = loadOfflineQueue();
  queue.push({
    id: safeUuid(),
    createdAt: new Date().toISOString(),
    reason,
    payload,
  });
  saveOfflineQueue(queue);
  updateSyncBadge();
}

async function flushOfflineQueue() {
  if (SYNCING_QUEUE) return;
  if (!navigator.onLine) {
    updateSyncBadge();
    return;
  }
  const queue = loadOfflineQueue();
  if (!queue.length) {
    updateSyncBadge();
    return;
  }
  SYNCING_QUEUE = true;
  try {
    const remaining = [];
    for (const item of queue) {
      try {
        await apiPost(item.payload);
      } catch (err) {
        if (isLikelyOfflineError(err)) {
          remaining.push(item);
          break;
        }
        remaining.push(item);
      }
    }
    saveOfflineQueue(remaining);
  } finally {
    SYNCING_QUEUE = false;
    updateSyncBadge();
  }
}

/* ---------------- Apparatus requirement rules (Crew UI) ----------------
  Your current rules:
  - Pump weekly: T-2, E-3, E-4, E-5, E-6, E-7, T-3, E-8, E-9
  - Aerial weekly: T-2, E-5, T-3
  - Saws weekly: T-2, T-3, R-1
  - Medical daily: everyone except R-1
*/
function requirementsFor(apparatusIdRaw) {
  const id = String(apparatusIdRaw || "").toUpperCase().trim();

  const HAS_PUMP = new Set(["T-2", "E-1", "E-3", "E-4", "E-5", "E-6", "E-7", "T-3", "E-8", "E-9"]);
  const HAS_AERIAL = new Set(["T-1", "T-2", "E-5", "T-3"]);
  const HAS_SAWS = new Set(["T-1", "T-2", "T-3", "R-1"]);

  return {
    apparatusDaily: true,
    medicalDaily: id !== "R-1",
    scbaWeekly: true,
    pumpWeekly: HAS_PUMP.has(id),
    aerialWeekly: HAS_AERIAL.has(id),
    sawWeekly: HAS_SAWS.has(id),
    batteriesWeekly: true,
    oosUnit: true,
    oosEquipment: true,
  };
}

function hasExtrication(apparatusIdRaw) {
  const id = String(apparatusIdRaw || "").toUpperCase().trim();
  return id === "E-1" || id === "E-4";
}

/* ---------------- State ---------------- */
let CONFIG = null;
let APPARATUS = [];
let DRUG_MASTER = {}; // name -> lastKnownExp (normalized yyyy-MM-dd)

/* ---------------- Prefs ---------------- */
function loadPrefs() {
  const who = localStorage.getItem("dfd_who") || "";
  const station = localStorage.getItem("dfd_station") || "1";
  const apparatus = localStorage.getItem("dfd_apparatus") || "";
  const checkType = localStorage.getItem("dfd_checkType") || "";

  if ($("#who")) $("#who").value = who;
  if ($("#station")) $("#station").value = station;
  if ($("#apparatus")) $("#apparatus").value = apparatus;
  if ($("#checkType")) $("#checkType").value = checkType;
}

function savePrefs() {
  localStorage.setItem("dfd_who", ($("#who")?.value || "").trim());
  localStorage.setItem("dfd_station", ($("#station")?.value || "1").trim());
  localStorage.setItem("dfd_apparatus", ($("#apparatus")?.value || "").trim());
  localStorage.setItem("dfd_checkType", ($("#checkType")?.value || "").trim());
}

function requireWho() {
  const n = ($("#who")?.value || "").trim();
  if (!n) throw new Error("Completed By is required.");
  return n;
}

function stationId() {
  return ($("#station")?.value || "1").trim() || "1";
}

function apparatusId() {
  return ($("#apparatus")?.value || "").trim();
}

function selectedCheckType() {
  return ($("#checkType")?.value || "").trim();
}

/* ---------------- Load config + apparatus ---------------- */
async function loadConfig() {
  const res = await apiGet({ action: "getConfig" });
  CONFIG = res.config || null;

  const stationSel = $("#station");
  if (stationSel && CONFIG?.stations?.length) {
    stationSel.innerHTML = CONFIG.stations
      .map(
        (s) =>
          `<option value="${escapeHtml(s.stationId)}">${escapeHtml(
            s.stationName
          )}</option>`
      )
      .join("");

    const saved = localStorage.getItem("dfd_station") || CONFIG.stationIdDefault || "1";
    stationSel.value = saved;
  }
}

async function loadApparatusForStation(station) {
  const res = await apiGet({ action: "getApparatus", stationId: station });
  APPARATUS = res.apparatus || [];

  const apSel = $("#apparatus");
  if (!apSel) return;

  apSel.innerHTML =
    `<option value="">Select apparatus…</option>` +
    APPARATUS.map(
      (a) =>
        `<option value="${escapeHtml(a.apparatusId)}">${escapeHtml(
          a.apparatusName || a.apparatusId
        )}</option>`
    ).join("");

  const savedAp = localStorage.getItem("dfd_apparatus") || "";
  if (savedAp) apSel.value = savedAp;
}

/* ---------------- Check types ---------------- */
const CHECK_TYPES = [
  { key: "apparatusDaily", label: "Apparatus Daily" },
  { key: "medicalDaily", label: "Medical Daily" },
  { key: "scbaWeekly", label: "SCBA Weekly" },
  { key: "pumpWeekly", label: "Pump Weekly" },
  { key: "aerialWeekly", label: "Aerial Weekly" },
  { key: "sawWeekly", label: "Saws Weekly" },
  { key: "batteriesWeekly", label: "Batteries Weekly" },
  { key: "oosUnit", label: "Unit Out of Service" },
  { key: "oosEquipment", label: "Equipment Out of Service" },
];

function renderCheckTypeOptions() {
  const sel = $("#checkType");
  if (!sel) return;

  const ap = apparatusId();
  const req = requirementsFor(ap);

  const allowed = CHECK_TYPES.filter((ct) => req[ct.key] !== false);

  sel.innerHTML =
    `<option value="">Select check type…</option>` +
    allowed
      .map(
        (ct) =>
          `<option value="${escapeHtml(ct.key)}">${escapeHtml(ct.label)}</option>`
      )
      .join("");

  const saved = localStorage.getItem("dfd_checkType") || "";
  if (saved && allowed.some((x) => x.key === saved)) sel.value = saved;
  else sel.value = "";
}

/* ---------------- Issues ---------------- */
function renderActiveIssues(issues) {
  const ul = $("#activeIssues");
  if (!ul) return;

  const list = (issues || []).filter(
    (x) => String(x.status || "").toUpperCase() !== "RESOLVED"
  );
  if (!list.length) {
    ul.innerHTML = `<li class="muted">No active issues.</li>`;
    return;
  }

  ul.innerHTML = list
    .map((iss) => {
      const note = iss.note || iss.bulletNote || "";
      const status = String(iss.status || "NEW").toUpperCase();
      const txt = `${iss.issueText || ""}${note ? ` — ${note}` : ""} (${status})`;
      const cls = attentionClassForText(txt);
      return `<li class="${escapeHtml(cls)}">${escapeHtml(txt)}</li>`;
    })
    .join("");
}

async function refreshIssues() {
  const st = stationId();
  const ap = apparatusId();
  if (!ap) {
    renderActiveIssues([]);
    return;
  }
  const res = await apiGet({ action: "getActiveIssues", stationId: st, apparatusId: ap });
  renderActiveIssues(res.issues || []);
}

/* ---------------- Drug Master (Last known exp) ---------------- */
async function loadDrugMaster(unit) {
  DRUG_MASTER = {};
  if (!unit) return;

  const res = await apiGetSoft({ action: "getDrugMaster", unit });
  if (!res?.items?.length) return;

  const map = {};
  for (const it of res.items) {
    if (!it?.name) continue;
    map[it.name] = toYmdDateInput(it.exp || "");
  }
  DRUG_MASTER = map;
}

/* ---------------- Daily checklist helpers ---------------- */
function renderDailyItem_(label, key) {
  return `
    <div class="drugRow" style="margin-top:10px">
      <div style="font-weight:800;margin-bottom:8px">${escapeHtml(label)}</div>
      <div class="row">
        <div>
          <label style="margin-top:0">Pass / Fail</label>
          <select class="dailyPassFail" data-key="${escapeHtml(key)}">
            <option value="Pass">Pass</option>
            <option value="Fail">Fail</option>
          </select>
        </div>
        <div>
          <label style="margin-top:0">Notes</label>
          <input class="dailyNotes" data-key="${escapeHtml(
            key
          )}" placeholder="Notes (optional)" />
        </div>
      </div>
    </div>
  `;
}

function readDailyItems_() {
  const payload = {};
  document.querySelectorAll("#formArea .dailyPassFail").forEach((sel) => {
    const key = sel.getAttribute("data-key");
    if (!key) return;
    payload[key] = payload[key] || {};
    payload[key].passFail = sel.value || "Pass";
  });

  document.querySelectorAll("#formArea .dailyNotes").forEach((inp) => {
    const key = inp.getAttribute("data-key");
    if (!key) return;
    payload[key] = payload[key] || {};
    payload[key].notes = inp.value || "";
  });

  // Ensure every key exists (so backend always receives consistent fields)
  const keys = [
    "knox",
    "radios",
    "lights",
    "scba",
    "spareBottles",
    "rit",
    "flashlights",
    "tic",
    "gasMonitor",
    "handTools",
    "hydraRam",
    "groundLadders",
    "passports",

    // Extrication (E-1 and E-4 only)
    "extrication_spreader",
    "extrication_cutter",
    "extrication_batteries",
    "extrication_ram",
  ];

  for (const k of keys) {
    payload[k] = payload[k] || { passFail: "Pass", notes: "" };
    payload[k].passFail = payload[k].passFail || "Pass";
    payload[k].notes = payload[k].notes || "";
  }

  return payload;
}

/* ---------------- Form rendering ---------------- */
function formWrap(html) {
  return `<div>${html}</div>`;
}

function renderForm() {
  const area = $("#formArea");
  if (!area) return;

  const type = selectedCheckType();
  if (!type) {
    area.innerHTML = `<div class="muted">Select a check type to begin.</div>`;
    return;
  }

  if (type === "apparatusDaily") {
    const ap = apparatusId();

    const extricationSection = hasExtrication(ap)
      ? `
        <div class="hr"></div>
        <div style="font-weight:900;margin-bottom:8px">Extrication Equipment</div>

        ${renderDailyItem_("Spreader", "extrication_spreader")}
        ${renderDailyItem_("Cutter", "extrication_cutter")}
        ${renderDailyItem_("Batteries", "extrication_batteries")}
        ${renderDailyItem_("Ram", "extrication_ram")}
      `
      : "";

    area.innerHTML = formWrap(`
      <div class="row">
        <label>Odometer / Mileage
          <input id="mileage" type="number" min="0" />
        </label>
        <label>Engine Hours
          <input id="engineHours" type="number" min="0" />
        </label>
        <label>Fuel %
          <input id="fuel" type="number" min="0" max="100" />
        </label>
        <label>DEF %
          <input id="def" type="number" min="0" max="100" />
        </label>
      </div>
      <label>Tank %
        <input id="tank" type="number" min="0" max="100" />
      </label>

      <div class="hr"></div>
      <div style="font-weight:900;margin-bottom:8px">Daily Checklist</div>
      ${renderDailyItem_("Knox Box", "knox")}
      ${renderDailyItem_("Radios", "radios")}
      ${renderDailyItem_("Lights", "lights")}
      ${renderDailyItem_("SCBA", "scba")}
      ${renderDailyItem_("Spare Bottles", "spareBottles")}
      ${renderDailyItem_("RIT Pack", "rit")}
      ${renderDailyItem_("Flashlights", "flashlights")}
      ${renderDailyItem_("TIC", "tic")}
      ${renderDailyItem_("Gas Monitor", "gasMonitor")}
      ${renderDailyItem_("Hand Tools", "handTools")}
      ${renderDailyItem_("Hydra Ram", "hydraRam")}
      ${renderDailyItem_("Ground Ladders", "groundLadders")}
      ${renderDailyItem_("Passports", "passports")}
      ${extricationSection}
    `);

    return;
  }

  if (type === "medicalDaily") {
    const drugs = CONFIG?.drugMaster || [];
    const rows = (drugs || [])
      .map((drug) => {
        const name = String(drug.name || "");
        const qty = Number(drug.qty || 0);
        const last = DRUG_MASTER[name] || "";
        const cls = drugClassForExp(last);
        const days = prettyDaysLabel(last);

        return `
          <div class="drugRow ${cls}" data-drug="${escapeHtml(name)}">
            <div style="font-weight:800;margin-bottom:8px">
              ${escapeHtml(name)}
              ${
                days
                  ? ` <span class="pill" style="margin-left:6px">${escapeHtml(days)}</span>`
                  : ``
              }
            </div>
            <div class="row">
              <div>
                <label style="margin-top:0">Qty</label>
                <input class="drugQty" type="number" min="0" value="${escapeHtml(qty)}" />
              </div>
              <div>
                <label style="margin-top:0">Exp</label>
                <input class="drugExp" type="date" value="${escapeHtml(last)}" />
              </div>
            </div>
          </div>
        `;
      })
      .join(`<div style="height:10px"></div>`);

    area.innerHTML = formWrap(`
      <label>O2 Bottle Level (0-2000)</label>
      <input id="o2" type="number" min="0" max="2000" />

      <label>Airway Equipment</label>
      <select id="airwayPassFail">
        <option>Pass</option>
        <option>Fail</option>
      </select>

      <label>Airway Notes</label>
      <textarea id="airwayNotes" placeholder="Notes (optional)"></textarea>

      <div class="hr"></div>
      <div style="font-weight:800; margin-bottom:8px">Medications</div>
      <div class="muted" style="margin-bottom:10px">
        Exp defaults to last known expiration if available. Update as needed.
      </div>
      ${rows || `<div class="muted">No drug list found in config.</div>`}
    `);

    // Live color update when Exp changes
    area.querySelectorAll(".drugRow").forEach((row) => {
      const expInput = row.querySelector(".drugExp");
      if (!expInput) return;
      expInput.addEventListener("change", () => {
        const v = toYmdDateInput(expInput.value || "");
        expInput.value = v;
        row.classList.remove("drugRed", "drugYellow", "drugGreen");
        const cls = drugClassForExp(v);
        if (cls) row.classList.add(cls);
      });
    });

    return;
  }

  if (type === "scbaWeekly") {
    area.innerHTML = formWrap(`
      <div class="muted">Enter up to 4 SCBA rows.</div>
      ${[1, 2, 3, 4]
        .map(
          (i) => `
          <div class="drugRow" style="margin-top:${i === 1 ? 0 : 10}px">
            <div style="font-weight:800;margin-bottom:6px">SCBA ${i}</div>
            <label style="margin-top:0">SCBA Label</label><input class="scbaLabel" />
            <label>Bottle PSI (0-4500)</label><input class="scbaPsi" type="number" min="0" max="4500" />
            <label>PASS</label>
            <select class="scbaPassFail"><option>Pass</option><option>Fail</option></select>
            <label>Notes</label><input class="scbaNotes" />
          </div>
        `
        )
        .join("")}
    `);
    return;
  }

  if (type === "pumpWeekly") {
    area.innerHTML = formWrap(`
      <label>Pump Shift</label><input id="pumpShift" placeholder="Pass / Fail or notes"/>
      <label>Throttle</label><input id="throttle" placeholder="Pass / Fail or notes"/>
      <label>Relief Valve</label><input id="relief" placeholder="Pass / Fail or notes"/>
      <label>Gauges</label><input id="gauges" placeholder="Pass / Fail or notes"/>
      <label>Overall</label><input id="overall" placeholder="Pass / Fail or notes"/>
      <label>Notes</label><textarea id="pumpNotes"></textarea>
    `);
    return;
  }

  if (type === "aerialWeekly") {
    area.innerHTML = formWrap(`
      <label>Overall</label><input id="aerialOverall" placeholder="Pass / Fail or notes"/>
      <label>Notes</label><textarea id="aerialNotes"></textarea>
    `);
    return;
  }

  if (type === "sawWeekly") {
    area.innerHTML = formWrap(`
      <div class="muted">Enter up to 4 saw rows.</div>
      ${[1, 2, 3, 4]
        .map(
          (i) => `
          <div class="drugRow" style="margin-top:${i === 1 ? 0 : 10}px">
            <div style="font-weight:800;margin-bottom:6px">Saw ${i}</div>
            <label style="margin-top:0">Type</label><input class="sawType" />
            <label>Number</label><input class="sawNumber" type="number" min="0" />
            <label>Fuel (0-100%)</label><input class="sawFuel" type="number" min="0" max="100" />
            <label>Bar Oil (0-100%)</label><input class="sawBarOil" type="number" min="0" max="100" />
            <label>Runs</label>
            <select class="sawRuns"><option>Yes</option><option>No</option></select>
            <label>Notes</label><input class="sawNotes" />
          </div>
        `
        )
        .join("")}
    `);
    return;
  }

  if (type === "batteriesWeekly") {
    area.innerHTML = formWrap(`
      <label>Battery Tools</label><input id="batteryTools" placeholder="OK / Needs attention" />
      <label>Gas Monitor Charged</label><input id="gasMonitorCharged" placeholder="Yes / No" />
      <label>Unit Phone Charged</label><input id="unitPhoneCharged" placeholder="Yes / No" />
      <label>Notes</label><textarea id="batteryNotes"></textarea>
      <div class="hr"></div>
      <div style="font-weight:900;margin-bottom:8px">Extrication Equipment</div>
      <label>Extrication Check</label><input id="extricationCheck" placeholder="OK / Needs attention" />
      <label>Spreader</label><input id="spreader" placeholder="OK / Needs attention" />
      <label>Cutter</label><input id="cutter" placeholder="OK / Needs attention" />
      <label>Ram</label><input id="ram" placeholder="OK / Needs attention" />
      <label>All Charged</label><input id="allCharged" placeholder="Yes / No" />
      <label>Damage</label><input id="damage" placeholder="Yes / No" />
    `);
    return;
  }

  if (type === "oosUnit") {
    area.innerHTML = formWrap(`
      <label>Reason</label><textarea id="oosReason"></textarea>
      <label>Replacement Reserve</label><input id="oosReplacementReserve" placeholder="Reserve apparatus" />
      <label>Equipment Moved</label><input id="oosEquipmentMoved" placeholder="Yes / No" />
      <label>RTS Date</label><input id="oosRtsDate" type="date" />
    `);
    return;
  }

  if (type === "oosEquipment") {
    area.innerHTML = formWrap(`
      <label>Equipment Type</label><input id="eqType" />
      <label>Equipment Identifier</label><input id="eqIdentifier" />
      <label>Reason</label><textarea id="eqReason"></textarea>
      <label>Replacement</label><input id="eqReplacement" />
      <label>RTS Date</label><input id="eqRtsDate" type="date" />
    `);
    return;
  }

  area.innerHTML = `<div class="muted">Form not implemented for: ${escapeHtml(type)}</div>`;
}

/* ---------------- Read payloads ---------------- */
function readMedicalDailyPayload() {
  const drugsPayload = [];
  document.querySelectorAll("#formArea .drugRow").forEach((row) => {
    const name = row.getAttribute("data-drug") || "";
    const qty = Number(row.querySelector(".drugQty")?.value || 0);
    const exp = toYmdDateInput(
      String(row.querySelector(".drugExp")?.value || "").trim()
    );
    if (name && exp) drugsPayload.push({ name, qty, exp });
  });

  return {
    o2: Number($("#o2")?.value || 0),
    airwayPassFail: $("#airwayPassFail")?.value || "Pass",
    airwayNotes: $("#airwayNotes")?.value || "",
    drugs: drugsPayload,
  };
}

function readScbaWeeklyPayload() {
  const entries = [];
  document.querySelectorAll("#formArea .drugRow").forEach((card) => {
    const label = card.querySelector(".scbaLabel")?.value?.trim() || "";
    const psi = Number(card.querySelector(".scbaPsi")?.value || 0);
    const passFail = card.querySelector(".scbaPassFail")?.value || "Pass";
    const notes = card.querySelector(".scbaNotes")?.value || "";
    if (label || psi || notes) entries.push({ label, psi, passFail, notes });
  });
  return { entries };
}

function readSawWeeklyPayload() {
  const entries = [];
  document.querySelectorAll("#formArea .drugRow").forEach((card) => {
    const type = card.querySelector(".sawType")?.value?.trim() || "";
    const number = Number(card.querySelector(".sawNumber")?.value || 0);
    const fuel = Number(card.querySelector(".sawFuel")?.value || 0);
    const barOil = Number(card.querySelector(".sawBarOil")?.value || 0);
    const runs = card.querySelector(".sawRuns")?.value || "Yes";
    const notes = card.querySelector(".sawNotes")?.value || "";
    if (type || number || notes) entries.push({ type, number, fuel, barOil, runs, notes });
  });
  return { entries };
}

async function saveCheckWithOffline(payload) {
  try {
    await apiPost(payload);
    return { queued: false };
  } catch (err) {
    if (isLikelyOfflineError(err)) {
      await enqueueOfflineSave(payload, "Offline");
      return { queued: true };
    }
    throw err;
  }
}

/* ---------------- Save ---------------- */
async function onSave() {
  const submitter = requireWho();
  const st = stationId();
  const ap = apparatusId();
  const type = selectedCheckType();

  if (!st) throw new Error("Station is required.");
  if (!ap) throw new Error("Apparatus is required.");
  if (!type) throw new Error("Check Type is required.");

  let checkPayload = {};

  if (type === "apparatusDaily") {
    const items = readDailyItems_();
    checkPayload = {
      mileage: Number($("#mileage")?.value || 0),
      engineHours: Number($("#engineHours")?.value || 0),
      fuel: Number($("#fuel")?.value || 0),
      def: Number($("#def")?.value || 0),
      tank: Number($("#tank")?.value || 0),

      knox: items.knox,
      radios: items.radios,
      lights: items.lights,
      scba: items.scba,
      spareBottles: items.spareBottles,
      rit: items.rit,
      flashlights: items.flashlights,
      tic: items.tic,
      gasMonitor: items.gasMonitor,
      handTools: items.handTools,
      hydraRam: items.hydraRam,
      groundLadders: items.groundLadders,
      passports: items.passports,

      // Extrication (E-1 and E-4)
      extrication_spreader: items.extrication_spreader,
      extrication_cutter: items.extrication_cutter,
      extrication_batteries: items.extrication_batteries,
      extrication_ram: items.extrication_ram,
    };
  } else if (type === "medicalDaily") {
    checkPayload = readMedicalDailyPayload();
  } else if (type === "scbaWeekly") {
    checkPayload = readScbaWeeklyPayload();
  } else if (type === "pumpWeekly") {
    checkPayload = {
      pumpShift: $("#pumpShift")?.value || "Pass",
      throttle: $("#throttle")?.value || "Pass",
      relief: $("#relief")?.value || "Pass",
      gauges: $("#gauges")?.value || "Pass",
      overall: $("#overall")?.value || "Pass",
      notes: $("#pumpNotes")?.value || "",
    };
  } else if (type === "aerialWeekly") {
    checkPayload = {
      overall: $("#aerialOverall")?.value || "Pass",
      notes: $("#aerialNotes")?.value || "",
    };
  } else if (type === "sawWeekly") {
    checkPayload = readSawWeeklyPayload();
  } else if (type === "batteriesWeekly") {
    checkPayload = {
      batteryTools: $("#batteryTools")?.value || "",
      gasMonitorCharged: $("#gasMonitorCharged")?.value || "",
      unitPhoneCharged: $("#unitPhoneCharged")?.value || "",
      notes: $("#batteryNotes")?.value || "",
      extricationCheck: $("#extricationCheck")?.value || "",
      spreader: $("#spreader")?.value || "",
      cutter: $("#cutter")?.value || "",
      ram: $("#ram")?.value || "",
      allCharged: $("#allCharged")?.value || "",
      damage: $("#damage")?.value || "",
    };
  } else if (type === "oosUnit") {
    checkPayload = {
      reason: $("#oosReason")?.value || "",
      replacementReserve: $("#oosReplacementReserve")?.value || "",
      equipmentMoved: $("#oosEquipmentMoved")?.value || "",
      rtsDate: $("#oosRtsDate")?.value || "",
    };
  } else if (type === "oosEquipment") {
    checkPayload = {
      type: $("#eqType")?.value || "",
      identifier: $("#eqIdentifier")?.value || "",
      reason: $("#eqReason")?.value || "",
      replacement: $("#eqReplacement")?.value || "",
      rtsDate: $("#eqRtsDate")?.value || "",
    };
  }

  const newIssueText = ($("#newIssue")?.value || "").trim();
  const newIssueNote = ($("#newIssueNote")?.value || "").trim();

  setStatus("Saving…");
  const savePayload = {
    action: "saveCheck",
    stationId: st,
    apparatusId: ap,
    submitter,
    checkType: type,
    checkPayload,
    newIssueText,
    newIssueNote,
  };
  const { queued } = await saveCheckWithOffline(savePayload);

  if ($("#newIssue")) $("#newIssue").value = "";
  if ($("#newIssueNote")) $("#newIssueNote").value = "";

  if (!queued) {
    await refreshIssues();
  }

  if (type === "medicalDaily") {
    if (!queued) {
      await loadDrugMaster(ap);
      renderForm();
    }
  }

  setStatus(queued ? "Saved offline (queued for sync)." : "Saved ✅");
  updateSyncBadge();
}

/* ---------------- Events ---------------- */
async function onStationChange() {
  savePrefs();
  setStatus("Loading apparatus…");
  await loadApparatusForStation(stationId());
  renderCheckTypeOptions();
  await onApparatusChange();
}

async function onApparatusChange() {
  savePrefs();
  renderCheckTypeOptions();

  setStatus("Loading issues…");
  await refreshIssues();

  const ap = apparatusId();
  await loadDrugMaster(ap);

  renderForm();
  setStatus("Ready.");
}

async function onCheckTypeChange() {
  savePrefs();

  if (selectedCheckType() === "medicalDaily") {
    await loadDrugMaster(apparatusId());
  }

  renderForm();
}

/* ---------------- Scanner (lazy-loaded) ---------------- */
let SCANNER_LOADING = false;
let SCANNER_READY = false;

function loadScannerScript() {
  if (SCANNER_READY) return Promise.resolve();
  if (SCANNER_LOADING) {
    return new Promise((resolve) => {
      const check = () => {
        if (SCANNER_READY) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }
  SCANNER_LOADING = true;
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/scanner.min.js";
    script.defer = true;
    script.onload = () => {
      SCANNER_READY = true;
      SCANNER_LOADING = false;
      resolve();
    };
    script.onerror = (err) => {
      SCANNER_LOADING = false;
      reject(err);
    };
    document.head.appendChild(script);
  });
}

async function startScanner() {
  await loadScannerScript();
  if (!window.DFDScanner?.startScanner) return;
  window.DFDScanner.startScanner({
    onSelect: async (apparatusValue) => {
      $("#apparatus").value = apparatusValue;
      await onApparatusChange();
      setStatus(`Scanned apparatus ${apparatusValue}.`);
    },
    onStatus: (msg) => setStatus(msg),
  });
}

function stopScanner() {
  window.DFDScanner?.stopScanner?.();
}

/* ---------------- Boot ---------------- */
async function boot() {
  setStatus("Loading…");

  $("#station")?.addEventListener("change", () =>
    onStationChange().catch((e) => setStatus(e.message, true))
  );
  $("#apparatus")?.addEventListener("change", () =>
    onApparatusChange().catch((e) => setStatus(e.message, true))
  );
  $("#checkType")?.addEventListener("change", () =>
    onCheckTypeChange().catch((e) => setStatus(e.message, true))
  );
  $("#saveBtn")?.addEventListener("click", () => {
    savePrefs();
    onSave().catch((e) => setStatus(e.message, true));
  });
  $("#scanBtn")?.addEventListener("click", () => startScanner());
  $("#scanCloseBtn")?.addEventListener("click", () => stopScanner());
  $("#scanBackdrop")?.addEventListener("click", (event) => {
    if (event.target?.id === "scanBackdrop") stopScanner();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopScanner();
  });

  window.addEventListener("online", () => flushOfflineQueue());
  window.addEventListener("offline", () => updateSyncBadge());

  loadPrefs();
  await loadConfig();
  await loadApparatusForStation(stationId());

  renderCheckTypeOptions();

  const savedStation = localStorage.getItem("dfd_station") || "1";
  const savedAp = localStorage.getItem("dfd_apparatus") || "";
  const savedType = localStorage.getItem("dfd_checkType") || "";

  if ($("#station")) $("#station").value = savedStation;
  if ($("#apparatus")) $("#apparatus").value = savedAp;
  renderCheckTypeOptions();
  if ($("#checkType")) $("#checkType").value = savedType;

  await onApparatusChange();
  updateSyncBadge();
  await flushOfflineQueue();
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((err) => setStatus(err.message, true));
});
