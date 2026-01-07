/**************************************************
 * Delivery Tracker – app.js
 * Core: Vehicles + Mileage Logs (Supabase sync)
 **************************************************/

// ✅ Fill these in:
const SITE_URL = "https://staffybear.github.io/Delivery-Tracker/"; // e.g. https://yourname.github.io/delivery-tracker/
const SUPABASE_URL = "https://qntswiybgqijbbhpzpas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JW0SqP8JbZFsgVfpPevHrg__FeyrIgq";

// Optional: invite code gate for registration
const INVITE_CODE_REQUIRED = "1006";

// Local storage keys
const LS = { activeVehicleId: "dt_activeVehicleId_v1" };

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

const VIEWS = ["authView", "resetView", "menuView", "vehiclesView", "mileageView"];
let selectedDateStr = yyyyMmDd(new Date());

// ---------- helpers ----------
function pad2(n) { return String(n).padStart(2, "0"); }
function yyyyMmDd(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function todayStr() { return yyyyMmDd(new Date()); }

function parseDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
function addDays(dateStr, delta) {
  const dt = parseDateStr(dateStr);
  dt.setDate(dt.getDate() + delta);
  return yyyyMmDd(dt);
}

function showView(id, push = true) {
  for (const v of VIEWS) {
    const el = $(v);
    if (el) el.classList.toggle("hidden", v !== id);
  }
  if (push) history.pushState({ view: id }, "", "#" + id);
}
window.addEventListener("popstate", (e) => {
  const view = e.state?.view || (location.hash ? location.hash.replace("#", "") : "menuView");
  if (VIEWS.includes(view)) showView(view, false);
});

function setAuthMsg(msg) { const el = $("authMsg"); if (el) el.textContent = msg || ""; }
function setMileageMsg(msg) { const el = $("mileageMsg"); if (el) el.textContent = msg || ""; }
function setVehicleMsg(msg) { const el = $("vehicleMsg"); if (el) el.textContent = msg || ""; }

async function requireUser() {
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Not logged in.");
  return data.user;
}

function numberOrNull(v) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function setActiveVehicleId(id) {
  if (id) localStorage.setItem(LS.activeVehicleId, id);
  else localStorage.removeItem(LS.activeVehicleId);
}
function getActiveVehicleId() {
  return localStorage.getItem(LS.activeVehicleId) || "";
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  d.setHours(12,0,0,0); now.setHours(12,0,0,0);
  return Math.round((d - now) / 86400000);
}
function fmtDue(label, dateStr) {
  if (!dateStr) return "";
  const du = daysUntil(dateStr);
  if (du === null) return "";
  if (du < 0) return `⚠ ${label} overdue (${Math.abs(du)}d)`;
  if (du <= 7) return `⚠ ${label} due in ${du}d`;
  if (du <= 30) return `${label} due in ${du}d`;
  return "";
}

// ---------- AUTH ----------
async function doRegister() {
  try {
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    const invite = ($("inviteCode")?.value || "").trim();

    if (!email || !password) return setAuthMsg("Enter BOTH email and password.");
    if (invite !== INVITE_CODE_REQUIRED) return setAuthMsg("Invite code required for registration.");

    setAuthMsg("Registering…");
    const res = await sb.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } });
    if (res.error) throw res.error;
    setAuthMsg("Registered ✅ If email confirmation is enabled, confirm then login.");
  } catch (err) {
    setAuthMsg(err.message || String(err));
  }
}

async function doLogin() {
  try {
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    if (!email || !password) return setAuthMsg("Enter BOTH email and password.");

    setAuthMsg("Logging in…");
    const res = await sb.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error;

    setAuthMsg("");
    await loadVehiclesEverywhere();
    showView("menuView");
  } catch (err) {
    setAuthMsg(err.message || String(err));
  }
}

async function doForgotPassword() {
  try {
    const email = ($("email")?.value || "").trim();
    if (!email) return setAuthMsg("Enter your email first.");

    setAuthMsg("Sending reset email…");
    const res = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
    if (res.error) throw res.error;

    setAuthMsg("Reset email sent ✅ Check inbox/spam.");
  } catch (err) {
    setAuthMsg(err.message || String(err));
  }
}

function isRecoveryLink() { return (location.hash || "").includes("type=recovery"); }

