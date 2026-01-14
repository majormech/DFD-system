/**
 * DFD System — Code.gs (Google Sheets backend) — Legacy-friendly build
 * ------------------------------------------------------------------
 * This version:
 *  ✅ Keeps the CURRENT API your Pages UI expects (app/admin/search/config)
 *  ✅ Creates the "schema.sql" style tabs (checks/issues/weekly_config/email_recipients/drug_master)
 *  ✅ Preserves ANY existing legacy tabs/data (NON-DESTRUCTIVE schema ensure)
 *  ✅ Adds Drug Master per-unit "view tabs" (optional) so each unit has its own sheet
 *
 * IMPORTANT ABOUT "ALL LEGACY FEATURES":
 * - To fully restore every legacy endpoint/feature, I need your old Code.gs contents.
 *   In this chat, some previously uploaded files expired, so I can’t read the old one right now.
 * - This script is built to NOT break legacy tabs: it won’t wipe them, and it includes a
 *   "legacy passthrough" router stub you can paste your old handlers into once re-uploaded.
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone (or Anyone with link)
 */

const DFD_TZ = "America/Chicago";

/* ---------- Stations / Apparatus (current rules) ---------- */
const STATIONS = [
  { stationId: "1", stationName: "Station 1" },
  { stationId: "2", stationName: "Station 2" },
  { stationId: "3", stationName: "Station 3" },
  { stationId: "4", stationName: "Station 4" },
  { stationId: "5", stationName: "Station 5" },
  { stationId: "6", stationName: "Station 6" },
  { stationId: "7", stationName: "Station 7" },
  { stationId: "R", stationName: "Reserve Apparatus" }
];

const APPARATUS_SEED = [
  // Station 1 (adjust anytime)
  { stationId: "1", apparatusId: "E-1", apparatusName: "E-1" },
  { stationId: "1", apparatusId: "T-1", apparatusName: "T-1" },

  // Station 2-7
  { stationId: "2", apparatusId: "T-2", apparatusName: "T-2" },
  { stationId: "3", apparatusId: "E-3", apparatusName: "E-3" },
  { stationId: "4", apparatusId: "E-4", apparatusName: "E-4" },
  { stationId: "5", apparatusId: "E-5", apparatusName: "E-5" },
  { stationId: "6", apparatusId: "E-6", apparatusName: "E-6" },
  { stationId: "7", apparatusId: "E-7", apparatusName: "E-7" },

  // Reserve Apparatus
  { stationId: "R", apparatusId: "T-3", apparatusName: "T-3" },
  { stationId: "R", apparatusId: "E-8", apparatusName: "E-8" },
  { stationId: "R", apparatusId: "E-9", apparatusName: "E-9" },
  { stationId: "R", apparatusId: "R-1", apparatusName: "R-1" }
];


/*--- Drug list & default quantities ---------------------*/
const DFD_DRUG_CONFIG = {
  drugs: [
    "Adenosine Inj. 6mg/2ml","Aspirin Chew Tabs 81mg","Atropine Syringe 1mg/10ml",
    "Dextrose 10% (D10W) 25g/250ml","Diphenhydramine Inj. 50mg/1ml","DuoNeb 0.5mg/3mg in 3ml",
    "Epinephrine Syringe 1:10000 1mg/10ml","Epinephrine Inj. 1:1000 1mg/1ml","Glucagon Inj. 1mg",
    "Lidocaine Syringe 100mg/5ml","Naloxone Inj. 2mg/2ml","Nitroglycerin SL Tabs #25 0.4mg",
    "Ondansetron 4mg/2ml","Ondansetron ODT 4mg",
    "0.9% Normal Saline 1000 mL","Lactated Ringer 1000 mL"
  ],
  defaultQty: {
    "Adenosine Inj. 6mg/2ml":3,
    "Aspirin Chew Tabs 81mg":4,
    "Atropine Syringe 1mg/10ml":3,
    "Dextrose 10% (D10W) 25g/250ml":2,
    "Diphenhydramine Inj. 50mg/1ml":2,
    "DuoNeb 0.5mg/3mg in 3ml":3,
    "Epinephrine Syringe 1:10000 1mg/10ml":6,
    "Epinephrine Inj. 1:1000 1mg/1ml":2,
    "Glucagon Inj. 1mg":1,
    "Lidocaine Syringe 100mg/5ml":4,
    "Naloxone Inj. 2mg/2ml":2,
    "Nitroglycerin SL Tabs #25 0.4mg":1,
    "Ondansetron 4mg/2ml":1,
    "Ondansetron ODT 4mg":1,
    "0.9% Normal Saline 1000 mL":1,
    "Lactated Ringer 1000 mL":1
  }
};

/* ---------- Tabs (mirrors schema.sql table names) ---------- */
const TAB = {
  CONFIG: "Config",
  APPARATUS: "Apparatus",

  CHECKS: "checks",
  ISSUES: "issues",
  WEEKLY: "weekly_config",
  EMAILS: "email_recipients",
  DRUGMASTER: "drug_master",

  // Optional helper/search tab (kept for your Search UI)
  MED_ALERTS: "MedEmailAlerts"
};

/* ---------- Email group keys ---------- */
const GROUP_ISSUES_MASTER = "issues_master";
function groupIssuesStation_(stationId) { return `issues_station_${stationId}`; }
function groupDrugsStation_(stationId) { return `drugs_station_${stationId}`; }

/* ---------- Drug alert thresholds (days) ---------- */
const DRUG_ALERT_DAYS = { SOON: 30, URGENT: 14 };

/* ---------- Drug Master per-unit view tabs ---------- */
/**
 * If true, this script will maintain per-unit "view tabs" named:
 *   drug_master__E-1, drug_master__E-4, drug_master__T-2, etc.
 * Each is auto-populated from the main drug_master table for that unit.
 */
const ENABLE_DRUGMASTER_UNIT_TABS = true;
function drugMasterUnitTabName_(unitId) {
  return `drug_master__${String(unitId || "").trim().toUpperCase()}`;
}

/* ============================================================
 * HTTP entry points
 * ============================================================ */
function doGet(e) {
  try {
    ensureSchema_();
    const action = String((e && e.parameter && e.parameter.action) || "").trim();
    if (!action) return json_({ ok: false, error: "Missing action" });

    const out = routeGet_(action, e.parameter || {});
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  try {
    ensureSchema_();
    const bodyText = (e && e.postData && e.postData.contents) ? e.postData.contents : "{}";
    const body = bodyText ? JSON.parse(bodyText) : {};
    const action = String(body.action || "").trim();
    if (!action) return json_({ ok: false, error: "Missing action" });

    const out = routePost_(action, body);
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ============================================================
 * Router
 * ============================================================ */
function routeGet_(action, q) {
  switch (String(action)) {
    case "ping":
      return { ok: true, ts: new Date().toISOString() };

    case "getConfig":
      return getConfig_();

    case "getApparatus":
      return getApparatus_(q.stationId);

    case "getActiveIssues":
      return getActiveIssues_(q.stationId, q.apparatusId);

    case "listIssues":
      return listIssues_(q.stationId, q.apparatusId, String(q.includeCleared || "false").toLowerCase() === "true");

    case "getAdminStatus":
      return getAdminStatus_();

    case "searchRecords":
      return searchRecords_(q);

    // Optional
    case "getDrugMaster":
      return getDrugMaster_(q.unit);

    default:
      // Legacy passthrough (paste your old handlers into legacyRouteGet_ below)
      if (typeof legacyRouteGet_ === "function") {
        const legacy = legacyRouteGet_(action, q);
        if (legacy && legacy.__handled) return legacy.payload;
      }
      return { ok: false, error: "Unknown action: " + action };
  }
}

function routePost_(action, body) {
  switch (String(action)) {
    case "saveCheck":
      return saveCheck_(body);

    case "updateIssue":
      return updateIssue_(body);

    case "setWeeklyDay":
      return setWeeklyDay_(body);

    case "setEmailRecipients":
      return setEmailRecipients_(body);

    case "getSearchMeta":
      return getSearchMeta_();

    default:
      // Legacy passthrough (paste your old handlers into legacyRoutePost_ below)
      if (typeof legacyRoutePost_ === "function") {
        const legacy = legacyRoutePost_(action, body);
        if (legacy && legacy.__handled) return legacy.payload;
      }
      return { ok: false, error: "Unknown action: " + action };
  }
}

/* ============================================================
 * Schema / auto-build tabs (NON-DESTRUCTIVE)
 * ============================================================ */
function ensureSchema_() {
  const ss = SpreadsheetApp.getActive();

  // Non-destructive: if sheet exists, do NOT clear it.
  ensureSheetNonDestructive_(ss, TAB.CONFIG, ["key", "value"]);
  ensureSheetNonDestructive_(ss, TAB.APPARATUS, ["stationId", "apparatusId", "apparatusName"]);

  ensureSheetNonDestructive_(ss, TAB.CHECKS, [
    "id", "timestamp", "stationId", "apparatusId", "checkType", "submitter",
    "payload_json", "summary"
  ]);

  ensureSheetNonDestructive_(ss, TAB.ISSUES, [
    "id", "created_ts", "updated_ts", "stationId", "apparatusId",
    "text", "note", "created_by", "status",
    "cleared_ts", "cleared_by", "ack_ts", "ack_by"
  ]);

  ensureSheetNonDestructive_(ss, TAB.WEEKLY, ["checkKey", "weekday", "updated_ts", "updated_by"]);
  ensureSheetNonDestructive_(ss, TAB.EMAILS, ["groupKey", "emails_json", "updated_ts", "updated_by"]);
  ensureSheetNonDestructive_(ss, TAB.DRUGMASTER, ["unit", "drug_name", "last_known_exp", "last_qty", "updated_ts"]);
  ensureSheetNonDestructive_(ss, TAB.MED_ALERTS, ["id", "timestamp", "stationId", "apparatusId", "drug_name", "exp", "days", "tier", "submitter"]);

  seedConfigIfEmpty_();
  seedApparatusIfEmpty_();

  ensureDrugMasterSeeded_();
}

function ensureSheetNonDestructive_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);
    return sh;
  }

  // If it exists:
  // - If row 1 is empty, write headers
  // - If headers differ, DO NOT clear (preserve legacy/older layouts); just leave it.
  const firstRow = sh.getRange(1, 1, 1, headers.length).getValues()[0];
  const empty = firstRow.every(v => String(v || "").trim() === "");
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.autoResizeColumns(1, headers.length);
  }

  return sh;
}

function seedConfigIfEmpty_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.CONFIG);
  if (sh.getLastRow() > 1) return;

  const seed = [
    ["stationIdDefault", "1"],
    ["stations_json", JSON.stringify(STATIONS)],
    // Default drugs + quantities for the Medical Daily UI
    ["drugs_csv", (DFD_DRUG_CONFIG.drugs || []).join(",")],
    ["defaultQty_json", JSON.stringify(DFD_DRUG_CONFIG.defaultQty || {})]
  ];
  sh.getRange(2, 1, seed.length, 2).setValues(seed);
}

function seedApparatusIfEmpty_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.APPARATUS);
  if (sh.getLastRow() > 1) return;

  const rows = APPARATUS_SEED.map(a => [a.stationId, a.apparatusId, a.apparatusName || a.apparatusId]);
  sh.getRange(2, 1, rows.length, 3).setValues(rows);
  sh.autoResizeColumns(1, 3);
}

/* ============================================================
 * Config + Search Meta
 * ============================================================ */
function getConfig_() {
  const cfg = readConfig_();
  return { ok: true, config: cfg };
}

function getSearchMeta_() {
  const cfg = readConfig_();
  const stations = buildStationsWithApparatus_();
  return { ok: true, meta: { ...cfg, stations } };
}

function readConfig_() {
  const kv = readKeyValue_(TAB.CONFIG);
  const stationIdDefault = String(kv.stationIdDefault || "1");

  const stations = safeJson_(kv.stations_json, STATIONS);

  const drugs_csv = String(kv.drugs_csv || "").trim();
  const drugsFromSheet = drugs_csv ? drugs_csv.split(",").map(s => s.trim()).filter(Boolean) : [];
  const drugs = (drugsFromSheet.length ? drugsFromSheet : (DFD_DRUG_CONFIG.drugs || []));

  const defaultQtyFromSheet = safeJson_(kv.defaultQty_json, {});
  const defaultQty = (defaultQtyFromSheet && Object.keys(defaultQtyFromSheet).length)
    ? defaultQtyFromSheet
    : (DFD_DRUG_CONFIG.defaultQty || {});

  return { stationIdDefault, stations, drugs, defaultQty };
}

function buildStationsWithApparatus_() {
  const cfg = readConfig_();
  const stations = Array.isArray(cfg.stations) ? cfg.stations : STATIONS;

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.APPARATUS);
  const vals = sh.getDataRange().getValues();

  const map = new Map();
  stations.forEach(s => map.set(String(s.stationId), { stationId: String(s.stationId), stationName: String(s.stationName || s.stationId), apparatus: [] }));

  for (let i = 1; i < vals.length; i++) {
    const st = String(vals[i][0] || "").trim();
    const id = String(vals[i][1] || "").trim();
    const name = String(vals[i][2] || id).trim();
    if (!st || !id) continue;
    if (!map.has(st)) map.set(st, { stationId: st, stationName: st, apparatus: [] });
    map.get(st).apparatus.push({ apparatusId: id, apparatusName: name });
  }

  for (const s of map.values()) {
    s.apparatus.sort((a, b) => String(a.apparatusId).localeCompare(String(b.apparatusId), undefined, { numeric: true, sensitivity: "base" }));
  }

  const order = ["1","2","3","4","5","6","7","R"];
  return order.filter(id => map.has(id)).map(id => map.get(id));
}

/* ============================================================
 * Apparatus
 * ============================================================ */
