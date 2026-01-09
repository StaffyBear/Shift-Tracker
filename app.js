/**************************************************
 * Working Hours Tracker – app.js
 * GitHub Pages friendly (NO import/export)
 * Supabase: Auth + Companies + Shifts (+ optional photos)
 **************************************************/

// ✅ Fill these in:
const SITE_URL = "https://staffybear.github.io/Shift-Tracker/"; // must end with /
const SUPABASE_URL = "https://qntswiybgqijbbhpzpas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JW0SqP8JbZFsgVfpPevHrg__FeyrIgq";

// Optional: invite code gate for registration
const INVITE_CODE_REQUIRED = "1006";

// Storage bucket for photos (create in Supabase Storage)
const PHOTO_BUCKET = "shift-photos";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (id) => document.getElementById(id);

const VIEWS = ["authView","resetView","menuView","companiesView","monthlyView","companyView"];
const LS = { lastCompanyId: "wht_lastCompanyId_v1" };

let monthCursor = startOfMonth(new Date());
let selectedCompanyId = null;
let selectedCompany = null;
let selectedDateStr = yyyyMmDd(new Date());

/* ---------------- helpers ---------------- */
function pad2(n){ return String(n).padStart(2,"0"); }
function yyyyMmDd(d=new Date()){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function todayStr(){ return yyyyMmDd(new Date()); }

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1, 12,0,0,0); }
function addMonths(d, delta){ const x=new Date(d); x.setMonth(x.getMonth()+delta); return startOfMonth(x); }
function monthLabel(d){ return d.toLocaleString(undefined, { month:"long", year:"numeric" }); }
function monthRange(d){
  const start = new Date(d.getFullYear(), d.getMonth(), 1, 0,0,0,0);
  const end = new Date(d.getFullYear(), d.getMonth()+1, 1, 0,0,0,0);
  return { start, end };
}
function parseDateStr(dateStr){ const [y,m,dd]=dateStr.split("-").map(Number); return new Date(y,m-1,dd,12,0,0,0); }
function addDays(dateStr, delta){ const dt=parseDateStr(dateStr); dt.setDate(dt.getDate()+delta); return yyyyMmDd(dt); }

function toLocalDateTimeInputValue(date){
  const d = new Date(date);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromLocalDateTimeInputValue(v){
  if (!v) return null;
  const [datePart, timePart] = v.split("T");
  const [y,m,dd] = datePart.split("-").map(Number);
  const [hh,mm] = timePart.split(":").map(Number);
  return new Date(y, m-1, dd, hh, mm, 0, 0);
}
function hoursBetween(start, end){
  if (!start || !end) return null;
  const ms = end - start;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / 3600000;
}
function numberOrNull(v){
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function showView(id, push=true){
  for (const v of VIEWS){
    const el = $(v);
    if (el) el.classList.toggle("hidden", v !== id);
  }
  if (push) history.pushState({ view:id }, "", "#"+id);
}
window.addEventListener("popstate", (e) => {
  const view = e.state?.view || (location.hash ? location.hash.replace("#","") : "menuView");
  if (VIEWS.includes(view)) showView(view, false);
});
function setText(id, msg){ const el=$(id); if (el) el.textContent = msg || ""; }

async function requireUser(){
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) throw new Error("Not logged in.");
  return data.user;
}

/* ---------------- auth ---------------- */
async function doRegister(){
  try{
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    const invite = ($("inviteCode")?.value || "").trim();

    if (!email || !password) return setText("authMsg","Enter BOTH email and password.");
    if (invite !== INVITE_CODE_REQUIRED) return setText("authMsg","Invite code required for registration.");

    setText("authMsg","Registering…");
    const res = await sb.auth.signUp({ email, password, options:{ emailRedirectTo: SITE_URL }});
    if (res.error) throw res.error;
    setText("authMsg","Registered ✅ If email confirmation is enabled, confirm then login.");
  }catch(err){
    setText("authMsg", err.message || String(err));
  }
}
async function doLogin(){
  try{
    const email = ($("email")?.value || "").trim();
    const password = $("password")?.value || "";
    if (!email || !password) return setText("authMsg","Enter BOTH email and password.");

    setText("authMsg","Logging in…");
    const res = await sb.auth.signInWithPassword({ email, password });
    if (res.error) throw res.error;

    setText("authMsg","");
    await bootAfterLogin();
  }catch(err){
    setText("authMsg", err.message || String(err));
  }
}
async function doForgotPassword(){
  try{
    const email = ($("email")?.value || "").trim();
    if (!email) return setText("authMsg","Enter your email first.");

    setText("authMsg","Sending reset email…");
    const res = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE_URL });
    if (res.error) throw res.error;

    setText("authMsg","Reset email sent ✅ Check inbox/spam.");
  }catch(err){
    setText("authMsg", err.message || String(err));
  }
}
function isRecoveryLink(){ return (location.hash || "").includes("type=recovery"); }
async function setNewPassword(){
  try{
    const p1 = $("newPassword")?.value || "";
    const p2 = $("newPassword2")?.value || "";
    if (!p1 || p1.length < 6) return setText("resetMsg","Password must be at least 6 characters.");
    if (p1 !== p2) return setText("resetMsg","Passwords do not match.");

    setText("resetMsg","Updating password…");
    const res = await sb.auth.updateUser({ password: p1 });
    if (res.error) throw res.error;

    setText("resetMsg","Password updated ✅ Please login.");
    history.replaceState(null, "", location.pathname + location.search);
    await sb.auth.signOut();
    showView("authView");
  }catch(err){
    setText("resetMsg", err.message || String(err));
  }
}
async function doLogout(){
  await sb.auth.signOut();
  showView("authView");
}