async function setNewPassword() {
  try {
    const p1 = $("newPassword")?.value || "";
    const p2 = $("newPassword2")?.value || "";
    if (!p1 || p1.length < 6) return ($("resetMsg").textContent = "Password must be at least 6 characters.");
    if (p1 !== p2) return ($("resetMsg").textContent = "Passwords do not match.");

    $("resetMsg").textContent = "Updating password…";
    const res = await sb.auth.updateUser({ password: p1 });
    if (res.error) throw res.error;

    $("resetMsg").textContent = "Password updated ✅ Please login.";
    history.replaceState(null, "", location.pathname + location.search);
    await sb.auth.signOut();
    showView("authView");
  } catch (err) {
    $("resetMsg").textContent = err.message || String(err);
  }
}

async function doLogout() {
  await sb.auth.signOut();
  showView("authView");
}

// ---------- VEHICLES ----------
async function fetchVehicles() {
  const user = await requireUser();
  const res = await sb.from("vehicles")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (res.error) throw res.error;
  return res.data || [];
}

async function loadVehiclesEverywhere() {
  let vehicles = [];
  try { vehicles = await fetchVehicles(); }
  catch (err) { console.error(err); vehicles = []; }

  // fill both selects
  for (const sid of ["activeVehicleSelect", "mileageVehicleSelect"]) {
    const sel = $(sid);
    if (!sel) continue;
    sel.innerHTML = vehicles.length
      ? vehicles.map(v => `<option value="${v.id}">${v.registration}</option>`).join("")
      : `<option value="">No vehicles yet</option>`;
  }

  // pick active
  let active = getActiveVehicleId();
  if (!vehicles.find(v => v.id === active)) active = vehicles[0]?.id || "";
  setActiveVehicleId(active);

  if ($("activeVehicleSelect")) $("activeVehicleSelect").value = active || "";
  if ($("mileageVehicleSelect")) $("mileageVehicleSelect").value = active || "";

  // due warnings
  const dueBox = $("dueWarnings");
  if (dueBox) {
    const v = vehicles.find(x => x.id === active);
    if (!v) dueBox.textContent = "Add a vehicle to start logging mileage.";
    else {
      const msgs = [fmtDue("MOT", v.mot_due_date), fmtDue("Tax", v.tax_due_date)].filter(Boolean);
      dueBox.textContent = msgs.length ? msgs.join(" • ") : "No upcoming due dates in the next 30 days.";
    }
  }

  renderVehicleList(vehicles);
}

function clearVehicleForm() {
  $("vehicleId").value = "";
  $("registration").value = "";
  $("motDue").value = "";
  $("taxDue").value = "";
  setVehicleMsg("");
}

async function saveVehicle() {
  try {
    const user = await requireUser();
    const id = ($("vehicleId").value || "").trim();
    const registration = ($("registration").value || "").trim().toUpperCase();
    const mot_due_date = $("motDue").value || null;
    const tax_due_date = $("taxDue").value || null;

    if (!registration) return alert("Registration is required.");
    setVehicleMsg("Saving…");

    if (id) {
      const res = await sb.from("vehicles")
        .update({ registration, mot_due_date, tax_due_date })
        .eq("id", id)
        .eq("user_id", user.id);
      if (res.error) throw res.error;
    } else {
      const res = await sb.from("vehicles")
        .insert({ user_id: user.id, registration, mot_due_date, tax_due_date });
      if (res.error) throw res.error;
    }

    setVehicleMsg("Saved ✅");
    clearVehicleForm();
    await loadVehiclesEverywhere();
  } catch (err) {
    console.error(err);
    setVehicleMsg(err.message || String(err));
  }
}