function getApparatus_(stationIdRaw) {
  const stationId = String(stationIdRaw || "").trim();
  if (!stationId) return { ok: true, apparatus: [] };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.APPARATUS);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const st = String(vals[i][0] || "").trim();
    if (st !== stationId) continue;
    const apparatusId = String(vals[i][1] || "").trim();
    if (!apparatusId) continue;
    out.push({
      stationId: st,
      apparatusId,
      apparatusName: String(vals[i][2] || apparatusId).trim()
    });
  }

  out.sort((a, b) => String(a.apparatusId).localeCompare(String(b.apparatusId), undefined, { numeric: true, sensitivity: "base" }));
  return { ok: true, apparatus: out };
}

/* ============================================================
 * Checks (saveCheck)
 * ============================================================ */
function saveCheck_(body) {
  const stationId = String(body.stationId || "").trim();
  const apparatusId = String(body.apparatusId || "").trim();
  const submitter = String(body.submitter || "").trim();
  const checkType = String(body.checkType || "").trim();
  const payload = body.checkPayload || {};

  if (!stationId || !apparatusId || !submitter || !checkType) {
    return { ok: false, error: "Missing required fields: stationId, apparatusId, submitter, checkType" };
  }

  const nowIso = new Date().toISOString();
  const id = makeId_();

  const payloadJson = JSON.stringify(payload || {});
  const summary = buildSummary_(stationId, apparatusId, checkType, payload);

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.CHECKS);
  sh.appendRow([id, nowIso, stationId, apparatusId, checkType, submitter, payloadJson, summary]);

  // Update Drug Master + optional med alerts/email
  if (checkType === "medicalDaily") {
    updateDrugMaster_(apparatusId, payload, nowIso);

    // Maintain per-unit view tab (optional)
    if (ENABLE_DRUGMASTER_UNIT_TABS) {
      syncDrugMasterUnitTab_(apparatusId);
    }

    maybeSendDrugAlerts_(stationId, apparatusId, submitter, payload, nowIso);
  }

  // Create issue if provided
  const newIssueText = String(body.newIssueText || "").trim();
  const newIssueNote = String(body.newIssueNote || "").trim();
  if (newIssueText) {
    createIssue_(stationId, apparatusId, submitter, newIssueText, newIssueNote, nowIso);
  }

  return { ok: true, saved: true, id };
}

function buildSummary_(stationId, apparatusId, checkType, payload) {
  const base = `${stationId} ${apparatusId} — ${checkType}`;
  if (!payload) return base;

  if (checkType === "apparatusDaily") {
    const miles = payload.mileage ?? "";
    const fuel = payload.fuel ?? "";
    return `${base} (mi:${miles} fuel:${fuel}%)`;
  }
  if (checkType === "medicalDaily") {
    const o2 = payload.o2 ?? "";
    return `${base} (O2:${o2})`;
  }
  return base;
}

/* ============================================================
 * Issues
 * ============================================================ */
function createIssue_(stationId, apparatusId, submitter, issueText, note, nowIso) {
  const issueId = makeId_();
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.ISSUES);

  sh.appendRow([
    issueId,
    nowIso, // created_ts
    nowIso, // updated_ts
    stationId,
    apparatusId,
    issueText,
    note || "",
    submitter,
    "NEW",
    "", "", "", ""
  ]);

  sendIssueEmails_(stationId, apparatusId, issueText, note, submitter, nowIso);
}

function getActiveIssues_(stationIdRaw, apparatusIdRaw) {
  const stationId = String(stationIdRaw || "").trim();
  const apparatusId = String(apparatusIdRaw || "").trim();
  if (!stationId || !apparatusId) return { ok: true, issues: [] };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.ISSUES);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const st = String(vals[i][3] || "").trim();
    const ap = String(vals[i][4] || "").trim();
    const status = String(vals[i][8] || "").trim().toUpperCase();
    if (st !== stationId || ap !== apparatusId) continue;
    if (status === "RESOLVED") continue;

    out.push({
      id: String(vals[i][0] || ""),
      createdAt: String(vals[i][1] || ""),
      lastUpdatedAt: String(vals[i][2] || ""),
      stationId: st,
      apparatusId: ap,
      issueText: String(vals[i][5] || ""),
      note: String(vals[i][6] || ""),
      createdBy: String(vals[i][7] || ""),
      status,
      acknowledged: !!String(vals[i][11] || "").trim()
    });
  }

  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { ok: true, issues: out };
}

function listIssues_(stationIdRaw, apparatusIdRaw, includeCleared) {
  const stationId = String(stationIdRaw || "").trim();
  const apparatusId = String(apparatusIdRaw || "").trim();

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.ISSUES);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const st = String(vals[i][3] || "").trim();
    const ap = String(vals[i][4] || "").trim();
    const status = String(vals[i][8] || "").trim().toUpperCase();

    if (stationId && st !== stationId) continue;
    if (apparatusId && ap !== apparatusId) continue;
    if (!includeCleared && status === "RESOLVED") continue;

    out.push({
      id: String(vals[i][0] || ""),
      createdAt: String(vals[i][1] || ""),
      lastUpdatedAt: String(vals[i][2] || ""),
      stationId: st,
      apparatusId: ap,
      issueText: String(vals[i][5] || ""),
      note: String(vals[i][6] || ""),
      createdBy: String(vals[i][7] || ""),
      status,
      clearedAt: String(vals[i][9] || ""),
      clearedBy: String(vals[i][10] || ""),
      acknowledged: !!String(vals[i][11] || "").trim(),
      acknowledgedAt: String(vals[i][11] || ""),
      acknowledgedBy: String(vals[i][12] || "")
    });
  }

  out.sort((a, b) => String(b.lastUpdatedAt).localeCompare(String(a.lastUpdatedAt)));
  return { ok: true, issues: out };
}

function updateIssue_(body) {
  const issueId = String(body.issueId || "").trim();
  const user = String(body.user || body.updatedBy || "").trim() || "Unknown";
  const status = String(body.status || "").trim().toUpperCase();
  const note = String(body.note || "").trim();
  const actionType = String(body.actionType || body.subAction || "").trim().toUpperCase();

  if (!issueId) return { ok: false, error: "Missing issueId" };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.ISSUES);
  const last = sh.getLastRow();
  if (last < 2) return { ok: false, error: "No issues found" };

  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  const nowIso = new Date().toISOString();

  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i][0] || "").trim();
    if (id !== issueId) continue;

    const row = i + 2;

    sh.getRange(row, 3).setValue(nowIso); // updated_ts

    if (note) sh.getRange(row, 7).setValue(note);

    if (actionType === "ACK") {
      sh.getRange(row, 12).setValue(nowIso); // ack_ts
      sh.getRange(row, 13).setValue(user);   // ack_by
    }

    if (status) {
      sh.getRange(row, 9).setValue(status);
      if (status === "RESOLVED") {
        sh.getRange(row, 10).setValue(nowIso);
        sh.getRange(row, 11).setValue(user);
      }
    }

    return { ok: true, updated: true };
  }

  return { ok: false, error: "Issue not found" };
}

/* ============================================================
 * Admin Status (Weekly + Email recipients)
 * ============================================================ */
function getAdminStatus_() {
  const weeklyConfig = readWeeklyConfig_();
  const emailRecipients = readEmailRecipients_();
  return { ok: true, status: { weeklyConfig, emailRecipients } };
}

function setWeeklyDay_(body) {
  const checkKey = String(body.checkKey || "").trim();
  const weekday = String(body.weekday || "").trim();
  const user = String(body.user || "").trim() || "Unknown";
  if (!checkKey) return { ok: false, error: "Missing checkKey" };
  if (!weekday) return { ok: false, error: "Missing weekday" };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.WEEKLY);
  upsertByKey_(sh, 1, checkKey, [checkKey, weekday, new Date().toISOString(), user]);
  return { ok: true, saved: true };
}

function setEmailRecipients_(body) {
  const user = String(body.user || "").trim() || "Unknown";
  const emailsMap = body.emails || {};
  if (!emailsMap || typeof emailsMap !== "object") return { ok: false, error: "Missing emails map" };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.EMAILS);
  const nowIso = new Date().toISOString();

  Object.keys(emailsMap).forEach(groupKey => {
    const list = Array.isArray(emailsMap[groupKey]) ? emailsMap[groupKey] : [];
    const normalized = list.map(s => String(s).trim()).filter(Boolean);
    upsertByKey_(sh, 1, groupKey, [groupKey, JSON.stringify(normalized), nowIso, user]);
  });

  return { ok: true, saved: true };
}

function readWeeklyConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.WEEKLY);
  const vals = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || "").trim();
    const w = String(vals[i][1] || "").trim();
    if (!k) continue;
    out[k] = w;
  }
  return out;
}

function readEmailRecipients_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.EMAILS);
  const vals = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || "").trim();
    const json = String(vals[i][1] || "").trim();
    if (!k) continue;
    const list = safeJson_(json, []);
    out[k] = Array.isArray(list) ? list : [];
  }
  return out;
}

/* ============================================================
 * Search (matches search.js expectations)
 * ============================================================ */
function searchRecords_(q) {
  const stationId = String(q.stationId || "all").trim();
  const apparatusId = String(q.apparatusId || "all").trim();
  const category = String(q.category || "").trim();
  const from = String(q.from || "").trim(); // YYYY-MM-DD
  const to = String(q.to || "").trim();     // YYYY-MM-DD
  const text = String(q.q || "").trim().toLowerCase();
  const limit = clamp_(Number(q.limit || 200), 1, 1000);

  if (!category) return { ok: true, results: [] };

  const fromIso = from ? new Date(from + "T00:00:00Z").toISOString() : "";
  const toIso = to ? new Date(to + "T23:59:59Z").toISOString() : "";

  if (category === "issues") {
    return { ok: true, results: searchIssues_(stationId, apparatusId, fromIso, toIso, text, limit) };
  }
  if (category === "medAlerts") {
    return { ok: true, results: searchMedAlerts_(stationId, apparatusId, fromIso, toIso, text, limit) };
  }

  const checkType = category;
  return { ok: true, results: searchChecks_(stationId, apparatusId, checkType, fromIso, toIso, text, limit) };
}

function searchChecks_(stationId, apparatusId, checkType, fromIso, toIso, text, limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.CHECKS);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const ts = String(vals[i][1] || "");
    const st = String(vals[i][2] || "");
    const ap = String(vals[i][3] || "");
    const ct = String(vals[i][4] || "");
    const submitter = String(vals[i][5] || "");
    const payloadJson = String(vals[i][6] || "");
    const summary = String(vals[i][7] || "");

    if (fromIso && ts < fromIso) continue;
    if (toIso && ts > toIso) continue;

    if (stationId !== "all" && st !== stationId) continue;
    if (apparatusId !== "all" && ap !== apparatusId) continue;
    if (checkType && ct !== checkType) continue;

    if (text) {
      const hay = (summary + " " + submitter + " " + payloadJson).toLowerCase();
      if (!hay.includes(text)) continue;
    }

    out.push({ timestamp: ts, stationId: st, apparatusId: ap, category: ct, submitter, summary });
    if (out.length >= limit) break;
  }

  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return out;
}

function searchIssues_(stationId, apparatusId, fromIso, toIso, text, limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.ISSUES);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const ts = String(vals[i][2] || vals[i][1] || "");
    const st = String(vals[i][3] || "");
    const ap = String(vals[i][4] || "");
    const issueText = String(vals[i][5] || "");
    const note = String(vals[i][6] || "");
    const submitter = String(vals[i][7] || "");
    const status = String(vals[i][8] || "");

    if (fromIso && ts < fromIso) continue;
    if (toIso && ts > toIso) continue;

    if (stationId !== "all" && st !== stationId) continue;
    if (apparatusId !== "all" && ap !== apparatusId) continue;

    if (text) {
      const hay = (issueText + " " + note + " " + submitter + " " + status).toLowerCase();
      if (!hay.includes(text)) continue;
    }

    out.push({
      timestamp: ts,
      stationId: st,
      apparatusId: ap,
      category: "issues",
      submitter,
      summary: `${issueText}${note ? " — " + note : ""} (${status || "NEW"})`
    });

    if (out.length >= limit) break;
  }

  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return out;
}

function searchMedAlerts_(stationId, apparatusId, fromIso, toIso, text, limit) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.MED_ALERTS);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const ts = String(vals[i][1] || "");
    const st = String(vals[i][2] || "");
    const ap = String(vals[i][3] || "");
    const drug = String(vals[i][4] || "");
    const exp = String(vals[i][5] || "");
    const tier = String(vals[i][7] || "");
    const submitter = String(vals[i][8] || "");

    if (fromIso && ts < fromIso) continue;
    if (toIso && ts > toIso) continue;

    if (stationId !== "all" && st !== stationId) continue;
    if (apparatusId !== "all" && ap !== apparatusId) continue;

    const summary = `${drug} exp ${exp} (${tier})`;
    if (text) {
      const hay = (summary + " " + submitter).toLowerCase();
      if (!hay.includes(text)) continue;
    }

    out.push({ timestamp: ts, stationId: st, apparatusId: ap, category: "medAlerts", submitter, summary });
    if (out.length >= limit) break;
  }

  out.sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  return out;
}

/* ============================================================
 * Drug Master (system-wide) + per-unit tabs
 * ============================================================ */
function getDrugMaster_(unitRaw) {
  const unit = String(unitRaw || "").trim().toUpperCase();
  if (!unit) return { ok: true, items: [] };

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.DRUGMASTER);
  const vals = sh.getDataRange().getValues();
  const out = [];

  for (let i = 1; i < vals.length; i++) {
    const u = String(vals[i][0] || "").trim().toUpperCase();
    if (u !== unit) continue;
    out.push({
      unit: u,
      name: String(vals[i][1] || ""),
      exp: String(vals[i][2] || ""),
      qty: vals[i][3],
      updated_ts: String(vals[i][4] || "")
    });
  }

  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { ok: true, items: out };
}