/* ---------------- companies ---------------- */
async function listCompanies(){
  const user = await requireUser();
  const res = await sb.from("companies")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending:true });
  if (res.error) throw res.error;
  return res.data || [];
}
function companyConfigFromForm(){
  return {
    uses_mileage: $("cfgMileage").checked,
    uses_parcels: $("cfgParcels").checked,
    uses_stops: $("cfgStops").checked,
    uses_pay: $("cfgPay").checked,
    uses_photos: $("cfgPhotos").checked
  };
}
function setCompanyForm(c){
  $("companyId").value = c?.id || "";
  $("companyName").value = c?.name || "";
  $("cfgMileage").checked = c?.uses_mileage ?? true;
  $("cfgParcels").checked = c?.uses_parcels ?? true;
  $("cfgStops").checked = c?.uses_stops ?? true;
  $("cfgPay").checked = c?.uses_pay ?? true;
  $("cfgPhotos").checked = c?.uses_photos ?? true;
}
async function saveCompany(){
  try{
    const user = await requireUser();
    const id = ($("companyId").value || "").trim();
    const name = ($("companyName").value || "").trim();
    if (!name) return setText("companyMsg","Company name is required.");

    setText("companyMsg","Saving…");
    const cfg = companyConfigFromForm();

    if (id){
      const res = await sb.from("companies")
        .update({ name, ...cfg })
        .eq("id", id).eq("user_id", user.id);
      if (res.error) throw res.error;
    }else{
      const res = await sb.from("companies")
        .insert({ user_id: user.id, name, ...cfg });
      if (res.error) throw res.error;
    }

    setCompanyForm(null);
    await refreshCompaniesUI();
    setText("companyMsg","Saved ✅");
  }catch(err){
    console.error(err);
    setText("companyMsg", err.message || String(err));
  }
}
async function deleteCompany(id){
  const user = await requireUser();
  const res = await sb.from("companies").delete().eq("id", id).eq("user_id", user.id);
  if (res.error) throw res.error;
}

