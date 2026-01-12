const $ = (s) => document.querySelector(s);
const WEEKDAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

function toast(msg, ms = 2200) {
  const t = $("#toast");
  const txt = $("#toastText");
  if (!t || !txt) return;
  txt.textContent = msg || "OK";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), ms);
}

async function apiGet(params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`/api?${qs.toString()}`, { method: "GET" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Bad JSON from /api: ${text.slice(0, 180)}`); }
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
  catch { throw new Error(`Bad JSON from /api: ${text.slice(0, 180)}`); }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

function setPill(id, text) {
  const el = $(id);
  if (!el) return;
  el.textContent = text || "—";
}

function normalizeEmails(text) {
  return String(text || "").split(/[
,]/g).map(x => x.trim()).filter(Boolean);
}

function joinEmails(list) {
  return (list || []).join("\n");
}

function adminName() {
  return "Configuration UI";
}

let EMAIL_CFG = null;
let META = null;

function fillWeekdays() {
  const sel = $("#weeklyDay");
  if (!sel) return;
  sel.innerHTML = WEEKDAYS.map((d, i) => `<option value="${i}">${d}</option>`).join("");
}

function stationLabel(st) {
  const id = String(st.stationId || st.id || "").trim();
  if (id === "R") return "Reserve Apparatus";
  return st.stationName || (`Station ${id}`);
}

function fillStations(stations) {
  const sel = $("#emailStation");
  if (!sel) return;
  sel.innerHTML = (stations || []).map(st => {
    const id = String(st.stationId || st.id || "").trim();
    return `<option value="${id}">${stationLabel(st)}</option>`;
  }).join("");
}

async function loadMeta() {
  const cfg = await apiGet({ action: "getConfig" });
  META = cfg.config || {};
  fillStations(META.stations || []);
}

async function loadWeekly() {
  setPill("#schedStatus", "Loading…");
  const admin = await apiGet({ action: "getAdminStatus" });
  const cfg = admin?.status?.weeklyConfig || null;
  if (!cfg) {
    setPill("#schedStatus", "No weekly config found");
    return;
  }
  const key = ($("#scheduleTarget")?.value || "pumpWeekly").trim();
  const currentName = cfg[key] || "Saturday";
  const idx = WEEKDAYS.findIndex(d => d === currentName);
  $("#weeklyDay").value = String(idx >= 0 ? idx : 6);
  setPill("#schedStatus", `Current: ${currentName}`);
}

async function saveWeekly() {
  const checkKey = ($("#scheduleTarget")?.value || "").trim();
  const dayIdx = Number($("#weeklyDay")?.value ?? 6);
  const weekday = WEEKDAYS[Number.isFinite(dayIdx) ? dayIdx : 6];
  await apiPost({ action: "setWeeklyDay", checkKey, weekday, user: adminName() });
  toast(`Saved: ${checkKey} = ${weekday}`);
  await loadWeekly();
}

async function loadEmailConfig() {
  const res = await apiGet({ action: "getEmailConfig" });
  EMAIL_CFG = res.emailConfig || {};
}

function currentEmailStation() {
  const kind = ($("#emailKind")?.value || "issues").trim();
  if (kind === "issuesMaster") return "MASTER";
  return ($("#emailStation")?.value || "1").trim() || "1";
}

function currentEmailKind() {
  const kind = ($("#emailKind")?.value || "issues").trim();
  if (kind === "issuesMaster") return "issues";
  return kind;
}

function readEmails(kind, stationId) {
  const k = String(kind || "issues").trim();
  const sid = String(stationId || "1").trim();
  if (k === "issues") return (EMAIL_CFG.issuesByStation?.[sid] || []);
  if (k === "drugsPrimary") return (EMAIL_CFG.drugsPrimaryByStation?.[sid] || []);
  if (k === "drugsAll") return (EMAIL_CFG.drugsAllByStation?.[sid] || []);
  return [];
}

async function loadEmailsUi() {
  setPill("#emailStatus", "Loading…");
  if (!EMAIL_CFG) await loadEmailConfig();

  const kind = currentEmailKind();
  const stationId = currentEmailStation();
  const list = readEmails(kind, stationId);

  $("#emailList").value = joinEmails(list);
  setPill("#emailStatus", stationId === "MASTER" ? "Viewing: MASTER issues list" : `Viewing: Station ${stationId} — ${kind}`);
}

async function saveEmailsUi() {
  if (!EMAIL_CFG) await loadEmailConfig();

  const kind = currentEmailKind();
  const stationId = currentEmailStation();
  const emails = Array.from(new Set(normalizeEmails($("#emailList").value)));

  await apiPost({ action: "setEmailConfig", kind, stationId, emails, user: adminName() });
  toast("Saved email list");
  await loadEmailConfig();
  await loadEmailsUi();
}

function wire() {
  $("#btnLoadWeekly")?.addEventListener("click", () => loadWeekly().catch(e => toast(e.message, 3200)));
  $("#btnSaveWeekly")?.addEventListener("click", () => saveWeekly().catch(e => toast(e.message, 3200)));

  $("#btnLoadEmails")?.addEventListener("click", () => loadEmailsUi().catch(e => toast(e.message, 3200)));
  $("#btnSaveEmails")?.addEventListener("click", () => saveEmailsUi().catch(e => toast(e.message, 3200)));

  $("#emailKind")?.addEventListener("change", () => loadEmailsUi().catch(e => toast(e.message, 3200)));
  $("#emailStation")?.addEventListener("change", () => loadEmailsUi().catch(e => toast(e.message, 3200)));
}

(async function init() {
  try {
    fillWeekdays();
    await loadMeta();
    await loadWeekly();
    await loadEmailConfig();
    await loadEmailsUi();
    wire();
  } catch (e) {
    toast(e.message, 4200);
  }
})();