/**
 * Stores MOST RECENT expiration per (unit, drug_name) in drug_master.
 * Called after medicalDaily saves.
 */
function updateDrugMaster_(unit, payload, nowIso) {
  if (!payload || !Array.isArray(payload.drugs)) return;

  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.DRUGMASTER);
  const index = buildDrugMasterIndex_(sh);

  const unitKey = String(unit || "").trim().toUpperCase();

  payload.drugs.forEach(d => {
    const name = String(d.name || "").trim();
    const exp = String(d.exp || "").trim(); // YYYY-MM-DD
    const qty = (d.qty != null) ? Number(d.qty) : "";
    if (!unitKey || !name || !exp) return;

    const key = (unitKey + "||" + name).toLowerCase();
    if (index[key]) {
      const row = index[key];
      sh.getRange(row, 3).setValue(exp);
      sh.getRange(row, 4).setValue(qty);
      sh.getRange(row, 5).setValue(nowIso);
    } else {
      sh.appendRow([unitKey, name, exp, qty, nowIso]);
    }
  });
}

/**
 * Ensure drug_master has at least one row per (unit, drug) using default quantities.
 * - Exp is blank until someone enters it.
 * - This makes unit tabs + API have a consistent set of rows.
 */
function ensureDrugMasterSeeded_() {
  const cfg = readConfig_();
  const drugs = Array.isArray(cfg.drugs) ? cfg.drugs : [];
  if (!drugs.length) return;

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB.DRUGMASTER);
  if (!sh) return;

  const index = buildDrugMasterIndex_(sh);
  const nowIso = new Date().toISOString();

  // Units from Apparatus tab (preferred)
  const units = listAllUnits_();

  const rowsToAppend = [];
  units.forEach(unit => {
    drugs.forEach(drug => {
      const key = (String(unit).toUpperCase().trim() + "||" + String(drug).trim()).toLowerCase();
      if (index[key]) return;
      const qty = (cfg.defaultQty && cfg.defaultQty[drug] != null) ? Number(cfg.defaultQty[drug]) : "";
      rowsToAppend.push([String(unit).toUpperCase().trim(), String(drug).trim(), "", qty, ""]);
    });
  });

  if (rowsToAppend.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rowsToAppend.length, 5).setValues(rowsToAppend);
  }

  // Keep per-unit view tabs in sync
  if (typeof ENABLE_DRUGMASTER_UNIT_TABS !== "undefined" && ENABLE_DRUGMASTER_UNIT_TABS) {
    units.forEach(u => syncDrugMasterUnitTab_(u));
  }
}

function listAllUnits_() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(TAB.APPARATUS);
  if (!sh) return [];
  const vals = sh.getDataRange().getValues();
  const set = {};
  for (let i = 1; i < vals.length; i++) {
    const id = String(vals[i][1] || "").trim();
    if (!id) continue;
    set[id.toUpperCase()] = true;
  }
  return Object.keys(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/**
 * Override syncDrugMasterUnitTab_ behavior to always include the full drug list
 * (even if exp is blank).
 */


function buildDrugMasterIndex_(sh) {
  const vals = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < vals.length; i++) {
    const unit = String(vals[i][0] || "").trim().toUpperCase();
    const name = String(vals[i][1] || "").trim();
    if (!unit || !name) continue;
    out[(unit + "||" + name).toLowerCase()] = i + 1;
  }
  return out;
}

/**
 * Creates/updates a per-unit tab that mirrors drug_master for that unit.
 * This is optional; the system itself reads from the main drug_master table.
 */
function syncDrugMasterUnitTab_(unitIdRaw) {
  const unit = String(unitIdRaw || "").trim().toUpperCase();
  if (!unit) return;

  const ss = SpreadsheetApp.getActive();
  const tabName = drugMasterUnitTabName_(unit);

  let sh = ss.getSheetByName(tabName);
  if (!sh) sh = ss.insertSheet(tabName);

  const headers = ["drug_name", "last_known_exp", "last_qty", "updated_ts"];
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.setFrozenRows(1);

  const master = ss.getSheetByName(TAB.DRUGMASTER);
  const vals = master.getDataRange().getValues();

  const rows = [];
  for (let i = 1; i < vals.length; i++) {
    const u = String(vals[i][0] || "").trim().toUpperCase();
    if (u !== unit) continue;
    rows.push([
      String(vals[i][1] || ""),
      String(vals[i][2] || ""),
      vals[i][3],
      String(vals[i][4] || "")
    ]);
  }

  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
    sh.autoResizeColumns(1, headers.length);
  }
}

/* ============================================================
 * Drug expiration alert emails (optional)
 * ============================================================ */
function maybeSendDrugAlerts_(stationId, apparatusId, submitter, payload, nowIso) {
  if (!payload || !Array.isArray(payload.drugs) || payload.drugs.length === 0) return;

  const cfg = readConfig_();
  const drugsEnabled = Array.isArray(cfg.drugs) && cfg.drugs.length > 0;
  if (!drugsEnabled) return;

  const recipients = readEmailRecipients_();
  const toList = recipients[groupDrugsStation_(stationId)] || [];
  if (!toList.length) return;

  const alerts = [];
  payload.drugs.forEach(d => {
    const name = String(d.name || "").trim();
    const exp = String(d.exp || "").trim();
    const days = daysUntil_(exp);
    if (days == null) return;

    if (days < DRUG_ALERT_DAYS.SOON) {
      const tier = (days < DRUG_ALERT_DAYS.URGENT) ? "URGENT" : "SOON";
      alerts.push({ name, exp, days, tier });
      logMedAlert_(stationId, apparatusId, submitter, nowIso, name, exp, days, tier);
    }
  });

  if (!alerts.length) return;

  const subject = `DFD Drug Expiration — Station ${stationId} ${apparatusId}`;
  const lines = alerts.sort((a, b) => a.days - b.days).map(a => `• ${a.name} — exp ${a.exp} (${a.days}d) [${a.tier}]`);

  const body =
`Drug Expiration Alert

Station: ${stationId}
Apparatus: ${apparatusId}
Submitted By: ${submitter}
Time: ${nowIso}

Alerts:
${lines.join("\n")}
`;

  MailApp.sendEmail({ to: toList.join(","), subject, body });
}

function logMedAlert_(stationId, apparatusId, submitter, nowIso, drugName, exp, days, tier) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.MED_ALERTS);
  sh.appendRow([makeId_(), nowIso, stationId, apparatusId, drugName, exp, days, tier, submitter]);
}

/* ============================================================
 * Emails (issues)
 * ============================================================ */
function sendIssueEmails_(stationId, apparatusId, issueText, note, submitter, tsIso) {
  const recipients = readEmailRecipients_();

  const stationList = recipients[groupIssuesStation_(stationId)] || [];
  const masterList = recipients[GROUP_ISSUES_MASTER] || [];

  const all = uniqEmails_([].concat(stationList, masterList));
  if (!all.length) return;

  const subject = `DFD System Issue — Station ${stationId} ${apparatusId}`;
  const body =
`New Issue Submitted

Station: ${stationId}
Apparatus: ${apparatusId}
Submitted By: ${submitter}
Time: ${tsIso}

Issue:
${issueText}

Note:
${note || "(none)"}
`;

  MailApp.sendEmail({ to: all.join(","), subject, body });
}

/* ============================================================
 * Helpers
 * ============================================================ */
function readKeyValue_(tabName) {
  const sh = SpreadsheetApp.getActive().getSheetByName(tabName);
  const vals = sh.getDataRange().getValues();
  const out = {};
  for (let i = 1; i < vals.length; i++) {
    const k = String(vals[i][0] || "").trim();
    if (!k) continue;
    out[k] = vals[i][1];
  }
  return out;
}

function upsertByKey_(sh, keyCol1Based, keyValue, fullRowValues) {
  const last = sh.getLastRow();
  if (last < 2) {
    sh.appendRow(fullRowValues);
    return;
  }

  const keys = sh.getRange(2, keyCol1Based, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    const v = String(keys[i][0] || "").trim();
    if (v === keyValue) {
      sh.getRange(i + 2, 1, 1, fullRowValues.length).setValues([fullRowValues]);
      return;
    }
  }
  sh.appendRow(fullRowValues);
}

function uniqEmails_(arr) {
  const seen = {};
  const out = [];
  (arr || []).forEach(e => {
    const v = String(e || "").trim();
    if (!v || !v.includes("@")) return;
    const k = v.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(v);
  });
  return out;
}