function renderVehicleList(vehicles) {
  const ul = $("vehicleList");
  if (!ul) return;

  ul.innerHTML = "";
  if (!vehicles.length) { setVehicleMsg("No vehicles yet."); return; }

  for (const v of vehicles) {
    const li = document.createElement("li");
    li.innerHTML = `
      <b>${v.registration}</b>
      ${v.mot_due_date ? ` • MOT: ${v.mot_due_date}` : ""}
      ${v.tax_due_date ? ` • Tax: ${v.tax_due_date}` : ""}
      <button class="secondary miniInlineBtn" data-edit="${v.id}" type="button">Edit</button>
      <button class="secondary miniInlineBtn" data-del="${v.id}" type="button">Delete</button>
    `;
    ul.appendChild(li);
  }

  ul.querySelectorAll("[data-edit]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-edit");
      const v = vehicles.find(x => x.id === id);
      if (!v) return;
      $("vehicleId").value = v.id;
      $("registration").value = v.registration || "";
      $("motDue").value = v.mot_due_date || "";
      $("taxDue").value = v.tax_due_date || "";
      setVehicleMsg("Editing…");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  ul.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const v = vehicles.find(x => x.id === id);
      if (!v) return;

      if (!confirm(`Delete vehicle ${v.registration}?\n\nIf you have mileage logs for it, deletion may be blocked (on delete restrict).`)) return;

      try {
        const user = await requireUser();
        const res = await sb.from("vehicles").delete().eq("id", id).eq("user_id", user.id);
        if (res.error) throw res.error;

        if (getActiveVehicleId() === id) setActiveVehicleId("");
        await loadVehiclesEverywhere();
        setVehicleMsg("Deleted ✅");
      } catch (err) {
        console.error(err);
        setVehicleMsg(err.message || String(err));
      }
    });
  });
}

// ---------- MILEAGE ----------
function calcMileageTotal() {
  const s = numberOrNull($("mileageStart").value);
  const e = numberOrNull($("mileageEnd").value);
  if (s === null || e === null || e < s) { $("mileageTotal").value = ""; return null; }
  const t = Number((e - s).toFixed(1));
  $("mileageTotal").value = String(t);
  return t;
}

function setDate(newDate) {
  if (newDate > todayStr()) newDate = todayStr();
  selectedDateStr = newDate;
  syncMileageDatePicker();
  loadMileageForDate().catch(console.error);
}

function syncMileageDatePicker() {
  const p = $("mileageDatePicker");
  if (!p) return;
  p.max = todayStr();
  p.value = selectedDateStr;
  $("mileageNext").disabled = (selectedDateStr >= todayStr());
}

async function upsertMileage() {
  try {
    const user = await requireUser();
    const vehicle_id = $("mileageVehicleSelect").value;
    if (!vehicle_id) return alert("Please add/select a vehicle first.");

    const mileage_start = numberOrNull($("mileageStart").value);
    const mileage_end = numberOrNull($("mileageEnd").value);
    const mileage_total = calcMileageTotal();
    const notes = ($("mileageNotes").value || "").trim() || null;

    if (mileage_start === null || mileage_end === null) return alert("Enter valid start + end mileage.");
    if (mileage_total === null) return alert("End mileage must be >= start mileage.");

    setMileageMsg("Saving…");

    const res = await sb.from("mileage_logs").upsert([{
      user_id: user.id,
      vehicle_id,
      date: selectedDateStr,
      mileage_start,
      mileage_end,
      mileage_total,
      notes
    }], { onConflict: "user_id,vehicle_id,date" });

    if (res.error) throw res.error;

    setMileageMsg("Saved ✅");
    await loadMileageForDate();
  } catch (err) {
    console.error(err);
    setMileageMsg(err.message || String(err));
  }
}

async function deleteMileageForSelection() {
  try {
    const user = await requireUser();
    const vehicle_id = $("mileageVehicleSelect").value;
    if (!vehicle_id) return;
    if (!confirm("Delete mileage entry for this vehicle + date?")) return;

    const res = await sb.from("mileage_logs")
      .delete()
      .eq("user_id", user.id)
      .eq("vehicle_id", vehicle_id)
      .eq("date", selectedDateStr);

    if (res.error) throw res.error;

    $("mileageStart").value = "";
    $("mileageEnd").value = "";
    $("mileageTotal").value = "";
    $("mileageNotes").value = "";
    setMileageMsg("Deleted ✅");
    await loadMileageForDate();
  } catch (err) {
    console.error(err);
    setMileageMsg(err.message || String(err));
  }
}