async function refreshCompaniesUI(){
  const companies = await listCompanies();

  // list
  const ul = $("companyList");
  ul.innerHTML = "";
  if (!companies.length) setText("companyMsg","No companies yet. Add one above.");
  else setText("companyMsg","");

  for (const c of companies){
    const li = document.createElement("li");
    li.innerHTML = `
      <b>${escapeHtml(c.name)}</b>
      <button class="secondary miniInlineBtn" data-edit="${c.id}" type="button">Edit</button>
      <button class="secondary miniInlineBtn" data-del="${c.id}" type="button">Delete</button>
    `;
    ul.appendChild(li);
  }

  ul.querySelectorAll("[data-edit]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.getAttribute("data-edit");
      const c = companies.find(x=>x.id===id);
      if (!c) return;
      setCompanyForm(c);
      setText("companyMsg","Editing…");
      window.scrollTo({ top:0, behavior:"smooth" });
    });
  });
  ul.querySelectorAll("[data-del]").forEach(btn=>{
    btn.addEventListener("click", async ()=>{
      const id = btn.getAttribute("data-del");
      const c = companies.find(x=>x.id===id);
      if (!c) return;
      if (!confirm(`Delete company "${c.name}"?\n\nIf it has shifts, deletion may be blocked (restrict).`)) return;
      try{
        await deleteCompany(id);
        await refreshCompaniesUI();
      }catch(err){
        setText("companyMsg", err.message || String(err));
      }
    });
  });

  renderCompanyTiles(companies);

  if (!companies.length) setText("menuMsg","Add a company (e.g. Evri) to get a tile.");
  else setText("menuMsg","");
}
function renderCompanyTiles(companies){
  const grid = $("menuGrid");
  [...grid.querySelectorAll("button[data-company]")].forEach(b=>b.remove());

  for (const c of companies){
    const btn = document.createElement("button");
    btn.className = "menuTile secondary";
    btn.textContent = c.name;
    btn.setAttribute("data-company", c.id);
    btn.addEventListener("click", ()=> openCompany(c.id));
    grid.appendChild(btn);
  }
}

/* ---------------- shifts (by company + date) ---------------- */
async function fetchShift(companyId, dateStr){
  const user = await requireUser();
  const res = await sb.from("shifts")
    .select("*")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("work_date", dateStr)
    .maybeSingle();
  if (res.error && res.status !== 406) throw res.error;
  return res.data || null;
}
async function upsertShift(companyId, dateStr, payload){
  const user = await requireUser();
  const row = { user_id:user.id, company_id:companyId, work_date:dateStr, ...payload };
  const res = await sb.from("shifts").upsert([row], { onConflict:"user_id,company_id,work_date" });
  if (res.error) throw res.error;
}
async function deleteShift(companyId, dateStr){
  const user = await requireUser();
  const res = await sb.from("shifts").delete()
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .eq("work_date", dateStr);
  if (res.error) throw res.error;
}
async function listCompanyMonth(companyId, monthDate){
  const user = await requireUser();
  const { start, end } = monthRange(monthDate);
  const res = await sb.from("shifts")
    .select("work_date,start_time,end_time,total_mileage,estimated_pay")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .gte("start_time", start.toISOString())
    .lt("start_time", end.toISOString())
    .order("work_date", { ascending:false });
  if (res.error) throw res.error;
  return res.data || [];
}

/* ---------------- photos (optional) ---------------- */
async function uploadPhoto(file, path){
  if (!file) return null;
  const user = await requireUser();
  const fullPath = `${user.id}/${path}`;
  const res = await sb.storage.from(PHOTO_BUCKET).upload(fullPath, file, {
    cacheControl: "3600",
    upsert: true,
    contentType: file.type || "image/jpeg"
  });
  if (res.error) throw res.error;
  return fullPath;
}
async function signedUrl(path){
  if (!path) return null;
  const res = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, 60*60);
  if (res.error) throw res.error;
  return res.data?.signedUrl || null;
}