function safeJson_(v, fallback) {
  try {
    if (!v) return fallback;
    const parsed = JSON.parse(String(v));
    return (parsed == null) ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

function makeId_() {
  return Utilities.getUuid().replace(/-/g, "").slice(0, 18);
}

function clamp_(n, a, b) {
  if (!isFinite(n)) return a;
  return Math.max(a, Math.min(b, n));
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function daysUntil_(ymd) {
  const m = String(ymd || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  const exp = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  if (isNaN(exp.getTime())) return null;

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diffMs = exp.getTime() - todayUtc.getTime();
  return Math.floor(diffMs / 86400000);
}

/* ============================================================
 * Legacy passthrough stubs
 * ============================================================ */
/**
 * Paste your OLD legacy GET handlers into these functions.
 * Return {__handled:true, payload:{...}} when handled.
 */
function legacyRouteGet_(action, q) {
  try {
    if (typeof LEGACY === "undefined" || !LEGACY || typeof LEGACY.doGet !== "function") return { __handled: false };

    // Build a fake GAS event object
    const e = { parameter: Object.assign({ action: String(action || "") }, (q || {})) };
    const out = LEGACY.doGet(e);

    // If legacy didn't return a text output, treat as unhandled
    if (!out) return { __handled: false };

    // Try to read JSON content
    const text = (typeof out.getContent === "function") ? out.getContent() : String(out);
    let payload;
    try { payload = JSON.parse(text); } catch (e2) { return { __handled: false }; }

    // If legacy says unknown action, allow modern router to handle
    const err = String(payload && payload.error ? payload.error : "").toLowerCase();
    if (!payload || (payload.ok === false && err.indexOf("unknown action") >= 0)) return { __handled: false };

    return { __handled: true, payload };
  } catch (e) {
    return { __handled: false };
  }
}

/**
 * Paste your OLD legacy POST handlers into these functions.
 * Return {__handled:true, payload:{...}} when handled.
 */
function legacyRoutePost_(action, body) {
  try {
    if (typeof LEGACY === "undefined" || !LEGACY || typeof LEGACY.doPost !== "function") return { __handled: false };

    const merged = Object.assign({}, (body || {}), { action: String(action || "") });
    const e = { postData: { contents: JSON.stringify(merged) } };
    const out = LEGACY.doPost(e);
    if (!out) return { __handled: false };

    const text = (typeof out.getContent === "function") ? out.getContent() : String(out);
    let payload;
    try { payload = JSON.parse(text); } catch (e2) { return { __handled: false }; }

    const err = String(payload && payload.error ? payload.error : "").toLowerCase();
    if (!payload || (payload.ok === false && err.indexOf("unknown action") >= 0)) return { __handled: false };

    return { __handled: true, payload };
  } catch (e) {
    return { __handled: false };
  }
}

/* ============================================================
 * Optional menu
 * ============================================================ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DFD System")
    .addItem("Ensure Tabs + Headers (non-destructive)", "ensureSchema_")
    .addItem("Sync ALL Drug Master Unit Tabs", "syncAllDrugMasterUnitTabs_")
    .addToUi();
}

/** Sync all unit tabs at once (optional menu item) */
function syncAllDrugMasterUnitTabs_() {
  if (!ENABLE_DRUGMASTER_UNIT_TABS) return;
  const units = APPARATUS_SEED.map(a => String(a.apparatusId));
  const uniq = {};
  units.forEach(u => { uniq[String(u).toUpperCase()] = true; });
  Object.keys(uniq).forEach(u => syncDrugMasterUnitTab_(u));
}



/* ============================================================
 * LEGACY BACKEND (wrapped, isolated)
 * ============================================================ */
const LEGACY = (function () {
  // ---- BEGIN legacy Code.gs (wrapped) ----
/************************************************************
 * Decatur Fire Checks — PWA Backend (Google Apps Script)
 * Station-scoped email groups + drug escalation tiers
 ************************************************************/

/******************************************************
 * STATIONS + APPARATUS
 ******************************************************/
var STATIONS = {
  "1": {
    stationId: "1",
    stationName: "Station 1",
    apparatus: [
      { apparatusId: "E-1", apparatusName: "E-1" },
      { apparatusId: "T-1", apparatusName: "T-1" },
      { apparatusId: "R-1", apparatusName: "R-1" },
      { apparatusId: "T-3", apparatusName: "T-3 (Reserve)" }
    ]
  },
  "2": { stationId: "2", stationName: "Station 2", apparatus: [] },
  "3": { stationId: "3", stationName: "Station 3", apparatus: [] },
  "4": { stationId: "4", stationName: "Station 4", apparatus: [] },
  "5": { stationId: "5", stationName: "Station 5", apparatus: [] },
  "6": { stationId: "6", stationName: "Station 6", apparatus: [] },
  "7": { stationId: "7", stationName: "Station 7", apparatus: [] }
};

/******************************************************
 * Station 1 medical/drug config
 ******************************************************/
var CONFIG = {
  station: "Station 1",
  drugs: [
    "Adenosine Inj. 6mg/2ml","Aspirin Chew Tabs 81mg","Atropine Syringe 1mg/10ml",
    "Dextrose 10% (D10W) 25g/250ml","Diphenhydramine Inj. 50mg/1ml","DuoNeb 0.5mg/3mg in 3ml",
    "Epinephrine Syringe 1:10000 1mg/10ml","Epinephrine Inj. 1:1000 1mg/1ml","Glucagon Inj. 1mg",
    "Lidocaine Syringe 100mg/5ml","Naloxone Inj. 2mg/2ml","Nitroglycerin SL Tabs #25 0.4mg",
    "Ondansetron 4mg/2ml","Ondansetron ODT 4mg",
    "0.9% Normal Saline 1000 mL",
    "Lactated Ringer 1000 mL"
  ],
  defaultQty: {
    "Adenosine Inj. 6mg/2ml":3,
    "Aspirin Chew Tabs 81mg":4,
    "Atropine Syringe 1mg/10ml":3,
    "Dextrose 10% (D10W) 25g/250ml":2,
    "Diphenhydramine Inj. 50mg/1ml":2,
    "DuoNeb 0.5mg/3mg in 3ml":3,
    "Epinephrine Syringe 1:10000 1mg/10ml":6,
    "Epinephrine Inj. 1:1000 1mg/1ml":2,
    "Glucagon Inj. 1mg":1,
    "Lidocaine Syringe 100mg/5ml":4,
    "Naloxone Inj. 2mg/2ml":2,
    "Nitroglycerin SL Tabs #25 0.4mg":1,
    "Ondansetron 4mg/2ml":1,
    "Ondansetron ODT 4mg":1,
    "0.9% Normal Saline 1000 mL":1,
    "Lactated Ringer 1000 mL":1
  },
  drugSheets: {
    "E-1": "DrugMaster_E-1",
    "T-1": "DrugMaster_T-1"
  }
};

/******************************************************
 * SHEET TAB NAMES
 ******************************************************/
var TAB_APPARATUS_DAILY = "Apparatus_Daily";
var TAB_MEDICAL_DAILY   = "Medical_Daily";
var TAB_SCBA_WEEKLY     = "SCBA_Weekly";
var TAB_PUMP_WEEKLY     = "Pump_Weekly";
var TAB_AERIAL_WEEKLY   = "Aerial_Weekly";
var TAB_SAW_WEEKLY      = "Saw_Weekly";
var TAB_BATTERY_WEEKLY  = "Batteries_Weekly";
var TAB_OOS_UNITS       = "OutOfService_Units";
var TAB_OOS_EQUIP       = "OutOfService_Equipment";

var TAB_ISSUES           = "Issues";
var TAB_MED_EMAIL_ALERTS = "MedEmailAlerts";

// NEW: per-station email config
var TAB_EMAIL_CONFIG     = "EmailConfig";

// Optional legacy (old)
var TAB_EMAILS           = "Emails";

/******************************************************
 * ADMIN CONFIG (Weekly day stored in Script Properties)
 ******************************************************/
var PROP_WEEKLY_PREFIX = "weeklyDay_";
var DEFAULT_WEEKLY_DAY = {
  scbaWeekly: "Saturday",
  pumpWeekly: "Saturday",
  aerialWeekly: "Saturday",
  sawWeekly: "Saturday",
  batteriesWeekly: "Saturday"
};

/******************************************************
 * DRUG EXPIRATION THRESHOLDS
 * - UI colors: >=45 green, <45 yellow, <30 orange, <14 red, past due purple
 * - Email tiers:
 *    * Primary list: <=30 + <=14 escalation
 *    * All list:     <=45 (digest)
 ******************************************************/
var DRUG_THRESHOLDS = {
  ALL_DAYS: 45,
  PRIMARY_30: 30,
  PRIMARY_14: 14
};

/******************************************************
 * WEB APP — JSON ONLY
 ******************************************************/
function doGet(e) {
  e = e || {};
  var action = ((e.parameter && e.parameter.action) || "").toLowerCase();

  try {
    if (action === "ping") {
      return json_({ ok: true, ts: new Date().toISOString() });
    }

    if (action === "getconfig") {
      ensureSheets_();
      return json_({
        ok: true,
        config: {
          stations: Object.keys(STATIONS).map(function(id) {
            return { stationId: id, stationName: STATIONS[id].stationName };
          }),
          stationIdDefault: "1",
          drugs: CONFIG.drugs,
          defaultQty: CONFIG.defaultQty
        }
      });
    }

    if (action === "getapparatus") {
      ensureSheets_();
      var stationId = (e.parameter.stationId || "1").trim();
      var st = STATIONS[stationId] || STATIONS["1"];
      return json_({
        ok: true,
        stationId: st.stationId,
        stationName: st.stationName,
        apparatus: st.apparatus
      });
    }

    if (action === "getactiveissues") {
      ensureSheets_();
      var stationId2 = (e.parameter.stationId || "1").trim();
      var apparatusId = (e.parameter.apparatusId || "").trim();
      return json_({ ok: true, issues: getActiveIssues_(stationId2, apparatusId) });
    }

    if (action === "listissues") {
      ensureSheets_();
      var stationIdL = (e.parameter.stationId || "1").trim();
      var apparatusIdL = (e.parameter.apparatusId || "").trim();
      var includeCleared = String(e.parameter.includeCleared || "false").toLowerCase() === "true";
      return json_({ ok: true, issues: listIssues_(stationIdL, apparatusIdL, includeCleared) });
    }

    // NEW: per-station email config
    if (action === "getemailconfig") {
      ensureSheets_();
      return json_({
        ok: true,
        emails: getEmailConfigByStation_()
      });
    }

    if (action === "getweeklyconfig") {
      ensureSheets_();
      return json_({ ok: true, weeklyConfig: getWeeklyConfig_() });
    }

    if (action === "getadminstatus") {
      ensureSheets_();
      return json_({ ok: true, status: getAdminStatus_() });
    }

    // ✅ SEARCH UI metadata (stations + apparatus list) — GET
    if (action === "getsearchmeta") {
      ensureSheets_();
      return json_({
        ok: true,
        meta: {
          stations: Object.keys(STATIONS).map(function(id){
            return {
              stationId: id,
              stationName: STATIONS[id].stationName,
              apparatus: (STATIONS[id].apparatus || []).map(function(a){
                return { apparatusId: a.apparatusId, apparatusName: a.apparatusName || a.apparatusId };
              })
            };
          })
        }
      });
    }

function getAllSearchCategories_() {
  return [
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
}

    // ✅ SEARCH across history — GET
    // GET /api?action=searchRecords&category=...&stationId=...&apparatusId=...&q=...&from=YYYY-MM-DD&to=YYYY-MM-DD&limit=200
    if (action === "searchrecords") {
      ensureSheets_();
      var paramsG = {
        category: String(e.parameter.category || "").trim(),
        stationId: String(e.parameter.stationId || "all").trim(),
        apparatusId: String(e.parameter.apparatusId || "all").trim(),
        q: String(e.parameter.q || "").trim(),
        from: String(e.parameter.from || "").trim(),
        to: String(e.parameter.to || "").trim(),
        limit: Number(e.parameter.limit || 200)
      };
      var resultsG = searchRecords_(paramsG);
      return json_({ ok: true, results: resultsG });
    }

    // Optional endpoint (your app.js supports it softly)
    if (action === "getdrugmaster") {
      ensureSheets_();
      var unit = String(e.parameter.unit || "").trim();
      return json_({ ok:true, items: getDrugMaster_(unit) });
    }

    return json_({ ok: false, error: "Unknown action" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  e = e || {};
  try {
    ensureSheets_();

    var body = {};
    if (e.postData && e.postData.contents) body = JSON.parse(e.postData.contents);
    var action = ((body.action || "") + "").toLowerCase();

    // NEW: Search UI metadata (stations + apparatus list)
    if (action === "getsearchmeta") {
      ensureSheets_();
      return json_({
        ok: true,
        meta: {
          stations: Object.keys(STATIONS).map(function(id){
            return {
              stationId: id,
              stationName: STATIONS[id].stationName,
              apparatus: (STATIONS[id].apparatus || []).map(function(a){
                return { apparatusId: a.apparatusId, apparatusName: a.apparatusName || a.apparatusId };
              })
            };
          })
        }
      });
    }

    // NEW: Search across history (all sheets)
    // GET /api?action=searchRecords&category=apparatusDaily|medicalDaily|scbaWeekly|pumpWeekly|aerialWeekly|sawWeekly|batteriesWeekly|oosUnit|oosEquipment|issues|medAlerts
    //   &stationId=all|1..7
    //   &apparatusId=all|E-1
    //   &q=keyword
    //   &from=YYYY-MM-DD
    //   &to=YYYY-MM-DD
    //   &limit=200
    if (action === "searchrecords") {
      ensureSheets_();
      var params = {
        category: String(e.parameter.category || "").trim(),
        stationId: String(e.parameter.stationId || "all").trim(),
        apparatusId: String(e.parameter.apparatusId || "all").trim(),
        q: String(e.parameter.q || "").trim(),
        from: String(e.parameter.from || "").trim(),
        to: String(e.parameter.to || "").trim(),
        limit: Number(e.parameter.limit || 200)
      };
      var results = searchRecords_(params);
      return json_({ ok: true, results: results });
    }

    if (action === "setweeklyday") {
      var checkKey = String(body.checkKey || "").trim();
      var weekday = String(body.weekday || "").trim();
      var userW = String(body.user || "").trim();
      if (!checkKey) return json_({ ok:false, error:"Missing checkKey" });
      if (!weekday) return json_({ ok:false, error:"Missing weekday" });
      if (!userW) return json_({ ok:false, error:"Missing user" });

      setWeeklyDay_(checkKey, weekday, userW);
      return json_({ ok:true, saved:true, weeklyConfig: getWeeklyConfig_() });
    }

    if (action === "updateissue") {
      var issueIdU = String(body.issueId || "").trim();
      var userU = String(body.user || "").trim();
      var changes = body.changes || {};
      if (!issueIdU) return json_({ ok:false, error:"Missing issueId" });
      if (!userU) return json_({ ok:false, error:"Missing user" });

      var updatedU = updateIssue_(issueIdU, changes, userU);
      return json_({ ok:true, updated: updatedU });
    }

    // NEW: per-station email config save
    if (action === "setemailconfig") {
      var kind = String(body.kind || "").trim(); // issuesByStation|drugsAllByStation|drugsPrimaryByStation
      var stationId = String(body.stationId || "").trim();
      var emails = body.emails || [];
      var userE = String(body.user || "").trim();

      if (!userE) return json_({ ok:false, error:"Missing user" });
      if (!stationId) return json_({ ok:false, error:"Missing stationId" });
      if (!STATIONS[stationId]) return json_({ ok:false, error:"Unknown stationId" });
      if (!Array.isArray(emails)) return json_({ ok:false, error:"emails must be an array" });

      if (kind !== "issuesByStation" && kind !== "drugsAllByStation" && kind !== "drugsPrimaryByStation") {
        return json_({ ok:false, error:"kind must be issuesByStation | drugsAllByStation | drugsPrimaryByStation" });
      }

      setEmailConfigByStation_(kind, stationId, emails, userE);
      return json_({ ok:true, saved:true, emails: getEmailConfigByStation_() });
    }

    // Med email anti-spam helper (21 day lookback) — unchanged
    if (action === "getmedalertstatus") {
      var station = String(body.station || "").trim();
      var unit2 = String(body.unit || "").trim();
      if (!station) return json_({ ok:false, error:"Missing station" });
      if (!unit2) return json_({ ok:false, error:"Missing unit" });
      var st = getMedAlertStatus_({ station: station, unit: unit2 });
      return json_({ ok:true, status: st });
    }

    // UPDATED: notifyExpiringMeds now station-aware + tiered lists
    if (action === "notifyexpiringmeds") {
      var payload = body || {};
      var res = notifyExpiringMeds_(payload);
      return json_(Object.assign({ ok:true }, res));
    }

    // Save check
    if (action !== "savecheck") return json_({ ok: false, error: "Unknown action" });

    var stationIdS   = String(body.stationId || "1").trim();
    var apparatusIdS = String(body.apparatusId || "").trim();
    var submitterS   = String(body.submitter || "").trim();
    var checkTypeS   = String(body.checkType || "").trim();
    var checkPayload = body.checkPayload || {};

    if (!apparatusIdS) return json_({ ok: false, error: "Missing apparatusId" });
    if (!submitterS)   return json_({ ok: false, error: "Missing submitter" });

    saveCheck_(stationIdS, apparatusIdS, submitterS, checkTypeS, checkPayload);

    var issueResult = handleNewIssue_(stationIdS, apparatusIdS, submitterS, body.newIssueText, body.newIssueNote);

    return json_({ ok: true, saved: true, issue: issueResult });
  } catch (err2) {
    return json_({ ok: false, error: String(err2 && err2.message ? err2.message : err2) });
  }
}

/******************************************************
 * JSON HELPER
 ******************************************************/
function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/******************************************************
 * SETUP / ENSURE TABS EXIST + HEADERS
 ******************************************************/
function ensureSheets_() {
  var ss = SpreadsheetApp.getActive();

  var needed = [
    TAB_APPARATUS_DAILY,
    TAB_MEDICAL_DAILY,
    TAB_SCBA_WEEKLY,
    TAB_PUMP_WEEKLY,
    TAB_AERIAL_WEEKLY,
    TAB_SAW_WEEKLY,
    TAB_BATTERY_WEEKLY,
    TAB_OOS_UNITS,
    TAB_OOS_EQUIP,
    "DrugMaster_E-1",
    "DrugMaster_T-1",
    TAB_ISSUES,
    TAB_MED_EMAIL_ALERTS,
    TAB_EMAIL_CONFIG
  ];

  needed.forEach(function(name) {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  initHeaders_();
  ensureIssuesHasIdColumn_();
  ensureIssuesHasAckColumn_();
  initMedEmailAlerts_();
  initEmailConfig_();
  return true;
}

function initHeaders_() {
  var ss = SpreadsheetApp.getActive();

  initHeaderIfEmpty_(ss.getSheetByName(TAB_APPARATUS_DAILY), [
    "Timestamp","Submitter","Unit",
    "Mileage","Engine Hours","Fuel %","DEF %","Tank Water %",

    "Knox Box Keys (Pass/Fail)","Knox Box Keys Notes",
    "Portable Radios (4) (Pass/Fail)","Portable Radios (4) Notes",
    "Lights (Pass/Fail)","Lights Notes",
    "SCBA (4) (Pass/Fail)","SCBA (4) Notes",
    "Spare Bottles (Pass/Fail)","Spare Bottles Notes",
    "RIT Pack (Pass/Fail)","RIT Pack Notes",
    "Flash Lights (Pass/Fail)","Flash Lights Notes",
    "TIC (4) (Pass/Fail)","TIC (4) Notes",
    "Gas Monitor (Pass/Fail)","Gas Monitor Notes",
    "Hand Tools (Pass/Fail)","Hand Tools Notes",
    "Hydra-Ram (Pass/Fail)","Hydra-Ram Notes",
    "Ground Ladders (Pass/Fail)","Ground Ladders Notes",
    "Passports/Shields (Pass/Fail)","Passports/Shields Notes"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_MEDICAL_DAILY), [
    "Timestamp","Submitter","Unit",
    "O2 Bottle Level (0-2000)",
    "Airway Equipment (Pass/Fail)",
    "Airway Notes",
    "Drugs JSON (name/qty/exp array)"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_SCBA_WEEKLY), [
    "Timestamp","Submitter","Unit",
    "SCBA Label","Bottle PSI (0-4500)",
    "PASS (Pass/Fail)","Notes"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_PUMP_WEEKLY), [
    "Timestamp","Submitter","Unit",
    "Pump Shift","Throttle Valves","Relief Valve","Gauges",
    "Overall (Pass/Fail)","Notes"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_AERIAL_WEEKLY), [
    "Timestamp","Submitter","Unit",
    "Master Switch","Mode Switch",
    "Outriggers","Outriggers Lubed",
    "Ladder Raise","Ladder Rotate","Ladder Extend",
    "Ladder Retract","Ladder Lower",
    "Nozzle Raise","Nozzle Lower","Nozzle Right",
    "Nozzle Left","Nozzle Fog","Nozzle Straight",
    "Lights","Overall (Pass/Fail)","Notes"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_SAW_WEEKLY), [
    "Timestamp","Submitter","Unit",
    "Type (Roof/Rotary)","Saw #",
    "Fuel %","Bar Oil %","Runs (Yes/No)","Notes"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_BATTERY_WEEKLY), [
    "Timestamp","Submitter","Unit",
    "Battery Tools",
    "4-Gas Monitor Charged",
    "Unit Phone Charged",
    "Notes",
    "Extrication Check",
    "Spreader",
    "Cutter",
    "Ram",
    "All 6 Batteries Charged",
    "Damage Noted"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_OOS_UNITS), [
    "Timestamp","Submitter","Unit",
    "Reason",
    "Replacing Reserve Unit",
    "Equipment Moved (list)",
    "Return To Service Date (optional)"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_OOS_EQUIP), [
    "Timestamp","Submitter","Unit",
    "Equipment Type (SCBA/Saw/4-Gas/Bag Monitor/Other)",
    "Identifier",
    "Reason",
    "Replacement",
    "Expected RTS Date (optional)"
  ]);

  initHeaderIfEmpty_(ss.getSheetByName(TAB_ISSUES), [
    "Created Timestamp",
    "Updated Timestamp",
    "StationId",
    "ApparatusId",
    "Issue Text",
    "Bullet Note",
    "Status",
    "Created By",
    "Resolved Timestamp",
    "Resolved By",
    "Acknowledged",
    "IssueId"
  ]);

  initDrugMasterIfEmpty_(ss.getSheetByName("DrugMaster_E-1"));
  initDrugMasterIfEmpty_(ss.getSheetByName("DrugMaster_T-1"));
}

function initHeaderIfEmpty_(sh, headerRow) {
  if (!sh) return;
  var hasHeader = sh.getLastRow() >= 1 && sh.getRange(1,1).getValue();
  if (hasHeader) return;

  sh.clear();
  sh.getRange(1,1,1,headerRow.length).setValues([headerRow]);
  sh.getRange(1,1,1,headerRow.length).setFontWeight("bold");
  sh.autoResizeColumns(1, headerRow.length);
}

function initDrugMasterIfEmpty_(sh) {
  if (!sh) return;
  var hasHeader = sh.getLastRow() >= 1 && sh.getRange(1,1).getValue();
  if (hasHeader) return;

  sh.clear();
  sh.getRange(1,1,1,2).setValues([["Drug","LastKnownExpiration (yyyy-MM-dd)"]]);
  sh.getRange(1,1,1,2).setFontWeight("bold");

  var rows = CONFIG.drugs.map(function(d) { return [d, ""]; });
  if (rows.length) sh.getRange(2,1,rows.length,2).setValues(rows);
  sh.autoResizeColumns(1,2);
}

/******************************************************
 * EMAIL CONFIG (NEW) — EmailConfig sheet
 * Columns:
 * A StationId
 * B IssuesEmails (newline/comma separated)
 * C DrugsAllEmails
 * D DrugsPrimaryEmails
 ******************************************************/
function initEmailConfig_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_EMAIL_CONFIG);
  if (!sh) return;

  var hasHeader = sh.getLastRow() >= 1 && sh.getRange(1,1).getValue();
  if (!hasHeader) {
    sh.clear();
    sh.getRange(1,1,1,4).setValues([[
      "StationId","IssuesEmails","DrugsAllEmails","DrugsPrimaryEmails"
    ]]).setFontWeight("bold");
    sh.autoResizeColumns(1,4);
  }

  // Ensure a row exists per station
  var existing = sh.getDataRange().getValues();
  var seen = {};
  for (var r = 1; r < existing.length; r++) {
    var sid = String(existing[r][0] || "").trim();
    if (sid) seen[sid] = true;
  }

  Object.keys(STATIONS).forEach(function(sid){
    if (!seen[sid]) sh.appendRow([sid, "", "", ""]);
  });
}

function parseEmailBlob_(blob) {
  var txt = String(blob || "");
  var parts = txt
    .split(/\r?\n|,/g)
    .map(function(x){ return String(x||"").trim(); })
    .filter(Boolean);

  var seen = {};
  var out = [];
  for (var i=0;i<parts.length;i++){
    var e = parts[i];
    var k = e.toLowerCase();
    if (seen[k]) continue;
    seen[k]=true;
    out.push(e);
  }
  return out;
}

function joinEmailBlob_(arr) {
  arr = Array.isArray(arr) ? arr : [];
  return arr.map(function(x){ return String(x||"").trim(); }).filter(Boolean).join("\n");
}

function getEmailConfigByStation_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_EMAIL_CONFIG);
  if (!sh) return { issuesByStation:{}, drugsAllByStation:{}, drugsPrimaryByStation:{} };

  var vals = sh.getDataRange().getValues();
  var issuesByStation = {};
  var drugsAllByStation = {};
  var drugsPrimaryByStation = {};

  for (var r=1; r<vals.length; r++) {
    var sid = String(vals[r][0] || "").trim();
    if (!sid) continue;
    issuesByStation[sid] = parseEmailBlob_(vals[r][1]);
    drugsAllByStation[sid] = parseEmailBlob_(vals[r][2]);
    drugsPrimaryByStation[sid] = parseEmailBlob_(vals[r][3]);
  }

  // Guarantee keys exist for all stations
  Object.keys(STATIONS).forEach(function(sid){
    if (!issuesByStation[sid]) issuesByStation[sid]=[];
    if (!drugsAllByStation[sid]) drugsAllByStation[sid]=[];
    if (!drugsPrimaryByStation[sid]) drugsPrimaryByStation[sid]=[];
  });

  return {
    issuesByStation: issuesByStation,
    drugsAllByStation: drugsAllByStation,
    drugsPrimaryByStation: drugsPrimaryByStation
  };
}

function setEmailConfigByStation_(kind, stationId, emails, user) {
  kind = String(kind||"").trim();
  stationId = String(stationId||"").trim();
  if (!STATIONS[stationId]) throw new Error("Unknown stationId: " + stationId);

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_EMAIL_CONFIG);
  if (!sh) throw new Error("Missing sheet: " + TAB_EMAIL_CONFIG);

  var col = null;
  if (kind === "issuesByStation") col = 2;
  if (kind === "drugsAllByStation") col = 3;
  if (kind === "drugsPrimaryByStation") col = 4;
  if (!col) throw new Error("Unknown kind: " + kind);

  var vals = sh.getDataRange().getValues();
  var targetRow = -1;
  for (var r=1; r<vals.length; r++) {
    if (String(vals[r][0]||"").trim() === stationId) { targetRow = r+1; break; }
  }
  if (targetRow === -1) {
    sh.appendRow([stationId,"","",""]);
    targetRow = sh.getLastRow();
  }

  var cleaned = emails.map(function(x){ return String(x||"").trim(); }).filter(Boolean);
  sh.getRange(targetRow, col).setValue(joinEmailBlob_(cleaned));
  // (Optional) You can log user/time to another sheet if desired
}

/******************************************************
 * WEEKLY CONFIG
 ******************************************************/
function getWeeklyConfig_() {
  var props = PropertiesService.getScriptProperties();
  var cfg = {};
  Object.keys(DEFAULT_WEEKLY_DAY).forEach(function(k){
    cfg[k] = props.getProperty(PROP_WEEKLY_PREFIX + k) || DEFAULT_WEEKLY_DAY[k];
  });
  return cfg;
}

function setWeeklyDay_(checkKey, weekday, user) {
  checkKey = String(checkKey || "").trim();
  if (!DEFAULT_WEEKLY_DAY.hasOwnProperty(checkKey)) {
    throw new Error("Unknown checkKey: " + checkKey);
  }
  var wk = String(weekday || "").trim();
  var allowed = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  if (allowed.indexOf(wk) === -1) throw new Error("Invalid weekday: " + wk);

  PropertiesService.getScriptProperties().setProperty(PROP_WEEKLY_PREFIX + checkKey, wk);
  return true;
}

/******************************************************
 * SAVE CHECK ROUTING
 ******************************************************/
function saveCheck_(stationId, apparatusId, submitter, checkType, payload) {
  var type = (checkType || "").toLowerCase();
  if (payload && typeof payload === "object") payload.unit = apparatusId;

  if (type === "apparatusdaily")  return submitApparatusDaily_(submitter, apparatusId, payload);
  if (type === "medicaldaily")    return submitMedicalDaily_(submitter, apparatusId, payload);
  if (type === "scbaweekly")      return submitScbaWeekly_(submitter, apparatusId, payload);
  if (type === "pumpweekly")      return submitPumpWeekly_(submitter, apparatusId, payload);
  if (type === "aerialweekly")    return submitAerialWeekly_(submitter, apparatusId, payload);
  if (type === "sawweekly")       return submitSawWeekly_(submitter, apparatusId, payload);
  if (type === "batteriesweekly") return submitBatteriesWeekly_(submitter, apparatusId, payload);
  if (type === "oosunit")         return submitOutOfServiceUnit_(submitter, apparatusId, payload);
  if (type === "oosequipment")    return submitOutOfServiceEquipment_(submitter, apparatusId, payload);

  return true;
}

/******************************************************
 * ADMIN — Status dashboard
 ******************************************************/
function getAdminStatus_() {
  var weeklyConfig = getWeeklyConfig_();

  var rows = [];
  Object.keys(STATIONS).forEach(function(stId){
    var st = STATIONS[stId];
    (st.apparatus || []).forEach(function(ap){
      rows.push({
        stationId: stId,
        stationName: st.stationName,
        apparatusId: ap.apparatusId,
        checks: buildChecksStatusForUnit_(ap.apparatusId, weeklyConfig)
      });
    });
  });

  return { rows: rows, weeklyConfig: weeklyConfig };
}

function buildChecksStatusForUnit_(unit, weeklyConfig) {
  var now = new Date();
  var dailyStart = computeDailyWindowStart_(now);

  var checks = {};
  checks.apparatusDaily = statusFromSheet_(TAB_APPARATUS_DAILY, unit, dailyStart);
  checks.medicalDaily   = statusFromSheet_(TAB_MEDICAL_DAILY, unit, dailyStart);

  checks.scbaWeekly      = statusFromSheet_(TAB_SCBA_WEEKLY, unit, computeWeeklyDueStart_(now, weeklyConfig.scbaWeekly));
  checks.pumpWeekly      = statusFromSheet_(TAB_PUMP_WEEKLY, unit, computeWeeklyDueStart_(now, weeklyConfig.pumpWeekly));
  checks.aerialWeekly    = statusFromSheet_(TAB_AERIAL_WEEKLY, unit, computeWeeklyDueStart_(now, weeklyConfig.aerialWeekly));
  checks.sawWeekly       = statusFromSheet_(TAB_SAW_WEEKLY, unit, computeWeeklyDueStart_(now, weeklyConfig.sawWeekly));
  checks.batteriesWeekly = statusFromSheet_(TAB_BATTERY_WEEKLY, unit, computeWeeklyDueStart_(now, weeklyConfig.batteriesWeekly));

  return checks;
}

function computeDailyWindowStart_(now) {
  var start = new Date(now);
  start.setHours(6,40,0,0);
  if (now.getTime() < start.getTime()) start = new Date(start.getTime() - 24*60*60*1000);
  return start;
}

function computeWeeklyDueStart_(now, weekdayName) {
  var allowed = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  var targetIdx = allowed.indexOf(String(weekdayName||"").trim());
  if (targetIdx < 0) targetIdx = 6;

  var d = new Date(now);
  d.setHours(6,40,0,0);
  while (d.getDay() !== targetIdx) d = new Date(d.getTime() - 24*60*60*1000);
  return d;
}

function statusFromSheet_(tabName, unit, okIfAfterDate) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(tabName);
  if (!sh) return { ok:false, last:null };

  var lr = sh.getLastRow();
  if (lr < 2) return { ok:false, last:null };

  var tsCol = 1;
  var unitCol = 3;

  var lookback = Math.min(400, lr - 1);
  var startRow = lr - lookback + 1;
  var vals = sh.getRange(startRow, 1, lookback, Math.max(tsCol, unitCol)).getValues();

  var lastTs = null;
  for (var i = vals.length - 1; i >= 0; i--) {
    var row = vals[i];
    var u = String(row[unitCol-1]||"").trim();
    if (u !== String(unit).trim()) continue;
    var ts = row[tsCol-1];
    if (ts instanceof Date) { lastTs = ts; break; }
  }

  if (!lastTs) return { ok:false, last:null };

  var ok = okIfAfterDate ? (lastTs.getTime() >= okIfAfterDate.getTime()) : true;
  return { ok: ok, last: lastTs.toISOString() };
}

/******************************************************
 * ISSUES — ACTIVE LIST FOR CREW UI
 ******************************************************/
function getActiveIssues_(stationId, apparatusIdOrBlank) {
  ensureIssuesHasIdColumn_();
  ensureIssuesHasAckColumn_();
  stampMissingIssueIds_();
  stampMissingIssueAck_();
  autoOldIssues_();

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) return [];

  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return [];

  var header = vals[0];
  var map = issuesColMap_(header);

  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];

    var st = String(row[map["stationid"]] || row[2] || "").trim();
    var ap = String(row[map["apparatusid"]] || row[3] || "").trim();
    var issueText = String(row[map["issue text"]] || row[4] || "").trim();
    var note = String(row[map["bullet note"]] || row[5] || "").trim();
    var status = normalizeStatus_(row[map["status"]] != null ? row[map["status"]] : row[6]);

    if (status === "CLEARED") continue;
    if (status === "RESOLVED") continue;

    if (stationId && st !== String(stationId)) continue;
    if (apparatusIdOrBlank && apparatusIdOrBlank !== "" && ap !== String(apparatusIdOrBlank)) continue;

    out.push({
      stationId: st,
      apparatusId: ap,
      issueText: issueText,
      note: note,
      status: normalizeNewModelStatus_(status)
    });
  }
  return out;
}

/******************************************************
 * Create a new issue (station-scoped email)
 ******************************************************/
function handleNewIssue_(stationId, apparatusId, submitter, newIssueText, newIssueNote) {
  var text = (newIssueText || "").trim();
  var note = (newIssueNote || "").trim();
  if (!text) return { created: false, emailed: false, reason: "empty" };

  ensureIssuesHasIdColumn_();
  ensureIssuesHasAckColumn_();

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) throw new Error("Missing Issues sheet");

  var data = sh.getDataRange().getValues();
  var header = data[0];
  var map = issuesColMap_(header);

  var textLower = text.toLowerCase();

  for (var i = data.length - 1; i >= 1; i--) {
    var row = data[i];
    var st = String(row[map["stationid"]] || row[2] || "").trim();
    var ap = String(row[map["apparatusid"]] || row[3] || "").trim();
    var existingText = String(row[map["issue text"]] || row[4] || "").trim();
    var status = normalizeStatus_(row[map["status"]] != null ? row[map["status"]] : row[6]);

    if (
      st === String(stationId) &&
      ap === String(apparatusId) &&
      existingText.toLowerCase() === textLower &&
      status !== "CLEARED" &&
      status !== "RESOLVED"
    ) {
      return { created: false, emailed: false, reason: "duplicate-not-closed" };
    }
  }

  var now = new Date();
  sh.appendRow([now, now, stationId, apparatusId, text, note, "NEW", submitter, "", "", false, ""]);
  stampMissingIssueIds_();
  stampMissingIssueAck_();

  var emailed = sendIssueEmail_(stationId, apparatusId, submitter, text, note);
  return { created: true, emailed: emailed, reason: "new" };
}

function sendIssueEmail_(stationId, apparatusId, submitter, issueText, note) {
  var emailCfg = getEmailConfigByStation_();
  var recipients = (emailCfg.issuesByStation && emailCfg.issuesByStation[String(stationId)]) ? emailCfg.issuesByStation[String(stationId)] : [];
  recipients = recipients || [];
  if (!recipients.length) return false;

  var stName = (STATIONS[stationId] && STATIONS[stationId].stationName)
    ? STATIONS[stationId].stationName
    : ("Station " + stationId);

  var tz = Session.getScriptTimeZone() || "America/Chicago";
  var now = new Date();

  var subject = "DFD Issue — " + stName + " — " + apparatusId +
    " (" + Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm") + ")";

  var body =
    "A NEW issue was entered.\n\n" +
    "Station: " + stName + " (ID " + stationId + ")\n" +
    "Apparatus: " + apparatusId + "\n" +
    "Entered by: " + submitter + "\n" +
    "Time: " + Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm") + "\n\n" +
    "Issue:\n" + issueText + "\n\n" +
    (note ? ("Bullet note:\n" + note + "\n\n") : "") +
    "— Sent by DFD Checks (alpha)";

  MailApp.sendEmail(recipients.join(","), subject, body);
  return true;
}

/******************************************************
 * MED EXPIRATION EMAILS (Tiered + Station-scoped)
 ******************************************************/
function initMedEmailAlerts_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_MED_EMAIL_ALERTS);
  if (!sh) return;

  var hasHeader = sh.getLastRow() >= 1 && sh.getRange(1,1).getValue();
  if (hasHeader) return;

  sh.clear();
  sh.getRange(1,1,1,8).setValues([[
    "Timestamp","StationId","StationName","Unit","Submitter","Tier","Items JSON","Note"
  ]]);
  sh.getRange(1,1,1,8).setFontWeight("bold");
  sh.autoResizeColumns(1,8);
}

function getMedEmailSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_MED_EMAIL_ALERTS);
  if (!sh) {
    sh = ss.insertSheet(TAB_MED_EMAIL_ALERTS);
    initMedEmailAlerts_();
  }
  return sh;
}

function getMedAlertStatus_(payload) {
  // unchanged legacy behavior (still works)
  var station = String(payload && payload.station || "").trim();
  var unit = String(payload && payload.unit || "").trim();
  if (!station || !unit) return { hasRecent:false };

  var sh = getMedEmailSheet_();
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return { hasRecent:false };

  var tz = Session.getScriptTimeZone() || "America/Chicago";
  var now = new Date();
  var cutoff = new Date(now.getTime() - (21 * 24 * 60 * 60 * 1000));

  for (var r = vals.length - 1; r >= 1; r--) {
    var row = vals[r];
    var ts = row[0];
    var un = String(row[3] || "").trim();
    var submitter = String(row[4] || "").trim();

    if (un !== unit) continue;
    if (!(ts instanceof Date)) continue;

    if (ts.getTime() >= cutoff.getTime()) {
      return {
        hasRecent: true,
        lastDateStr: Utilities.formatDate(ts, tz, "yyyy-MM-dd HH:mm"),
        lastSubmitter: submitter || ""
      };
    }
    return { hasRecent:false };
  }

  return { hasRecent:false };
}