async function loadMileageForDate() {
  const ul = $("mileageList");
  if (!ul) return;

  setMileageMsg("Loading…");
  const user = await requireUser();
  const vehicle_id = $("mileageVehicleSelect").value || "";

  const res = await sb.from("mileage_logs")
    .select("vehicle_id,date,mileage_start,mileage_end,mileage_total,notes,created_at,vehicles(registration)")
    .eq("user_id", user.id)
    .eq("date", selectedDateStr)
    .order("created_at", { ascending: false });

  if (res.error) throw res.error;
  const rows = res.data || [];

  // Fill form from selected vehicle entry if it exists
  const current = rows.find(r => r.vehicle_id === vehicle_id);
  if (current) {
    $("mileageStart").value = current.mileage_start ?? "";
    $("mileageEnd").value = current.mileage_end ?? "";
    $("mileageTotal").value = current.mileage_total ?? "";
    $("mileageNotes").value = current.notes ?? "";
  } else {
    $("mileageStart").value = "";
    $("mileageEnd").value = "";
    $("mileageTotal").value = "";
    $("mileageNotes").value = "";
  }

  ul.innerHTML = "";
  if (!rows.length) { setMileageMsg("No logs saved for this date yet."); return; }

  setMileageMsg("");
  for (const r of rows) {
    const reg = r.vehicles?.registration || "Vehicle";
    const notes = r.notes ? ` • ${r.notes}` : "";
    const li = document.createElement("li");
    li.innerHTML = `<b>${reg}</b> • ${r.mileage_start} → ${r.mileage_end} • <b>${Number(r.mileage_total).toFixed(1)} mi</b>${notes}`;
    ul.appendChild(li);
  }
}

// ---------- init ----------
(function injectMiniInlineBtnCSS() {
  const s = document.createElement("style");
  s.textContent = `.miniInlineBtn{margin-left:10px;width:auto!important;display:inline-block!important;padding:0 12px!important;height:34px!important;border-radius:999px!important;font-weight:900!important;vertical-align:middle;}`;
  document.head.appendChild(s);
})();

async function init() {
  // auth
  $("btnLogin").onclick = doLogin;
  $("btnRegister").onclick = doRegister;
  $("btnForgot").onclick = doForgotPassword;
  $("btnSetNewPassword").onclick = setNewPassword;

  // menu
  $("btnLogout").onclick = doLogout;
  $("goMileage").onclick = async () => { showView("mileageView"); await loadVehiclesEverywhere(); syncMileageDatePicker(); await loadMileageForDate(); };
  $("goVehicles").onclick = async () => { showView("vehiclesView"); await loadVehiclesEverywhere(); };
  $("btnManageVehicles").onclick = async () => { showView("vehiclesView"); await loadVehiclesEverywhere(); };

  // back buttons
  $("vehiclesBack").onclick = () => showView("menuView");
  $("mileageBack").onclick = () => showView("menuView");

  // vehicles actions
  $("btnSaveVehicle").onclick = saveVehicle;
  $("btnClearVehicle").onclick = clearVehicleForm;

  // vehicle selects
  $("activeVehicleSelect").onchange = async (e) => {
    setActiveVehicleId(e.target.value);
    await loadVehiclesEverywhere();
  };
  $("mileageVehicleSelect").onchange = async (e) => {
    setActiveVehicleId(e.target.value);
    $("activeVehicleSelect").value = e.target.value;
    await loadVehiclesEverywhere();
    await loadMileageForDate();
  };

  // mileage date bar
  $("mileagePrev").onclick = () => setDate(addDays(selectedDateStr, -1));
  $("mileageNext").onclick = () => setDate(addDays(selectedDateStr, +1));
  $("mileageDatePicker").onchange = (e) => setDate(e.target.value);

  // mileage actions
  $("mileageStart").addEventListener("input", calcMileageTotal);
  $("mileageEnd").addEventListener("input", calcMileageTotal);
  $("btnSaveMileage").onclick = upsertMileage;
  $("btnDeleteMileage").onclick = deleteMileageForSelection;

  // initial view
  if (isRecoveryLink()) {
    showView("resetView", false);
  } else {
    const s = await sb.auth.getSession();
    showView(s.data?.session ? "menuView" : "authView", false);
    if (s.data?.session) await loadVehiclesEverywhere();
  }

  selectedDateStr = todayStr();
  syncMileageDatePicker();
}

init().catch((e) => { console.error(e); alert(e.message || String(e)); });
