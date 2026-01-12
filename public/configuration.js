const $ = (s) => document.querySelector(s);

function setStatus(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg || "";
}

function normalizeEmails(text) {
  return String(text || "")
    .split(/[\n,]/g)
    .map((x) => x.trim())
    .filter(Boolean);
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
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error(`Bad JSON from /api: ${text.slice(0, 200)}`); }
  if (!json.ok) throw new Error(json.error || "Request failed");
  return json;
}

// Email group key mapping (stored in D1: email_recipients.groupKey)
function groupKeyFor(listType, stationId) {
  if (listType === "issues_master") return "issues_master";
  if (!stationId) return "";
  if (listType === "issues_station") return `issues_station_${stationId}`;
  if (listType === "drugs_station") return `drugs_station_${stationId}`;
  return "";
}

let ADMIN_STATUS = null;

async function loadAdminStatus() {
  setStatus("#schedStatus", "Loading…");
  setStatus("#emailStatus", "Loading…");
  ADMIN_STATUS = await apiGet({ action: "getAdminStatus" });

  // Weekly config (if present)
  const target = $("#scheduleTarget")?.value || "scbaWeekly";
  const weeklyConfig = ADMIN_STATUS?.status?.weeklyConfig || {};
  if (Object.prototype.hasOwnProperty.call(weeklyConfig, target)) {
    const w = String(weeklyConfig[target]);
    const idx = weekdayIndex(w);
    if (idx >= 0) $("#weeklyDay").value = String(idx);
    setStatus("#schedStatus", `Loaded: ${target} = ${w}`);
  } else {
    setStatus("#schedStatus", "Loaded.");
  }

  // Emails: render currently selected list
  await renderEmailBoxFromStatus();
}

function weekdayIndex(name) {
  const map = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const k = String(name || "").trim().toLowerCase();
  return Number.isFinite(map[k]) ? map[k] : -1;
}

function weekdayName(idx) {
  const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const i = Number(idx);
  return names[i] || "";
}

async function renderEmailBoxFromStatus() {
  const listType = $("#listType").value;
  const stationId = $("#stationPick").value;
  const key = groupKeyFor(listType, stationId);

  // Disable station picker for master list
  $("#stationPick").disabled = (listType === "issues_master");

  const emailRecipients = ADMIN_STATUS?.status?.emailRecipients || {};
  const list = Array.isArray(emailRecipients[key]) ? emailRecipients[key] : [];
  $("#emailBox").value = (list || []).join("\n");
  setStatus("#emailStatus", `Loaded ${key}: ${list.length} recipient(s)`);
}

async function saveWeeklyDay() {
  const user = String($("#adminName").value || "").trim();
  const checkKey = String($("#scheduleTarget").value || "").trim();
  const weekday = weekdayName($("#weeklyDay").value);

  if (!user) {
    alert("Please enter your name.");
    return;
  }

  setStatus("#schedStatus", "Saving…");
  await apiPost({ action: "setWeeklyDay", checkKey, weekday, user });
  setStatus("#schedStatus", `Saved: ${checkKey} = ${weekday}`);

  // refresh local cache
  await loadAdminStatus();
}

async function saveEmailList() {
  const user = String($("#adminName").value || "").trim();
  if (!user) {
    alert("Please enter your name.");
    return;
  }

  const listType = $("#listType").value;
  const stationId = $("#stationPick").value;
  const key = groupKeyFor(listType, stationId);
  if (!key) {
    alert("Invalid list selection.");
    return;
  }

  const list = normalizeEmails($("#emailBox").value);
  setStatus("#emailStatus", "Saving…");
  await apiPost({
    action: "setEmailRecipients",
    user,
    emails: { [key]: list },
  });
  setStatus("#emailStatus", `Saved ${key}: ${list.length} recipient(s)`);
  await loadAdminStatus();
}

function wire() {
  $("#saveWeekly")?.addEventListener("click", () => {
    saveWeeklyDay().catch((e) => {
      console.error(e);
      setStatus("#schedStatus", `Error: ${e.message || e}`);
      alert(e.message || String(e));
    });
  });

  $("#saveEmails")?.addEventListener("click", () => {
    saveEmailList().catch((e) => {
      console.error(e);
      setStatus("#emailStatus", `Error: ${e.message || e}`);
      alert(e.message || String(e));
    });
  });

  $("#reloadEmails")?.addEventListener("click", () => {
    loadAdminStatus().catch((e) => {
      console.error(e);
      setStatus("#emailStatus", `Error: ${e.message || e}`);
      alert(e.message || String(e));
    });
  });

  $("#listType")?.addEventListener("change", () => {
    renderEmailBoxFromStatus().catch((e) => {
      console.error(e);
      setStatus("#emailStatus", `Error: ${e.message || e}`);
    });
  });

  $("#stationPick")?.addEventListener("change", () => {
    renderEmailBoxFromStatus().catch((e) => {
      console.error(e);
      setStatus("#emailStatus", `Error: ${e.message || e}`);
    });
  });

  $("#scheduleTarget")?.addEventListener("change", () => {
    // when target changes, try to display saved day
    const weeklyConfig = ADMIN_STATUS?.status?.weeklyConfig || {};
    const target = $("#scheduleTarget").value;
    if (Object.prototype.hasOwnProperty.call(weeklyConfig, target)) {
      const idx = weekdayIndex(weeklyConfig[target]);
      if (idx >= 0) $("#weeklyDay").value = String(idx);
    }
  });
}

wire();
loadAdminStatus().catch((e) => {
  console.error(e);
  setStatus("#schedStatus", `Error: ${e.message || e}`);
  setStatus("#emailStatus", `Error: ${e.message || e}`);
  alert(e.message || String(e));
});