function notifyExpiringMeds_(payload) {
  payload = payload || {};

  // New preferred inputs
  var stationId = String(payload.stationId || "").trim();
  var stationName = String(payload.stationName || "").trim();

  // Backward compatibility: payload.station may be "Station 1"
  if (!stationId) {
    var st = String(payload.station || "").trim();
    stationId = stationNameToId_(st) || "";
    stationName = st || stationName;
  }

  var unit = String(payload.unit || "").trim();
  var submitter = String(payload.submitter || "").trim();
  var items = payload.items || [];

  if (!stationId) return { sent:false, reason:"missing-stationId" };
  if (!unit) return { sent:false, reason:"missing-unit" };
  if (!items || !items.length) return { sent:false, reason:"no-items" };

  if (!stationName) stationName = (STATIONS[stationId] && STATIONS[stationId].stationName) ? STATIONS[stationId].stationName : ("Station " + stationId);

  // Compute days until per item
  var today = todayUtc_();
  var normalized = [];
  for (var i=0;i<items.length;i++){
    var it = items[i] || {};
    var name = String(it.name || "").trim();
    var exp = String(it.exp || "").trim(); // yyyy-MM-dd
    if (!name || !exp) continue;

    var d = daysUntilYmd_(exp, today);
    normalized.push({
      name: name,
      exp: exp,
      days: d,
      replaceCount: (it.replaceCount != null) ? it.replaceCount : ""
    });
  }
  if (!normalized.length) return { sent:false, reason:"no-valid-items" };

  // Partition tiers
  var all45 = normalized.filter(function(x){ return x.days != null && x.days < DRUG_THRESHOLDS.ALL_DAYS; });
  var primary30 = normalized.filter(function(x){ return x.days != null && x.days < DRUG_THRESHOLDS.PRIMARY_30; });
  var primary14 = normalized.filter(function(x){ return x.days != null && x.days < DRUG_THRESHOLDS.PRIMARY_14; });

  var emailCfg = getEmailConfigByStation_();
  var toAll = (emailCfg.drugsAllByStation && emailCfg.drugsAllByStation[stationId]) ? emailCfg.drugsAllByStation[stationId] : [];
  var toPrimary = (emailCfg.drugsPrimaryByStation && emailCfg.drugsPrimaryByStation[stationId]) ? emailCfg.drugsPrimaryByStation[stationId] : [];

  var sent = { all45:false, primary30:false, primary14:false };

  // All list digest <=45
  if (toAll.length && all45.length) {
    if (shouldSendDrugTier_(stationId, unit, "ALL_45", all45)) {
      sendDrugEmailHtml_(toAll, stationName, stationId, unit, submitter, "Drugs expiring within 45 days", all45, "ALL_45");
      logDrugTier_(stationId, stationName, unit, submitter, "ALL_45", all45);
      sent.all45 = true;
    }
  }

  // Primary <=30
  if (toPrimary.length && primary30.length) {
    if (shouldSendDrugTier_(stationId, unit, "PRIMARY_30", primary30)) {
      sendDrugEmailHtml_(toPrimary, stationName, stationId, unit, submitter, "PRIMARY: Drugs expiring within 30 days", primary30, "PRIMARY_30");
      logDrugTier_(stationId, stationName, unit, submitter, "PRIMARY_30", primary30);
      sent.primary30 = true;
    }
  }

  // Primary <=14 escalation (includes past due)
  if (toPrimary.length && primary14.length) {
    if (shouldSendDrugTier_(stationId, unit, "PRIMARY_14", primary14)) {
      sendDrugEmailHtml_(toPrimary, stationName, stationId, unit, submitter, "URGENT: Drugs expiring within 14 days / past due", primary14, "PRIMARY_14");
      logDrugTier_(stationId, stationName, unit, submitter, "PRIMARY_14", primary14);
      sent.primary14 = true;
    }
  }

  return { sent:true, reason:"processed", details: sent };
}

function sendDrugEmailHtml_(recipients, stationName, stationId, unit, submitter, title, items, tier) {
  var tz = Session.getScriptTimeZone() || "America/Chicago";
  var now = new Date();

  var subject = "DFD " + stationName + " — " + title + " (" + Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm") + ")";

  var rowsHtml = items.map(function(it){
    var daysLabel = (it.days == null) ? "" : (it.days < 0 ? ("Past due " + Math.abs(it.days) + "d") : (it.days + "d"));
    return "<tr>" +
      "<td style='padding:8px;border:1px solid #ddd'>" + htmlEscape_(it.name || "") + "</td>" +
      "<td style='padding:8px;border:1px solid #ddd'>" + htmlEscape_(it.exp || "") + "</td>" +
      "<td style='padding:8px;border:1px solid #ddd;text-align:center'>" + htmlEscape_(String(daysLabel)) + "</td>" +
      "<td style='padding:8px;border:1px solid #ddd;text-align:center'>" + htmlEscape_(String(it.replaceCount != null ? it.replaceCount : "")) + "</td>" +
    "</tr>";
  }).join("");

  var meta = "<p>" +
    "<b>Station:</b> " + htmlEscape_(stationName) + " (ID " + htmlEscape_(stationId) + ")<br>" +
    "<b>Unit:</b> " + htmlEscape_(unit) + "<br>" +
    (submitter ? "<b>Reported by:</b> " + htmlEscape_(submitter) + "<br>" : "") +
    "<b>Tier:</b> " + htmlEscape_(tier) + "<br>" +
    "<b>Date:</b> " + htmlEscape_(Utilities.formatDate(now, tz, "yyyy-MM-dd HH:mm")) +
  "</p>";

  var htmlBody =
    "<p><b>" + htmlEscape_(title) + "</b></p>" +
    meta +
    "<table style='border-collapse:collapse;width:100%'>" +
      "<tr>" +
        "<th style='padding:8px;border:1px solid #ddd;background:#f6f6f6;text-align:left'>Medication</th>" +
        "<th style='padding:8px;border:1px solid #ddd;background:#f6f6f6;text-align:left'>Expires</th>" +
        "<th style='padding:8px;border:1px solid #ddd;background:#f6f6f6;text-align:left'>Days</th>" +
        "<th style='padding:8px;border:1px solid #ddd;background:#f6f6f6;text-align:left'>Replacement requested</th>" +
      "</tr>" +
      rowsHtml +
    "</table>" +
    "<p>Please ensure replacements are ordered/received and advise the officer if anything is past due.</p>";

  MailApp.sendEmail({
    to: recipients.join(","),
    subject: subject,
    htmlBody: htmlBody
  });
}

// Simple "don’t spam" key: stationId|unit|tier|hash(items)
function shouldSendDrugTier_(stationId, unit, tier, items) {
  var sh = getMedEmailSheet_();
  var vals = sh.getDataRange().getValues();
  if (vals.length < 2) return true;

  var key = drugTierKey_(stationId, unit, tier, items);
  var cutoff = new Date(Date.now() - (12 * 60 * 60 * 1000)); // 12 hours

  // Search backwards for recent identical send
  for (var r=vals.length-1; r>=1; r--) {
    var ts = vals[r][0];
    var sid = String(vals[r][1]||"").trim();
    var un = String(vals[r][3]||"").trim();
    var t = String(vals[r][5]||"").trim();
    var note = String(vals[r][7]||"").trim(); // store key in note
    if (sid !== stationId || un !== unit || t !== tier) continue;
    if (!(ts instanceof Date)) continue;
    if (ts.getTime() < cutoff.getTime()) break;
    if (note === key) return false;
  }
  return true;
}

