/* Tracker Starter (Supabase Sync) – app.js
   - PWA + Supabase Auth + Postgres
   - Cloud sync for: delivery rounds, exercises, workout sessions + sets
   - Draft workout sets stored locally so you don't lose your in-progress entry
*/

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://qntswiybgqijbbhpzpas.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JW0SqP8JbZFsgVfpPevHrg__FeyrIgq";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const $ = (id) => document.getElementById(id);

// ----- views -----
const VIEWS = ["authView","menuView","deliveryView","workoutView","settingsView"];
function showView(id, push = true) {
  for (const v of VIEWS) $(v)?.classList.toggle("hidden", v !== id);
  if (push) history.pushState({ view: id }, "", "#" + id);
}
window.addEventListener("popstate", (e) => {
  const view = e.state?.view || (location.hash ? location.hash.replace("#", "") : "menuView");
  if (VIEWS.includes(view)) showView(view, false);
});

// ----- date helpers -----
function pad2(n) { return String(n).padStart(2, "0"); }
function yyyyMmDd(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
function parseDateStr(dateStr){
  const [y,m,d] = dateStr.split("-").map(Number);
  return new Date(y, m-1, d, 12, 0, 0, 0);
}
function addDays(dateStr, delta){
  const dt = parseDateStr(dateStr);
  dt.setDate(dt.getDate() + delta);
  return yyyyMmDd(dt);
}
function nowTimeStr(){
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ----- local storage (draft only + tiny cached exercises fallback) -----
const KEYS = {
  workoutDraft: "ts_workoutDraft_v1",
  exercisesCache: "ts_exercises_cache_v1"
};
function loadLocal(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function saveLocal(key, val){ localStorage.setItem(key, JSON.stringify(val)); }
function uid(){ return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }

// ----- auth helpers -----
async function getUser(){
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}
function setAuthStatus(msg){ $("authStatus").textContent = msg || ""; }

// =====================================================
// DELIVERY ROUNDS (cloud)
// =====================================================
let deliveryDate = yyyyMmDd(new Date());

function calcMiles(){
  const s = Number(($("deliveryStartMiles")?.value || "").trim());
  const e = Number(($("deliveryEndMiles")?.value || "").trim());
  const ok = Number.isFinite(s) && Number.isFinite(e) && e >= s;
  $("deliveryTotalMiles").value = ok ? (e - s).toFixed(1) : "";
}

function clearDeliveryForm(){
  $("deliveryStartMiles").value = "";
  $("deliveryEndMiles").value = "";
  $("deliveryTotalMiles").value = "";
  $("deliveryDelivered").value = "";
  $("deliveryCollected").value = "";
  $("deliveryNotes").value = "";
}

async function fetchDeliveryRounds(){
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("delivery_rounds")
    .select("*")
    .eq("user_id", user.id)
    .eq("date", deliveryDate)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    alert("Failed to load delivery rounds from the cloud.");
    return [];
  }
  return data || [];
}

async function saveDeliveryRound(){
  const user = await getUser();
  if (!user) return alert("You are signed out. Please sign in again.");

  const startMiles = Number(($("deliveryStartMiles").value || "").trim());
  const endMiles = Number(($("deliveryEndMiles").value || "").trim());
  const delivered = Number(($("deliveryDelivered").value || "0").trim());
  const collected = Number(($("deliveryCollected").value || "0").trim());
  const notes = ($("deliveryNotes").value || "").trim() || null;

  if (!Number.isFinite(startMiles) || !Number.isFinite(endMiles)) return alert("Enter valid start + end mileage.");
  if (endMiles < startMiles) return alert("End mileage must be >= start mileage.");
  if (!Number.isFinite(delivered) || delivered < 0) return alert("Delivered must be 0 or more.");
  if (!Number.isFinite(collected) || collected < 0) return alert("Collected must be 0 or more.");

  const totalMiles = Number((endMiles - startMiles).toFixed(1));

  const { error } = await supabase.from("delivery_rounds").insert([{
    user_id: user.id,
    date: deliveryDate,
    start_miles: startMiles,
    end_miles: endMiles,
    total_miles: totalMiles,
    delivered,
    collected,
    notes
  }]);

  if (error) {
    console.error(error);
    alert("Failed to save. Check your Supabase URL/key + RLS policies.");
    return;
  }

  clearDeliveryForm();
  await renderDeliveryRounds();
}

async function deleteDeliveryRound(id){
  const user = await getUser();
  if (!user) return;

  const { error } = await supabase
    .from("delivery_rounds")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    alert("Failed to delete.");
    return;
  }
  await renderDeliveryRounds();
}

async function renderDeliveryRounds(){
  const list = $("deliveryList");
  const empty = $("deliveryEmptyMsg");

  list.innerHTML = "";
  empty.textContent = "Loading...";
  const rounds = await fetchDeliveryRounds();

  if (!rounds.length){
    empty.textContent = "No rounds saved for this date yet.";
    return;
  }
  empty.textContent = "";

  for (const r of rounds){
    const li = document.createElement("li");
    const notes = r.notes ? ` • ${r.notes}` : "";
    li.innerHTML = `
      <b>${Number(r.total_miles).toFixed(1)} mi</b> • ${r.start_miles} → ${r.end_miles}
      • Delivered: ${r.delivered} • Collected: ${r.collected}${notes}
      <button class="secondary miniInlineBtn" data-del-id="${r.id}" type="button">Delete</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-del-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del-id");
      if (confirm("Delete this round?")) await deleteDeliveryRound(id);
    });
  });
}

function wireDeliveryDateBar(){
  $("deliveryDatePicker").value = deliveryDate;
  $("deliveryPrev").onclick = async () => { deliveryDate = addDays(deliveryDate, -1); await syncDeliveryDate(); };
  $("deliveryNext").onclick = async () => { deliveryDate = addDays(deliveryDate, +1); await syncDeliveryDate(); };
  $("deliveryDatePicker").onchange = async (e) => { deliveryDate = e.target.value; await syncDeliveryDate(); };
}
async function syncDeliveryDate(){
  $("deliveryDatePicker").value = deliveryDate;
  await renderDeliveryRounds();
}

// =====================================================
// WORKOUT (cloud + local draft)
// =====================================================
let workoutDate  = yyyyMmDd(new Date());

function getWorkoutDraft(){
  return loadLocal(KEYS.workoutDraft, {
    date: workoutDate,
    startTime: "",
    endTime: "",
    units: "kg",
    sets: [] // {id,exercise,setNo,reps,weight}
  });
}
function setWorkoutDraft(draft){
  saveLocal(KEYS.workoutDraft, draft);
}
function clearWorkoutSetInputs(){
  $("reps").value = "";
  $("weight").value = "";
  $("setNumber").value = "1";
}

async function fetchExercises(){
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("exercises")
    .select("name")
    .eq("user_id", user.id)
    .order("name", { ascending: true });

  if (error){
    console.error(error);
    // fallback to cache
    return loadLocal(KEYS.exercisesCache, []);
  }

  const list = (data || []).map(x => x.name).filter(Boolean);
  saveLocal(KEYS.exercisesCache, list);
  return list;
}

async function ensureDefaultExercisesIfEmpty(){
  const user = await getUser();
  if (!user) return;

  const current = await fetchExercises();
  if (current.length) return;

  const defaults = ["Bench Press","Squat","Deadlift","Overhead Press","Pull-Up","Row","Bicep Curl","Tricep Extension"];
  const rows = defaults.map(name => ({ user_id: user.id, name }));

  // ignore unique conflicts etc
  await supabase.from("exercises").insert(rows);
}

async function renderExerciseSelect(){
  await ensureDefaultExercisesIfEmpty();
  const sel = $("exerciseSelect");
  const ex = await fetchExercises();

  sel.innerHTML = ex.map(name => `<option>${name}</option>`).join("");
}

function renderSetNumberSelect(){
  const sel = $("setNumber");
  sel.innerHTML = Array.from({length: 12}, (_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
  sel.value = "1";
}

async function addExercise(){
  const user = await getUser();
  if (!user) return alert("You are signed out. Please sign in again.");

  const name = ($("newExerciseName").value || "").trim();
  if (!name) return alert("Enter an exercise name first.");

  const { error } = await supabase.from("exercises").insert([{ user_id: user.id, name }]);
  if (error && !String(error.message || "").toLowerCase().includes("duplicate")) {
    console.error(error);
    alert("Failed to add exercise.");
    return;
  }

  $("newExerciseName").value = "";
  await renderExerciseSelect();
  $("exerciseSelect").value = name;
}

function addSet(){
  const draft = getWorkoutDraft();

  const exercise = $("exerciseSelect").value;
  const setNo = Number($("setNumber").value || "1");
  const reps = Number(($("reps").value || "").trim());
  const weight = Number(($("weight").value || "").trim());
  const units = $("workoutUnits").value;

  if (!exercise) return alert("Pick an exercise.");
  if (!Number.isFinite(setNo) || setNo < 1) return alert("Set number must be 1+.");
  if (!Number.isFinite(reps) || reps < 1) return alert("Reps must be 1+.");
  if (!Number.isFinite(weight) || weight < 0) return alert("Weight must be 0+.");

  draft.units = units;
  draft.sets.push({ id: uid(), exercise, setNo, reps, weight });
  setWorkoutDraft(draft);

  clearWorkoutSetInputs();
  renderWorkoutDraft();
}

function deleteDraftSet(id){
  const draft = getWorkoutDraft();
  draft.sets = (draft.sets || []).filter(s => s.id !== id);
  setWorkoutDraft(draft);
  renderWorkoutDraft();
}

function renderWorkoutDraft(){
  const draft = getWorkoutDraft();

  draft.date = workoutDate;
  setWorkoutDraft(draft);

  $("workoutStartTime").value = draft.startTime || "";
  $("workoutEndTime").value = draft.endTime || "";
  $("workoutUnits").value = draft.units || "kg";

  const list = $("workoutSetList");
  const empty = $("workoutSetEmptyMsg");
  list.innerHTML = "";

  const sets = (draft.sets || []).slice().sort((a,b)=>{
    if (a.exercise !== b.exercise) return a.exercise.localeCompare(b.exercise);
    return a.setNo - b.setNo;
  });

  if (!sets.length){
    empty.textContent = "No sets added yet.";
  }else{
    empty.textContent = "";
    for (const s of sets){
      const li = document.createElement("li");
      li.innerHTML = `<b>${s.exercise}</b> • Set ${s.setNo} • ${s.reps} reps • ${s.weight} ${draft.units}
        <button class="secondary miniInlineBtn" data-set-id="${s.id}" type="button">Delete</button>`;
      list.appendChild(li);
    }
    list.querySelectorAll("[data-set-id]").forEach(btn => {
      btn.addEventListener("click", () => deleteDraftSet(btn.getAttribute("data-set-id")));
    });
  }
}

function workoutStartNow(){
  const t = nowTimeStr();
  $("workoutStartTime").value = t;
  const draft = getWorkoutDraft();
  draft.startTime = t;
  setWorkoutDraft(draft);
}
function workoutEndNow(){
  const t = nowTimeStr();
  $("workoutEndTime").value = t;
  const draft = getWorkoutDraft();
  draft.endTime = t;
  setWorkoutDraft(draft);
}

async function fetchWorkoutSessionsWithSets(){
  const user = await getUser();
  if (!user) return [];

  const { data: sessions, error: sErr } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", user.id)
    .eq("date", workoutDate)
    .order("created_at", { ascending: false });

  if (sErr){
    console.error(sErr);
    alert("Failed to load workout sessions.");
    return [];
  }

  const ids = (sessions || []).map(s => s.id);
  if (!ids.length) return sessions || [];

  const { data: sets, error: setErr } = await supabase
    .from("workout_sets")
    .select("*")
    .eq("user_id", user.id)
    .in("session_id", ids);

  if (setErr){
    console.error(setErr);
    alert("Failed to load workout sets.");
    return sessions || [];
  }

  const bySession = new Map(ids.map(id => [id, []]));
  (sets || []).forEach(x => bySession.get(x.session_id)?.push(x));

  return (sessions || []).map(s => ({ ...s, sets: bySession.get(s.id) || [] }));
}

async function renderWorkoutSessions(){
  const list = $("workoutSessionList");
  const empty = $("workoutEmptyMsg");
  list.innerHTML = "";
  empty.textContent = "Loading...";

  const sessions = await fetchWorkoutSessionsWithSets();

  if (!sessions.length){
    empty.textContent = "No sessions saved for this date yet.";
    return;
  }
  empty.textContent = "";

  for (const s of sessions){
    const totalSets = (s.sets || []).length;
    const end = s.end_time ? `–${String(s.end_time).slice(0,5)}` : "";
    const li = document.createElement("li");
    li.innerHTML = `
      <b>${String(s.start_time).slice(0,5)}${end}</b> • ${totalSets} sets • Units: ${s.units}
      <button class="secondary miniInlineBtn" data-sesh-id="${s.id}" type="button">Delete</button>
    `;
    list.appendChild(li);
  }

  list.querySelectorAll("[data-sesh-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-sesh-id");
      if (confirm("Delete this saved session?")) await deleteWorkoutSession(id);
    });
  });
}

async function saveWorkoutSession(){
  const user = await getUser();
  if (!user) return alert("You are signed out. Please sign in again.");

  const draft = getWorkoutDraft();
  draft.startTime = $("workoutStartTime").value || "";
  draft.endTime = $("workoutEndTime").value || "";
  draft.units = $("workoutUnits").value || "kg";

  if (!draft.startTime) return alert("Add a start time (or press Start session).");
  if ((draft.sets || []).length === 0) return alert("Add at least one set.");
  if (draft.endTime && draft.endTime < draft.startTime) return alert("End time must be after start time.");

  // 1) create session
  const { data: session, error: sErr } = await supabase
    .from("workout_sessions")
    .insert([{
      user_id: user.id,
      date: workoutDate,
      start_time: draft.startTime,
      end_time: draft.endTime || null,
      units: draft.units
    }])
    .select()
    .single();

  if (sErr){
    console.error(sErr);
    alert("Failed to save session.");
    return;
  }

  // 2) create sets
  const rows = (draft.sets || []).map(s => ({
    user_id: user.id,
    session_id: session.id,
    exercise: s.exercise,
    set_no: s.setNo,
    reps: s.reps,
    weight: s.weight
  }));

  const { error: setErr } = await supabase.from("workout_sets").insert(rows);
  if (setErr){
    console.error(setErr);
    alert("Session saved, but sets failed. (You can delete and re-save.)");
  }

  // reset draft
  saveLocal(KEYS.workoutDraft, { date: workoutDate, startTime: "", endTime: "", units: draft.units, sets: [] });
  renderWorkoutDraft();
  await renderWorkoutSessions();
}

function discardWorkoutSession(){
  if (!confirm("Discard current session draft?")) return;
  saveLocal(KEYS.workoutDraft, { date: workoutDate, startTime: "", endTime: "", units: $("workoutUnits").value || "kg", sets: [] });
  renderWorkoutDraft();
}

async function deleteWorkoutSession(id){
  const user = await getUser();
  if (!user) return;

  // sets are cascade-deleted by FK
  const { error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error){
    console.error(error);
    alert("Failed to delete session.");
    return;
  }
  await renderWorkoutSessions();
}

// date bar
function wireWorkoutDateBar(){
  $("workoutDatePicker").value = workoutDate;
  $("workoutPrev").onclick = async () => { workoutDate = addDays(workoutDate, -1); await syncWorkoutDate(); };
  $("workoutNext").onclick = async () => { workoutDate = addDays(workoutDate, +1); await syncWorkoutDate(); };
  $("workoutDatePicker").onchange = async (e) => { workoutDate = e.target.value; await syncWorkoutDate(); };
}
async function syncWorkoutDate(){
  $("workoutDatePicker").value = workoutDate;

  // keep draft per-date (simple approach: reset on date switch)
  const draft = getWorkoutDraft();
  saveLocal(KEYS.workoutDraft, { date: workoutDate, startTime: "", endTime: "", units: draft.units || "kg", sets: [] });

  renderWorkoutDraft();
  await renderWorkoutSessions();
}

// =====================================================
// SETTINGS / EXPORT
// =====================================================
async function exportData(){
  const user = await getUser();
  if (!user) return alert("Signed out.");

  const { data: rounds } = await supabase.from("delivery_rounds").select("*").eq("user_id", user.id);
  const { data: exercises } = await supabase.from("exercises").select("*").eq("user_id", user.id);
  const { data: sessions } = await supabase.from("workout_sessions").select("*").eq("user_id", user.id);
  const { data: sets } = await supabase.from("workout_sets").select("*").eq("user_id", user.id);

  const payload = { exportedAt: new Date().toISOString(), rounds, exercises, sessions, sets };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tracker-export-${yyyyMmDd(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function refreshFromCloud(){
  await renderDeliveryRounds();
  await renderExerciseSelect();
  renderWorkoutDraft();
  await renderWorkoutSessions();
  alert("Refreshed ✅");
}

// =====================================================
// AUTH UI
// =====================================================
async function signIn(){
  setAuthStatus("Signing in...");
  const email = ($("authEmail").value || "").trim();
  const password = $("authPassword").value || "";

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error){
    console.error(error);
    setAuthStatus(error.message || "Sign in failed.");
    return;
  }
  setAuthStatus("");
}

async function signUp(){
  setAuthStatus("Creating account...");
  const email = ($("authEmail").value || "").trim();
  const password = $("authPassword").value || "";

  const { error } = await supabase.auth.signUp({ email, password });
  if (error){
    console.error(error);
    setAuthStatus(error.message || "Sign up failed.");
    return;
  }
  setAuthStatus("Account created ✅ If email confirmation is enabled, check your inbox.");
}

async function resetPassword(){
  const email = ($("authEmail").value || "").trim();
  if (!email) return setAuthStatus("Enter your email first.");
  setAuthStatus("Sending reset email...");
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error){
    console.error(error);
    setAuthStatus(error.message || "Failed to send reset email.");
    return;
  }
  setAuthStatus("Reset email sent ✅");
}

async function signOut(){
  await supabase.auth.signOut();
}

// =====================================================
// INIT + NAV
// =====================================================
function wireNav(){
  $("goDelivery").onclick = async () => { showView("deliveryView"); await syncDeliveryDate(); };
  $("goWorkout").onclick = async () => { showView("workoutView"); await syncWorkoutDate(); };
  $("goSettings").onclick = () => { showView("settingsView"); };

  $("deliveryBack").onclick = () => showView("menuView");
  $("workoutBack").onclick = () => showView("menuView");
  $("settingsBack").onclick = () => showView("menuView");
}

function wireDelivery(){
  wireDeliveryDateBar();
  $("deliveryStartMiles").addEventListener("input", calcMiles);
  $("deliveryEndMiles").addEventListener("input", calcMiles);
  $("btnSaveDelivery").onclick = saveDeliveryRound;
  $("btnClearDeliveryForm").onclick = clearDeliveryForm;
}

function wireWorkout(){
  wireWorkoutDateBar();
  renderSetNumberSelect();

  $("btnAddExercise").onclick = addExercise;
  $("btnAddSet").onclick = addSet;
  $("btnClearWorkoutForm").onclick = clearWorkoutSetInputs;

  $("btnWorkoutStart").onclick = workoutStartNow;
  $("btnWorkoutEnd").onclick = workoutEndNow;

  $("workoutStartTime").addEventListener("change", () => {
    const d = getWorkoutDraft(); d.startTime = $("workoutStartTime").value || ""; setWorkoutDraft(d);
  });
  $("workoutEndTime").addEventListener("change", () => {
    const d = getWorkoutDraft(); d.endTime = $("workoutEndTime").value || ""; setWorkoutDraft(d);
  });
  $("workoutUnits").addEventListener("change", () => {
    const d = getWorkoutDraft(); d.units = $("workoutUnits").value || "kg"; setWorkoutDraft(d); renderWorkoutDraft();
  });

  $("btnSaveWorkoutSession").onclick = saveWorkoutSession;
  $("btnDiscardWorkoutSession").onclick = discardWorkoutSession;
}

function wireSettings(){
  $("btnExportData").onclick = exportData;
  $("btnRefreshCloud").onclick = refreshFromCloud;
  $("btnSignOut").onclick = signOut;
}

// mini inline delete buttons inside list items
(function injectMiniInlineBtnCSS(){
  const s = document.createElement("style");
  s.textContent = `
    .miniInlineBtn{
      margin-left: 10px;
      width: auto !important;
      display: inline-block !important;
      padding: 0 12px !important;
      height: 34px !important;
      border-radius: 999px !important;
      font-weight: 900 !important;
      vertical-align: middle;
    }
  `;
  document.head.appendChild(s);
})();

async function onSignedIn(user){
  $("whoAmI").textContent = `Signed in as ${user.email || user.id}`;
  $("settingsEmail").textContent = user.email || user.id;

  // set module dates
  deliveryDate = yyyyMmDd(new Date());
  workoutDate = yyyyMmDd(new Date());

  $("deliveryDatePicker").value = deliveryDate;
  $("workoutDatePicker").value = workoutDate;

  await renderExerciseSelect();
  await renderDeliveryRounds();
  renderWorkoutDraft();
  await renderWorkoutSessions();

  showView("menuView", false);
}

async function onSignedOut(){
  $("whoAmI").textContent = "";
  $("settingsEmail").textContent = "";
  showView("authView", false);
}

async function init(){
  wireNav();
  wireDelivery();
  wireWorkout();
  wireSettings();

  $("btnSignIn").onclick = signIn;
  $("btnSignUp").onclick = signUp;
  $("btnResetPassword").onclick = resetPassword;

  // session bootstrap
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) await onSignedIn(session.user);
  else await onSignedOut();

  // keep UI in sync with auth state
  supabase.auth.onAuthStateChange(async (_event, session2) => {
    if (session2?.user) await onSignedIn(session2.user);
    else await onSignedOut();
  });
}

init();