/* ---------------- company page UI ---------------- */
function applyCompanyConfig(c){
  $("mileageBlock").classList.toggle("hidden", !c.uses_mileage);
  $("parcelsStopsBlock").classList.toggle("hidden", !(c.uses_parcels || c.uses_stops));
  $("payBlock").classList.toggle("hidden", !c.uses_pay);
  $("photoBlock").classList.toggle("hidden", !(c.uses_mileage && c.uses_photos));
  $("parcelsWrap").classList.toggle("hidden", !c.uses_parcels);
  $("stopsWrap").classList.toggle("hidden", !c.uses_stops);
  $("mileageBadgeWrap").classList.toggle("hidden", !c.uses_mileage);
  $("payRateBadgeWrap").classList.toggle("hidden", !c.uses_pay);
}
function syncShiftDatePicker(){
  $("shiftDatePicker").max = todayStr();
  $("shiftDatePicker").value = selectedDateStr;
  $("shiftNext").disabled = (selectedDateStr >= todayStr());
}
function calcMileage(){
  const s = numberOrNull($("startMileage").value);
  const e = numberOrNull($("endMileage").value);
  if (s === null || e === null || e < s){ $("totalMileage").value=""; return null; }
  const t = Number((e - s).toFixed(1));
  $("totalMileage").value = String(t);
  return t;
}
function calcHours(){
  const st = fromLocalDateTimeInputValue($("startTime").value);
  const et = fromLocalDateTimeInputValue($("endTime").value);
  const h = hoursBetween(st, et);
  return h ? Number(h.toFixed(2)) : null;
}
function calcPayPerHour(){
  const h = calcHours();
  const pay = numberOrNull($("estimatedPay").value);
  if (h === null || pay === null || h <= 0) return null;
  return Number((pay / h).toFixed(2));
}
function refreshBadges(){
  const hours = calcHours();
  $("hoursBadge").textContent = hours === null ? "—" : String(hours);
  const mileage = calcMileage();
  $("mileageBadge").textContent = mileage === null ? "—" : String(mileage);
  const rate = calcPayPerHour();
  $("payRateBadge").textContent = rate === null ? "—" : String(rate);
  $("avgPayPerHour").value = rate === null ? "" : String(rate);
}
function clearShiftForm(){
  $("startTime").value = "";
  $("endTime").value = "";
  $("startMileage").value = "";
  $("endMileage").value = "";
  $("totalMileage").value = "";
  $("totalParcels").value = "";
  $("totalStops").value = "";
  $("estimatedPay").value = "";
  $("avgPayPerHour").value = "";
  $("notes").value = "";
  $("startMileagePhoto").value = "";
  $("endMileagePhoto").value = "";
  $("startPhotoThumb").classList.add("hidden"); $("startPhotoThumb").src = "";
  $("endPhotoThumb").classList.add("hidden"); $("endPhotoThumb").src = "";
  refreshBadges();
}
async function loadShiftIntoForm(){
  setText("shiftMsg","Loading…");
  clearShiftForm();

  const row = await fetchShift(selectedCompanyId, selectedDateStr);
  if (!row){ setText("shiftMsg","No shift saved for this date yet."); return; }

  if (row.start_time) $("startTime").value = toLocalDateTimeInputValue(new Date(row.start_time));
  if (row.end_time) $("endTime").value = toLocalDateTimeInputValue(new Date(row.end_time));
  $("startMileage").value = row.start_mileage ?? "";
  $("endMileage").value = row.end_mileage ?? "";
  $("totalMileage").value = row.total_mileage ?? "";
  $("totalParcels").value = row.total_parcels ?? "";
  $("totalStops").value = row.total_stops ?? "";
  $("estimatedPay").value = row.estimated_pay ?? "";
  $("notes").value = row.notes ?? "";

  // thumbnails (won't block if storage not set)
  try{
    if (row.start_mileage_photo_path){
      const url = await signedUrl(row.start_mileage_photo_path);
      if (url){ $("startPhotoThumb").src = url; $("startPhotoThumb").classList.remove("hidden"); }
    }
    if (row.end_mileage_photo_path){
      const url = await signedUrl(row.end_mileage_photo_path);
      if (url){ $("endPhotoThumb").src = url; $("endPhotoThumb").classList.remove("hidden"); }
    }
  }catch(err){
    console.warn("Photo preview unavailable:", err?.message || err);
  }

  refreshBadges();
  setText("shiftMsg","");
}
async function saveShift(){
  try{
    setText("shiftMsg","Saving…");

    const startDt = fromLocalDateTimeInputValue($("startTime").value);
    if (!startDt) return setText("shiftMsg","Start time is required. Use Start shift or set it manually.");

    const endDt = fromLocalDateTimeInputValue($("endTime").value);

    const start_mileage = numberOrNull($("startMileage").value);
    const end_mileage = numberOrNull($("endMileage").value);
    const total_mileage = calcMileage();

    const total_parcels = numberOrNull($("totalParcels").value);
    const total_stops = numberOrNull($("totalStops").value);
    const estimated_pay = numberOrNull($("estimatedPay").value);
    const notes = ($("notes").value || "").trim() || null;

    let start_mileage_photo_path = null;
    let end_mileage_photo_path = null;

    const existing = await fetchShift(selectedCompanyId, selectedDateStr);

    if (selectedCompany.uses_mileage && selectedCompany.uses_photos){
      const startFile = $("startMileagePhoto").files?.[0] || null;
      const endFile = $("endMileagePhoto").files?.[0] || null;
      if (startFile) start_mileage_photo_path = await uploadPhoto(startFile, `${selectedCompanyId}/${selectedDateStr}/start-${Date.now()}.jpg`);
      if (endFile) end_mileage_photo_path = await uploadPhoto(endFile, `${selectedCompanyId}/${selectedDateStr}/end-${Date.now()}.jpg`);
    }

    await upsertShift(selectedCompanyId, selectedDateStr, {
      start_time: startDt.toISOString(),
      end_time: endDt ? endDt.toISOString() : null,
      start_mileage,
      end_mileage,
      total_mileage,
      start_mileage_photo_path: start_mileage_photo_path ?? existing?.start_mileage_photo_path ?? null,
      end_mileage_photo_path: end_mileage_photo_path ?? existing?.end_mileage_photo_path ?? null,
      total_parcels,
      total_stops,
      estimated_pay,
      notes
    });

    setText("shiftMsg","Saved ✅");
    await loadShiftIntoForm();
    await renderCompanyMonthList();
  }catch(err){
    console.error(err);
    setText("shiftMsg", err?.message || String(err));
  }
}
function startShiftNow(){
  $("startTime").value = toLocalDateTimeInputValue(new Date());
  refreshBadges();
  setText("shiftMsg","Start time set. Tap Save when ready.");
}
function endShiftNow(){
  $("endTime").value = toLocalDateTimeInputValue(new Date());
  refreshBadges();
  setText("shiftMsg","End time set. Tap Save when ready.");
}
async function deleteDay(){
  try{
    if (!confirm("Delete saved shift for this date?")) return;
    await deleteShift(selectedCompanyId, selectedDateStr);
    clearShiftForm();
    setText("shiftMsg","Deleted ✅");
    await renderCompanyMonthList();
  }catch(err){
    setText("shiftMsg", err?.message || String(err));
  }
}
async function renderCompanyMonthList(){
  const ul = $("companyMonthList");
  ul.innerHTML = "";
  const rows = await listCompanyMonth(selectedCompanyId, monthCursor);
  if (!rows.length) return;

  for (const r of rows){
    const st = r.start_time ? new Date(r.start_time) : null;
    const et = r.end_time ? new Date(r.end_time) : null;
    const h = st && et ? hoursBetween(st, et) : null;
    const hTxt = h ? `${h.toFixed(2)}h` : "—";
    const miTxt = (r.total_mileage ?? null) !== null ? `${Number(r.total_mileage).toFixed(1)} mi` : "";
    const payTxt = (r.estimated_pay ?? null) !== null ? `£${Number(r.estimated_pay).toFixed(2)}` : "";
    const li = document.createElement("li");
    li.innerHTML = `<b>${r.work_date}</b> • ${hTxt}${miTxt ? " • "+miTxt : ""}${payTxt ? " • "+payTxt : ""}`;
    ul.appendChild(li);
  }
}
async function openCompany(companyId){
  const companies = await listCompanies();
  const c = companies.find(x=>x.id===companyId);
  if (!c) return;

  selectedCompanyId = companyId;
  selectedCompany = c;
  localStorage.setItem(LS.lastCompanyId, companyId);

  $("companyTitle").textContent = c.name;
  applyCompanyConfig(c);

  selectedDateStr = todayStr();
  monthCursor = startOfMonth(new Date());

  syncShiftDatePicker();
  await loadShiftIntoForm();
  await renderCompanyMonthList();
  showView("companyView");
}