function logDrugTier_(stationId, stationName, unit, submitter, tier, items) {
  var sh = getMedEmailSheet_();
  var now = new Date();
  var key = drugTierKey_(stationId, unit, tier, items);
  sh.appendRow([now, stationId, stationName, unit, submitter, tier, JSON.stringify(items), key]);
}

function drugTierKey_(stationId, unit, tier, items) {
  var s = JSON.stringify(items.map(function(x){ return [x.name,x.exp,x.days].join("|"); }).sort());
  var digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s)).slice(0,16);
  return [stationId, unit, tier, digest].join("|");
}

function todayUtc_() {
  var now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function daysUntilYmd_(ymd, todayUtc) {
  // ymd = yyyy-MM-dd
  var m = String(ymd||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  var exp = new Date(Date.UTC(y, mo, d));
  var diffMs = exp.getTime() - todayUtc.getTime();
  return Math.floor(diffMs / 86400000);
}

function stationNameToId_(name) {
  name = String(name||"").trim().toLowerCase();
  if (!name) return "";
  var m = name.match(/station\s*(\d+)/i);
  if (m) return String(m[1]);
  // fallback
  for (var sid in STATIONS) {
    if (String(STATIONS[sid].stationName||"").toLowerCase() === name) return sid;
  }
  return "";
}

/******************************************************
 * DRUGMASTER
 ******************************************************/
function getDrugMaster_(unit) {
  var sheetName = (CONFIG.drugSheets && CONFIG.drugSheets[unit]) || null;
  if (!sheetName) return [];
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return [];

  var vals = sh.getDataRange().getValues();
  var out = [];
  for (var r=1;r<vals.length;r++){
    var name = String(vals[r][0]||"").trim();
    var exp = String(vals[r][1]||"").trim();
    if (!name) continue;
    out.push({ name:name, exp:exp });
  }
  return out;
}

/******************************************************
 * ISSUES — ADMIN LIST + UPDATE (existing)
 ******************************************************/
function issuesColMap_(headerRow) {
  var map = {};
  for (var c = 0; c < headerRow.length; c++) {
    var key = String(headerRow[c] || "").trim().toLowerCase();
    if (key) map[key] = c;
  }
  return map;
}

function ensureIssuesHasIdColumn_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) throw new Error("Missing Issues sheet");

  var lastCol = sh.getLastColumn() || 1;
  var header = sh.getRange(1,1,1,lastCol).getValues()[0];
  var map = issuesColMap_(header);

  if (map["issueid"] == null) {
    sh.insertColumnAfter(lastCol);
    var newLast = sh.getLastColumn();
    sh.getRange(1, newLast).setValue("IssueId").setFontWeight("bold");
  }
}

function ensureIssuesHasAckColumn_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) throw new Error("Missing Issues sheet");

  var lastCol = sh.getLastColumn() || 1;
  var header = sh.getRange(1,1,1,lastCol).getValues()[0];
  var map = issuesColMap_(header);

  if (map["acknowledged"] == null) {
    if (map["issueid"] != null) {
      sh.insertColumnBefore(map["issueid"] + 1);
      sh.getRange(1, map["issueid"] + 1).setValue("Acknowledged").setFontWeight("bold");
    } else {
      sh.insertColumnAfter(lastCol);
      sh.getRange(1, lastCol + 1).setValue("Acknowledged").setFontWeight("bold");
    }
  }
}

function stampMissingIssueAck_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var header = data[0];
  var map = issuesColMap_(header);
  var ackCol = map["acknowledged"];
  if (ackCol == null) return;

  for (var r = 1; r < data.length; r++) {
    var v = data[r][ackCol];
    if (v === "" || v == null) {
      sh.getRange(r+1, ackCol+1).setValue(false);
    }
  }
}

function normalizeStatus_(s) {
  var v = String(s || "").trim();
  if (!v) return "NEW";
  if (v.toLowerCase() === "active") return "NEW";
  return v.toUpperCase();
}

function normalizeNewModelStatus_(s) {
  var v = normalizeStatus_(s);
  if (v === "OLD") return "OLD";
  if (v === "RESOLVED") return "RESOLVED";
  if (v === "CLEARED") return "RESOLVED";
  return "NEW";
}

function makeIssueId_(createdTs, stationId, apparatusId, rowNum) {
  var t = (createdTs instanceof Date) ? createdTs.getTime() : new Date(createdTs || Date.now()).getTime();
  return [t, stationId, apparatusId, rowNum].join("-");
}

function stampMissingIssueIds_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var header = data[0];
  var map = issuesColMap_(header);
  var idCol = map["issueid"];
  if (idCol == null) return;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var existing = String(row[idCol] || "").trim();
    if (existing) continue;

    var createdAt = row[map["created timestamp"]] || row[0];
    var st = String(row[map["stationid"]] || row[2] || "").trim() || "1";
    var ap = String(row[map["apparatusid"]] || row[3] || "").trim();
    var issueId = makeIssueId_(createdAt, st, ap, r + 1);
    sh.getRange(r + 1, idCol + 1).setValue(issueId);
  }
}

function autoOldIssues_() {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  if (data.length < 2) return;

  var header = data[0];
  var map = issuesColMap_(header);
  var statusCol = map["status"];
  var createdCol = map["created timestamp"];
  var updatedCol = map["updated timestamp"];
  if (statusCol == null || createdCol == null || updatedCol == null) return;

  var now = new Date();
  var cutoffMs = 96 * 60 * 60 * 1000;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var status = normalizeNewModelStatus_(row[statusCol]);
    if (status === "RESOLVED") continue;

    var created = row[createdCol];
    if (!(created instanceof Date)) continue;

    var age = now.getTime() - created.getTime();
    if (age >= cutoffMs && status === "NEW") {
      sh.getRange(r+1, statusCol+1).setValue("OLD");
      sh.getRange(r+1, updatedCol+1).setValue(now);
    }
  }
}

function listIssues_(stationId, apparatusIdOrBlank, includeCleared) {
  ensureIssuesHasIdColumn_();
  ensureIssuesHasAckColumn_();
  stampMissingIssueIds_();
  stampMissingIssueAck_();
  autoOldIssues_();

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return [];

  var header = data[0];
  var map = issuesColMap_(header);

  var idCol = map["issueid"];
  var ackCol = map["acknowledged"];

  var out = [];
  for (var r = 1; r < data.length; r++) {
    var row = data[r];

    var createdAt = row[map["created timestamp"]] || row[0];
    var updatedAt = row[map["updated timestamp"]] || row[1];
    var st        = String(row[map["stationid"]] || row[2] || "").trim();
    var ap        = String(row[map["apparatusid"]] || row[3] || "").trim();
    var issueText = String(row[map["issue text"]] || row[4] || "").trim();
    var note      = String(row[map["bullet note"]] || row[5] || "").trim();
    var statusRaw = (map["status"] != null) ? row[map["status"]] : row[6];
    var status    = normalizeNewModelStatus_(statusRaw);

    if (!includeCleared && normalizeStatus_(statusRaw) === "CLEARED") continue;
    if (stationId && st && st !== String(stationId)) continue;
    if (apparatusIdOrBlank && apparatusIdOrBlank !== "" && ap !== String(apparatusIdOrBlank)) continue;

    var createdBy = String(row[map["created by"]] || row[7] || "").trim();
    var resolvedBy= String(row[map["resolved by"]] || row[9] || "").trim();
    var issueId = String(row[idCol] || "").trim();
    var acknowledged = (ackCol != null) ? (row[ackCol] === true || String(row[ackCol]).toUpperCase() === "TRUE") : false;

    out.push({
      issueId: issueId,
      stationId: st,
      apparatusId: ap,
      issueText: issueText,
      bulletNote: note,
      status: status,
      acknowledged: acknowledged,
      createdAt: (createdAt instanceof Date) ? createdAt.toISOString() : String(createdAt || ""),
      lastUpdatedAt: (updatedAt instanceof Date) ? updatedAt.toISOString() : String(updatedAt || ""),
      lastUpdatedBy: resolvedBy || createdBy || ""
    });
  }

  out.sort(function(a,b){
    return new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime();
  });

  return out;
}

function updateIssue_(issueId, changes, user) {
  ensureIssuesHasIdColumn_();
  ensureIssuesHasAckColumn_();

  changes = changes || {};
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(TAB_ISSUES);
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return false;

  var header = data[0];
  var map = issuesColMap_(header);

  var idCol = map["issueid"];
  var statusCol = map["status"];
  var updatedCol = map["updated timestamp"];
  var resolvedTsCol = map["resolved timestamp"];
  var resolvedByCol = map["resolved by"];
  var ackCol = map["acknowledged"];

  if (idCol == null || statusCol == null || updatedCol == null) {
    throw new Error("Issues sheet missing IssueId/Status/Updated Timestamp.");
  }
  if (ackCol == null) throw new Error("Issues sheet missing Acknowledged column.");

  var now = new Date();

  var newStatus = (changes.status != null) ? normalizeNewModelStatus_(changes.status) : null;
  var newAck = (changes.acknowledged != null) ? !!changes.acknowledged : null;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var rowId = String(row[idCol] || "").trim();
    if (rowId !== issueId) continue;

    if (newAck !== null) sh.getRange(r+1, ackCol+1).setValue(newAck);

    if (newStatus !== null) {
      sh.getRange(r+1, statusCol+1).setValue(newStatus);

      if (newStatus === "RESOLVED") {
        if (resolvedTsCol != null) sh.getRange(r+1, resolvedTsCol+1).setValue(now);
        if (resolvedByCol != null) sh.getRange(r+1, resolvedByCol+1).setValue(user);
      } else {
        if (resolvedTsCol != null) sh.getRange(r+1, resolvedTsCol+1).setValue("");
        if (resolvedByCol != null) sh.getRange(r+1, resolvedByCol+1).setValue(user);
      }
    } else {
      if (resolvedByCol != null) sh.getRange(r+1, resolvedByCol+1).setValue(user);
    }

    sh.getRange(r+1, updatedCol+1).setValue(now);
    return true;
  }

  return false;
}

/******************************************************
 * SUBMIT HELPERS
 ******************************************************/
function safeItem_(obj) {
  return {
    passFail: (obj && obj.passFail) ? obj.passFail : "Pass",
    notes: (obj && obj.notes) ? obj.notes : ""
  };
}

function submitApparatusDaily_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_APPARATUS_DAILY);
  if (!sh) throw new Error("Missing sheet: " + TAB_APPARATUS_DAILY);
  var now = new Date();

  var knox           = safeItem_(payload.knox);
  var radios         = safeItem_(payload.radios);
  var lights         = safeItem_(payload.lights);
  var scba           = safeItem_(payload.scba);
  var spareBottles   = safeItem_(payload.spareBottles);
  var rit            = safeItem_(payload.rit);
  var flashlights    = safeItem_(payload.flashlights);
  var tic            = safeItem_(payload.tic);
  var gasMonitor     = safeItem_(payload.gasMonitor);
  var handTools      = safeItem_(payload.handTools);
  var hydraRam       = safeItem_(payload.hydraRam);
  var groundLadders  = safeItem_(payload.groundLadders);
  var passports      = safeItem_(payload.passports);

  sh.appendRow([
    now, submitter, unit,
    Number(payload.mileage || 0),
    Number(payload.engineHours || 0),
    Number(payload.fuel || 0),
    Number(payload.def || 0),
    Number(payload.tank || 0),

    knox.passFail,           knox.notes,
    radios.passFail,         radios.notes,
    lights.passFail,         lights.notes,
    scba.passFail,           scba.notes,
    spareBottles.passFail,   spareBottles.notes,
    rit.passFail,            rit.notes,
    flashlights.passFail,    flashlights.notes,
    tic.passFail,            tic.notes,
    gasMonitor.passFail,     gasMonitor.notes,
    handTools.passFail,      handTools.notes,
    hydraRam.passFail,       hydraRam.notes,
    groundLadders.passFail,  groundLadders.notes,
    passports.passFail,      passports.notes
  ]);
}

function submitMedicalDaily_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_MEDICAL_DAILY);
  if (!sh) throw new Error("Missing sheet: " + TAB_MEDICAL_DAILY);
  var now = new Date();

  var drugs = payload.drugs || [];
  sh.appendRow([
    now,
    submitter,
    unit,
    Number(payload.o2 || 0),
    payload.airwayPassFail || "Pass",
    payload.airwayNotes || "",
    JSON.stringify(drugs)
  ]);

  updateDrugMaster_(unit, drugs);
}

function submitScbaWeekly_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_SCBA_WEEKLY);
  if (!sh) throw new Error("Missing sheet: " + TAB_SCBA_WEEKLY);
  var now = new Date();

  (payload.entries || []).forEach(function(ent) {
    sh.appendRow([
      now, submitter, unit,
      ent.label || "",
      Number(ent.psi || 0),
      ent.passFail || "Pass",
      ent.notes || ""
    ]);
  });
}

function submitPumpWeekly_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_PUMP_WEEKLY);
  if (!sh) throw new Error("Missing sheet: " + TAB_PUMP_WEEKLY);
  var now = new Date();

  sh.appendRow([
    now, submitter, unit,
    payload.pumpShift || "Pass",
    payload.throttle || "Pass",
    payload.relief || "Pass",
    payload.gauges || "Pass",
    payload.overall || "Pass",
    payload.notes || ""
  ]);
}

function submitAerialWeekly_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_AERIAL_WEEKLY);
  if (!sh) throw new Error("Missing sheet: " + TAB_AERIAL_WEEKLY);
  var now = new Date();

  sh.appendRow([
    now, submitter, unit,
    payload.masterSwitch || "Pass",
    payload.modeSwitch || "Pass",
    payload.outriggers || "Pass",
    payload.outriggersLube || "Pass",
    payload.lRaise || "Pass",
    payload.lRotate || "Pass",
    payload.lExtend || "Pass",
    payload.lRetract || "Pass",
    payload.lLower || "Pass",
    payload.nRaise || "Pass",
    payload.nLower || "Pass",
    payload.nRight || "Pass",
    payload.nLeft || "Pass",
    payload.nFog || "Pass",
    payload.nStraight || "Pass",
    payload.lights || "Pass",
    payload.overall || "Pass",
    payload.notes || ""
  ]);
}

function submitSawWeekly_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_SAW_WEEKLY);
  if (!sh) throw new Error("Missing sheet: " + TAB_SAW_WEEKLY);
  var now = new Date();

  (payload.entries || []).forEach(function(ent) {
    if (!ent || !ent.number) return;
    sh.appendRow([
      now, submitter, unit,
      ent.type || "",
      Number(ent.number || 0),
      Number(ent.fuel || 0),
      Number(ent.barOil || 0),
      ent.runs || "Yes",
      ent.notes || ""
    ]);
  });
}

function submitBatteriesWeekly_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_BATTERY_WEEKLY);
  if (!sh) throw new Error("Missing sheet: " + TAB_BATTERY_WEEKLY);
  var now = new Date();

  sh.appendRow([
    now, submitter, unit,
    payload.batteryTools || "",
    payload.gasMonitorCharged || "",
    payload.unitPhoneCharged || "",
    payload.notes || "",
    payload.extricationCheck || "",
    payload.spreader || "",
    payload.cutter || "",
    payload.ram || "",
    payload.allCharged || "",
    payload.damage || ""
  ]);
}

function submitOutOfServiceUnit_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_OOS_UNITS);
  if (!sh) throw new Error("Missing sheet: " + TAB_OOS_UNITS);
  var now = new Date();

  sh.appendRow([
    now, submitter, unit,
    payload.reason || "",
    payload.replacementReserve || "",
    payload.equipmentMoved || "",
    payload.rtsDate || ""
  ]);
}

function submitOutOfServiceEquipment_(submitter, unit, payload) {
  var sh = SpreadsheetApp.getActive().getSheetByName(TAB_OOS_EQUIP);
  if (!sh) throw new Error("Missing sheet: " + TAB_OOS_EQUIP);
  var now = new Date();

  sh.appendRow([
    now, submitter, unit,
    payload.type || "",
    payload.identifier || "",
    payload.reason || "",
    payload.replacement || "",
    payload.rtsDate || ""
  ]);
}

/******************************************************
 * DRUGMASTER UPDATE
 ******************************************************/
function updateDrugMaster_(unit, drugs) {
  var sheetName = (CONFIG.drugSheets && CONFIG.drugSheets[unit]) || null;
  if (!sheetName) return;

  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(sheetName);
  if (!sh) return;

  var data = sh.getDataRange().getValues();
  var idx = {};
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    if (name) idx[name] = i + 1;
  }

  (drugs || []).forEach(function(dr) {
    if (!dr || !dr.name || !dr.exp) return;
    if (idx[dr.name]) {
      sh.getRange(idx[dr.name], 2).setValue(dr.exp);
    } else {
      var newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, 1, 1, 2).setValues([[dr.name, dr.exp]]);
      idx[dr.name] = newRow;
    }
  });
}

function htmlEscape_(s){
  s = String(s || "");
  return s
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}

/******************************************************
 * OPTIONAL MENU
 ******************************************************/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("DFD Checks (PWA)")
    .addItem("Setup / Create Tabs", "ensureSheets_")
    .addToUi();
}

/******************************************************
 * SEARCH / PRINT — read sheets and return normalized rows
 ******************************************************/
function parseYmd_(s) {
  var m = String(s || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
  var dt = new Date(Date.UTC(y, mo, d, 0, 0, 0));
  return isNaN(dt.getTime()) ? null : dt;
}

function withinRange_(ts, fromYmd, toYmd) {
  if (!(ts instanceof Date)) return false;
  var t = ts.getTime();

  var from = parseYmd_(fromYmd);
  var to = parseYmd_(toYmd);

  if (from) {
    // from inclusive
    if (t < from.getTime()) return false;
  }
  if (to) {
    // to inclusive end-of-day UTC
    var toEnd = new Date(to.getTime() + (24 * 60 * 60 * 1000) - 1);
    if (t > toEnd.getTime()) return false;
  }
  return true;
}

function matchesQ_(haystack, q) {
  q = String(q || "").trim().toLowerCase();
  if (!q) return true;
  return String(haystack || "").toLowerCase().indexOf(q) !== -1;
}

function stationMatches_(stationIdFilter, stationIdValue) {
  var f = String(stationIdFilter || "all").trim().toLowerCase();
  if (f === "all" || f === "") return true;
  return String(stationIdValue || "").trim() === String(stationIdFilter).trim();
}

function apparatusMatches_(apparatusIdFilter, apparatusIdValue) {
  var f = String(apparatusIdFilter || "all").trim().toLowerCase();
  if (f === "all" || f === "") return true;
  return String(apparatusIdValue || "").trim() === String(apparatusIdFilter).trim();
}

function getStationForApparatus_(apparatusId) {
  apparatusId = String(apparatusId || "").trim();
  for (var stId in STATIONS) {
    var aps = (STATIONS[stId].apparatus || []);
    for (var i = 0; i < aps.length; i++) {
      if (String(aps[i].apparatusId || "").trim() === apparatusId) return stId;
    }
  }
  return "";
}

function searchRecords_(p) {
  p = p || {};
  var categoryRaw = String(p.category || "").trim();
  var stationIdF = String(p.stationId || "all").trim();
  var apparatusIdF = String(p.apparatusId || "all").trim();
  var q = String(p.q || "").trim();
  var from = String(p.from || "").trim();
  var to = String(p.to || "").trim();
  var limit = Math.max(1, Math.min(Number(p.limit || 200), 1000));

  var categories = [];
  if (!categoryRaw || categoryRaw.toLowerCase() === "all") {
    categories = getAllSearchCategories_();
  } else {
    categories = [categoryRaw];
  }

  // Pull more per-category so the final merge can still reach `limit`
  var perCatLimit = Math.max(50, Math.min(500, Math.ceil(limit / Math.max(1, categories.length)) * 3));

  var all = [];
  for (var i = 0; i < categories.length; i++) {
    var cat = categories[i];
    var spec = getSearchSpec_(cat);
    if (!spec) continue;

    var ss = SpreadsheetApp.getActive();
    var sh = ss.getSheetByName(spec.tab);
    if (!sh) continue;

    var lr = sh.getLastRow();
    if (lr < 2) continue;

    var lookback = Math.min(spec.maxRows || 2500, lr - 1);
    var startRow = lr - lookback + 1;

    // ✅ Read full row so knox/radios/etc are searchable too
    var width = sh.getLastColumn() || 1;
    var vals = sh.getRange(startRow, 1, lookback, width).getValues();

    var qLower = String(q || "").trim().toLowerCase();

    var out = [];
    for (var r = vals.length - 1; r >= 0; r--) {
      var row = vals[r];

      var ts = row[spec.tsCol - 1];
      if (!(ts instanceof Date)) continue;
      if (!withinRange_(ts, from, to)) continue;

      var unit = spec.unitCol ? String(row[spec.unitCol - 1] || "").trim() : "";
      var submitter = spec.submitterCol ? String(row[spec.submitterCol - 1] || "").trim() : "";

      // Station explicit (Issues) or derived (most check sheets)
      var stationVal = "";
      if (spec.stationCol) stationVal = String(row[spec.stationCol - 1] || "").trim();
      if (!stationVal && unit) stationVal = getStationForApparatus_(unit);

      if (!stationMatches_(stationIdF, stationVal)) continue;
      if (!apparatusMatches_(apparatusIdF, unit)) continue;

      // Search whole row text
      if (qLower) {
        var rowText = row.map(function(v){
          if (v instanceof Date) return v.toISOString();
          return String(v == null ? "" : v);
        }).join(" ").toLowerCase();

        var blob = (stationVal + " " + unit + " " + submitter + " " + rowText).toLowerCase();
        if (blob.indexOf(qLower) === -1) continue;
      }

      out.push({
        timestamp: ts.toISOString(),
        stationId: stationVal || "",
        apparatusId: unit || "",
        submitter: submitter || "",
        category: cat,
        sheet: spec.tab,
        sheetRow: startRow + r,
        summary: spec.summaryFn ? spec.summaryFn(row) : ""
      });

      if (out.length >= perCatLimit) break;
    }

    all = all.concat(out);
  }

  // Sort newest-first across all categories then cap to `limit`
  all.sort(function(a,b){
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return all.slice(0, limit);
}


function getSearchSpec_(category) {
  // Column conventions in your headers:
  // Most check sheets: Col1 Timestamp, Col2 Submitter, Col3 Unit
  // Issues sheet: StationId/Unit/IssueText/Note/etc differ (but you have headers)
  category = String(category || "").trim();

  // Helper summary builders (keeps printing readable)
  function sumNotesAt_(idx) {
    return function(row){ return String(row[idx] || "").trim(); };
  }

  // Indices are 0-based inside row array in summaryFn, so be careful.
  // (We still use 1-based for tsCol/unitCol/submitterCol.)
  var map = {
    apparatusDaily: {
      tab: TAB_APPARATUS_DAILY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      // no single notes col; we’ll summarize mileage/fuel quickly
     summaryFn: function(r){
  // Columns (0-based): 0 ts, 1 submitter, 2 unit, 3 mileage, 4 engine hours, 5 fuel, 6 def, 7 tank
  return "Mileage: " + (r[3] || 0) +
         " • Engine Hours: " + (r[4] || 0) +
         " • Fuel%: " + (r[5] || 0) +
         " • DEF%: " + (r[6] || 0) +
         " • Tank%: " + (r[7] || 0);
},

      maxRows: 2500
    },
    medicalDaily: {
      tab: TAB_MEDICAL_DAILY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 6, // Airway Notes
      summaryFn: function(r){
        var o2 = r[3] || 0;
        var airway = r[4] || "";
        var notes = r[5] || "";
        return "O2: " + o2 + " • Airway: " + airway + (notes ? (" • Notes: " + notes) : "");
      },
      maxRows: 2500
    },
    scbaWeekly: {
      tab: TAB_SCBA_WEEKLY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 7,
      summaryFn: function(r){
        return "SCBA: " + (r[3] || "") + " • PSI: " + (r[4] || 0) + " • " + (r[5] || "");
      },
      maxRows: 3000
    },
    pumpWeekly: {
      tab: TAB_PUMP_WEEKLY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 9,
      summaryFn: function(r){
        return "Overall: " + (r[7] || "") + (r[8] ? (" • Notes: " + r[8]) : "");
      }
    },
    aerialWeekly: {
      tab: TAB_AERIAL_WEEKLY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 19,
      summaryFn: function(r){
        return "Overall: " + (r[17] || "") + (r[18] ? (" • Notes: " + r[18]) : "");
      }
    },
    sawWeekly: {
      tab: TAB_SAW_WEEKLY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 9,
      summaryFn: function(r){
        return "Type: " + (r[3] || "") + " • Saw#: " + (r[4] || "") + " • Runs: " + (r[7] || "");
      }
    },
    batteriesWeekly: {
      tab: TAB_BATTERY_WEEKLY,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 7,
      summaryFn: function(r){
        return "Gas Charged: " + (r[4] || "") + " • Phone: " + (r[5] || "") + (r[6] ? (" • Notes: " + r[6]) : "");
      }
    },
    oosUnit: {
      tab: TAB_OOS_UNITS,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 4, // reason
      summaryFn: function(r){
        return "Reason: " + (r[3] || "") + (r[4] ? (" • Reserve: " + r[4]) : "");
      }
    },
    oosEquipment: {
      tab: TAB_OOS_EQUIP,
      tsCol: 1, submitterCol: 2, unitCol: 3,
      notesCol: 6, // reason
      summaryFn: function(r){
        return "Type: " + (r[3] || "") + " • ID: " + (r[4] || "") + " • Reason: " + (r[5] || "");
      }
    },
    issues: {
      tab: TAB_ISSUES,
      tsCol: 1, // Created Timestamp
      submitterCol: 8, // Created By
      unitCol: 4, // ApparatusId
      stationCol: 3, // StationId
      textCol: 5, // Issue Text
      notesCol: 6, // Bullet Note
      statusCol: 7, // Status
      summaryFn: function(r){
        var text = r[4] || "";
        var note = r[5] || "";
        var status = r[6] || "";
        return String(text) + (note ? (" — " + note) : "") + " (" + status + ")";
      },
      maxRows: 4000
    },
      medAlerts: {
      tab: TAB_MED_EMAIL_ALERTS,
      tsCol: 1,
      stationCol: 2,
      unitCol: 4,
      submitterCol: 5,
      notesCol: 8,
      width: 8,
      summaryFn: function(r){
        var tier = r[5] || "";
        var items = r[6] || "";
        var note = r[7] || "";
        return "Tier: " + tier + (items ? (" • Items: " + String(items).slice(0,120)) : "") + (note ? (" • Note: " + note) : "");
      },
      maxRows: 2000
    }

  };

  return map[category] || null;
}


  // ---- END legacy Code.gs ----
  // Export only the legacy webapp entry points (and optional helpers)
  return {
    doGet: (typeof doGet === "function") ? doGet : null,
    doPost: (typeof doPost === "function") ? doPost : null,
    onOpen: (typeof onOpen === "function") ? onOpen : null
  };
})();