/* ---------------- monthly summary ---------------- */
async function listShiftsInMonth(monthDate){
  const user = await requireUser();
  const { start, end } = monthRange(monthDate);
  const res = await sb.from("shifts")
    .select("work_date,start_time,end_time,total_mileage,estimated_pay,companies(name)")
    .eq("user_id", user.id)
    .gte("start_time", start.toISOString())
    .lt("start_time", end.toISOString())
    .order("start_time", { ascending:false });
  if (res.error) throw res.error;
  return res.data || [];
}
async function renderMonthly(){
  $("monthLabel").textContent = monthLabel(monthCursor);
  $("monthNext").disabled = (monthCursor >= startOfMonth(new Date()));

  setText("monthMsg","Loading…");
  const ul = $("monthShiftList");
  ul.innerHTML = "";

  const rows = await listShiftsInMonth(monthCursor);
  if (!rows.length){
    setText("monthMsg","No shifts in this month yet.");
    setText("kpiShifts","0"); setText("kpiHours","0"); setText("kpiMileage","0"); setText("kpiPay","0");
    return;
  }

  let totalHours = 0, totalMileage = 0, totalPay = 0, shiftsCount = 0;

  for (const r of rows){
    shiftsCount += 1;
    const st = r.start_time ? new Date(r.start_time) : null;
    const et = r.end_time ? new Date(r.end_time) : null;
    const h = st && et ? hoursBetween(st, et) : 0;
    totalHours += (h || 0);
    totalMileage += Number(r.total_mileage || 0);
    totalPay += Number(r.estimated_pay || 0);

    const cname = r.companies?.name || "Company";
    const li = document.createElement("li");
    li.innerHTML = `<b>${r.work_date}</b> • ${escapeHtml(cname)} • ${(h||0).toFixed(2)}h` +
      (r.total_mileage ? ` • ${Number(r.total_mileage).toFixed(1)} mi` : "") +
      (r.estimated_pay ? ` • £${Number(r.estimated_pay).toFixed(2)}` : "");
    ul.appendChild(li);
  }

  setText("kpiShifts", String(shiftsCount));
  setText("kpiHours", totalHours.toFixed(2));
  setText("kpiMileage", totalMileage.toFixed(1));
  setText("kpiPay", totalPay.toFixed(2));
  setText("monthMsg","");
}

/* ---------------- init ---------------- */
async function bootAfterLogin(){
  await refreshCompaniesUI();
  showView("menuView");
}

async function init(){
  // auth
  $("btnLogin").onclick = doLogin;
  $("btnRegister").onclick = doRegister;
  $("btnForgot").onclick = doForgotPassword;
  $("btnSetNewPassword").onclick = setNewPassword;

  // menu
  $("btnLogout").onclick = doLogout;
  $("btnCompanies").onclick = async ()=>{ await refreshCompaniesUI(); showView("companiesView"); };
  $("goMonthly").onclick = async ()=>{ await renderMonthly(); showView("monthlyView"); };

  // companies
  $("companiesBack").onclick = ()=> showView("menuView");
  $("btnSaveCompany").onclick = saveCompany;
  $("btnClearCompany").onclick = ()=>{ setCompanyForm(null); setText("companyMsg",""); };

  // monthly
  $("monthlyBack").onclick = ()=> showView("menuView");
  $("monthPrev").onclick = async ()=>{ monthCursor = addMonths(monthCursor,-1); await renderMonthly(); };
  $("monthNext").onclick = async ()=>{ monthCursor = addMonths(monthCursor,+1); await renderMonthly(); };

  // company
  $("companyBack").onclick = ()=> showView("menuView");
  $("btnStartShift").onclick = startShiftNow;
  $("btnEndShift").onclick = endShiftNow;
  $("btnSaveShift").onclick = saveShift;
  $("btnDeleteShift").onclick = deleteDay;

  $("shiftPrev").onclick = async ()=>{ selectedDateStr = addDays(selectedDateStr,-1); syncShiftDatePicker(); await loadShiftIntoForm(); };
  $("shiftNext").onclick = async ()=>{ selectedDateStr = addDays(selectedDateStr,+1); syncShiftDatePicker(); await loadShiftIntoForm(); };
  $("shiftDatePicker").onchange = async (e)=>{ selectedDateStr = e.target.value; syncShiftDatePicker(); await loadShiftIntoForm(); };

  ["startTime","endTime","startMileage","endMileage","estimatedPay"].forEach(id=>{
    const el=$(id); if (el) el.addEventListener("input", refreshBadges);
  });

  $("startMileagePhoto").addEventListener("change", ()=>{
    const f=$("startMileagePhoto").files?.[0]; if (!f) return;
    $("startPhotoThumb").src = URL.createObjectURL(f);
    $("startPhotoThumb").classList.remove("hidden");
  });
  $("endMileagePhoto").addEventListener("change", ()=>{
    const f=$("endMileagePhoto").files?.[0]; if (!f) return;
    $("endPhotoThumb").src = URL.createObjectURL(f);
    $("endPhotoThumb").classList.remove("hidden");
  });

  if (isRecoveryLink()){ showView("resetView", false); return; }

  const sess = await sb.auth.getSession();
  if (sess.data?.session) await bootAfterLogin();
  else showView("authView", false);
}

init().catch((e)=>{ console.error(e); alert(e.message || String(e)); });
