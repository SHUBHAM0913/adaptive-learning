/* ── StudyZen frontend (vanilla JS, no build step) ────────────────────────
   Purple glassmorphism mobile-style UI on top of the MasteryOS backend:
   onboarding, dashboard, today's plan, progress analytics, subjects,
   detailed concept map, assignments, attendance, quiz, results, profile
   and the admin question bank. */
"use strict";

const API = "/api";
const store = {
  key: "masteryos_student",
  get() {
    try { return JSON.parse(localStorage.getItem(this.key) || "null"); } catch { return null; }
  },
  set(v) { localStorage.setItem(this.key, JSON.stringify(v)); },
  clear() { localStorage.removeItem(this.key); },
};

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[c]));

const LETTERS = ["A", "B", "C", "D"];

/* ── Error taxonomy: the "learn from your mistake" vocabulary ────────────── */
const ERROR_LABEL = {
  CONCEPTUAL_ERROR: { label: "Conceptual gap", ic: "💡" },
  CALCULATION_ERROR: { label: "Calculation slip", ic: "🧮" },
  FORMULA_SELECTION_ERROR: { label: "Wrong formula picked", ic: "📐" },
  SIGN_ERROR: { label: "Sign / direction error", ic: "±" },
  GUESS: { label: "Guessed — answered too fast", ic: "🎲" },
  TIME_PRESSURE: { label: "Ran out of time", ic: "⏱" },
  SKIPPED: { label: "Skipped", ic: "⏭" },
  UNIT_ERROR: { label: "Unit error", ic: "📏" },
  READING_ERROR: { label: "Misread the question", ic: "👀" },
  CARELESS_ERROR: { label: "Careless mistake", ic: "😅" },
  UNKNOWN: { label: "Wrong answer", ic: "❌" },
};

/* subject (topic) -> look & feel */
const SUBJECT_META = {
  "Mechanics": { ic: "🧭", c1: "#4E7CFF", c2: "#3A5FD0" },
  "Kinematics": { ic: "🏃", c1: "#2ED3B7", c2: "#1E9E8A" },
  "Dynamics": { ic: "⚡", c1: "#8F6DFF", c2: "#5B3DF0" },
  "Work and Energy": { ic: "💡", c1: "#FFB020", c2: "#D88A00" },
  "Momentum": { ic: "🎯", c1: "#FF7AA2", c2: "#D63A6C" },
  "Rotational": { ic: "🔄", c1: "#9B6DFF", c2: "#6A3BF0" },
  "Gravitation": { ic: "🌍", c1: "#4EC1FF", c2: "#2E8FE0" },
};
function subjectMeta(topic) {
  return SUBJECT_META[topic] || { ic: "📚", c1: "#A49BC4", c2: "#7C6FA8" };
}
const ACTION_ICON = {
  FOUNDATION_REBUILD: "🧱",
  REVIEW: "📖",
  SPEED_PRACTICE: "⚡",
  MULTI_CONCEPT_DRILL: "🧩",
  ADVANCED_PRACTICE: "🚀",
  TRANSFER_TEST: "🧪",
  RETENTION_DRILL: "🔁",
};
const ACTION_LABEL = {
  FOUNDATION_REBUILD: "Rebuild",
  REVIEW: "Study",
  SPEED_PRACTICE: "Practice",
  MULTI_CONCEPT_DRILL: "Drill",
  ADVANCED_PRACTICE: "Advance",
  TRANSFER_TEST: "Test",
  RETENTION_DRILL: "Review",
};

function ringClass(p) {
  if (p >= 70) return "ring-green";
  if (p >= 40) return "ring-amber";
  return "ring-red";
}
function reasonClass(r) {
  if (r.includes("Root foundational gap")) return "is-root";
  if (r.includes("Spaced-repetition") || r.includes("decay")) return "is-forget";
  return "";
}

/* ── Router ──────────────────────────────────────────────────────────────── */
const appEl = $("#app");
let pendingScroll = null;

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", route);

// Delegated nav: covers anchors AND buttons (tabs, banner CTA, map side
// panel, empty states) rendered anywhere — also live for content added later.
document.addEventListener("click", (e) => {
  const el = e.target.closest("a[data-nav], button[data-nav]");
  if (!el) return;
  e.preventDefault();
  const href = el.dataset.nav;
  if (el.dataset.scroll && location.pathname === href) {
    document.getElementById(el.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (el.dataset.scroll) pendingScroll = el.dataset.scroll;
  navigate(href);
});

function stripApp(path) {
  // /app/xyz and /xyz both resolve to the same page (SPA is served under /app)
  if (path === "/app" || path === "/app/") return "/";
  if (path.startsWith("/app/")) return path.slice(4);
  return path;
}

function route() {
  const raw = location.pathname;
  const path = stripApp(raw);

  // deep link to the demo student: any page + ?demo=1
  if (new URLSearchParams(location.search).get("demo")) {
    store.set({ student_id: "demo", name: "Demo Student", demo: true });
  }
  const me = store.get();

  if (path === "/") return me ? renderDashboard() : renderOnboarding();
  if (path === "/plan") return requireAuth(() => renderPlan(), me);
  if (path === "/progress") return requireAuth(() => renderProgress(), me);
  if (path === "/subjects") return requireAuth(() => renderSubjects(), me);
  if (path === "/map" || path === "/graph") return requireAuth(() => renderMap(), me);
  if (path === "/assignments") return requireAuth(() => renderAssignments(), me);
  if (path === "/attendance") return requireAuth(() => renderAttendance(), me);
  if (path === "/profile") return requireAuth(() => renderProfile(), me);
  if (path === "/bank" || path === "/questions") return requireAuth(() => renderQuestionBank(), me);

  const m = path.match(/^\/quiz\/([^/]+)\/([^/]+)/);
  if (m) return requireAuth(() => renderQuiz(decodeURIComponent(m[1]), decodeURIComponent(m[2])), me);
  const c = path.match(/^\/course\/([^/]+)/);
  if (c) return requireAuth(() => renderCourse(decodeURIComponent(c[1])), me);
  if (path === "/results") return requireAuth(renderResults, me);

  me ? renderDashboard() : renderOnboarding();
}

function requireAuth(fn, me) {
  if (!me) return renderOnboarding();
  return fn();
}

/* ── Streak: consecutive daily visits, kept in localStorage ─────────────── */
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function streakInfo() {
  const key = "fieldnote_streak";
  let s = { last: "", count: 0 };
  try { s = JSON.parse(localStorage.getItem(key) || '{"last":"","count":0}'); } catch { /* ignore */ }
  const today = ymdLocal(new Date());
  const yesterday = ymdLocal(new Date(Date.now() - 864e5));
  if (s.last === today) return s.count;
  if (s.last === yesterday) s.count += 1;
  else s.count = 1;
  s.last = today;
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* ignore */ }
  return s.count;
}

/* ── Shared state caches ────────────────────────────────────────────────── */
let dashboardCache = null;
let subjectsCache = null;
let assignmentsCache = null;
let attendanceCache = null;
let graphData = null; // /api/curriculum payload

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function daysUntil(iso) {
  if (!iso) return null;
  const due = new Date(iso + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((due - now) / 864e5);
}

function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ── App shell: status bar + content + bottom tabs ─────────────────────── */
const TABS = [
  { id: "home", path: "/", ic: "🏠", label: "Home" },
  { id: "plan", path: "/plan", ic: "📅", label: "Plan" },
  null, // FAB
  { id: "progress", path: "/progress", ic: "⏱", label: "Progress" },
  { id: "profile", path: "/profile", ic: "👤", label: "Profile" },
];

function renderShell(active, me, content, opts = {}) {
  const tabs = TABS.map((t) => {
    if (!t) return `<button class="tab-fab" id="fab-open" aria-label="Quick actions">＋</button>`;
    const on = t.id === active ? " is-active" : "";
    return `<button class="tab${on}" data-nav="${t.path}"><span class="t-ic">${t.ic}</span><span>${t.label}</span></button>`;
  }).join("");

  return `
  <div class="frame${opts.wide ? " wide" : ""}">
    <div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>
    <div class="statusbar" aria-hidden="true">
      <span>9:41</span>
      <span class="sb-ic">📶 📶 🔋</span>
    </div>
    <main class="app-main ${opts.navless ? "navless" : ""}" id="main">${content}</main>
    ${opts.navless ? "" : `
    <nav class="tabbar" aria-label="Primary">
      <div class="tabbar-inner">${tabs}</div>
    </nav>`}
  </div>`;
}

function wireShell() {
  const fab = $("#fab-open");
  if (fab) fab.addEventListener("click", openFabSheet);

  // inline back buttons rendered on sub-pages
  document.querySelectorAll("[data-nav-back]").forEach((b) =>
    b.addEventListener("click", () => history.back()));
}

function openFabSheet() {
  const mask = document.createElement("div");
  mask.className = "sheet-mask";
  mask.innerHTML = `
    <div class="sheet" role="dialog" aria-label="Quick actions">
      <h3>Quick actions</h3>
      <button class="sheet-opt" data-go="/assignments"><span class="s-ic">📝</span> Give an assignment</button>
      <button class="sheet-opt" data-go="/attendance"><span class="s-ic">✅</span> Mark a class attended</button>
      <button class="sheet-opt" data-go="/plan"><span class="s-ic">🚀</span> Start next focus session</button>
      <button class="sheet-close">Close</button>
    </div>`;
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { close(); navigate(go.dataset.go); }
  });
  mask.querySelector(".sheet-close").addEventListener("click", close);
}

/* ── Onboarding ─────────────────────────────────────────────────────────── */
function robotSVG() {
  return `<svg viewBox="0 0 140 140" aria-hidden="true">
    <defs>
      <linearGradient id="rb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E9E1FB"/>
      </linearGradient>
      <linearGradient id="bk" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#8F6DFF"/><stop offset="1" stop-color="#5B3DF0"/>
      </linearGradient>
    </defs>
    <ellipse cx="70" cy="126" rx="42" ry="7" fill="rgba(46,33,87,0.10)"/>
    <path d="M38 96 L38 70 Q38 58 50 58 L90 58 Q102 58 102 70 L102 96 Z" fill="url(#bk)"/>
    <path d="M38 96 L38 70 Q38 58 50 58 L70 58 L70 116 L38 96 Z" fill="#6A3BF0" opacity="0.65"/>
    <line x1="70" y1="26" x2="70" y2="38" stroke="#8F6DFF" stroke-width="3" stroke-linecap="round"/>
    <circle cx="70" cy="23" r="5" fill="#FF7AA2"/>
    <rect x="46" y="36" width="48" height="40" rx="14" fill="url(#rb)" stroke="#CBBDF0" stroke-width="1.5"/>
    <circle cx="60" cy="53" r="6" fill="#4E7CFF"><animate attributeName="opacity" values="1;.5;1" dur="2.6s" repeatCount="indefinite"/></circle>
    <circle cx="80" cy="53" r="6" fill="#4E7CFF"><animate attributeName="opacity" values="1;.5;1" dur="2.6s" repeatCount="indefinite"/></circle>
    <path d="M58 72 Q70 82 82 72" stroke="#8F6DFF" stroke-width="3" fill="none" stroke-linecap="round"/>
    <rect x="52" y="82" width="36" height="26" rx="10" fill="url(#rb)" stroke="#CBBDF0" stroke-width="1.5"/>
    <rect x="64" y="88" width="12" height="10" rx="4" fill="#8F6DFF"/>
    <text x="70" y="99" text-anchor="middle" font-size="8" font-weight="800" fill="#5B3DF0">AI</text>
    <rect x="30" y="76" width="9" height="20" rx="4.5" fill="url(#rb)" stroke="#CBBDF0" stroke-width="1.2"/>
    <rect x="101" y="76" width="9" height="20" rx="4.5" fill="url(#rb)" stroke="#CBBDF0" stroke-width="1.2"/>
    <rect x="44" y="112" width="52" height="8" rx="4" fill="#2ED3B7" opacity="0.85"/>
  </svg>`;
}

function renderOnboarding() {
  appEl.innerHTML = `
  <div class="onboard">
    <div class="blob blob-1"></div><div class="blob blob-2"></div><div class="blob blob-3"></div>
    <div class="onboard-brand">
      <div class="brand-logo">🎓</div>
      <div class="brand-name">StudyZen</div>
    </div>
    <div class="onboard-hero">
      <div class="hero-orb">${robotSVG()}</div>
      <div class="hero-float cap">🎓</div>
      <div class="hero-float bulb">💡</div>
      <div class="hero-float board">📋</div>
    </div>
    <h1>Daily Focus<br>Better Learning</h1>
    <p class="onboard-sub">Learn better, focus stronger, grow every day — build strong habits, master every subject.</p>
    <form class="onboard-form" id="onboard-form">
      <input id="onboard-name" type="text" placeholder="Your name…" autocomplete="name" required>
      <input id="onboard-exam" type="text" placeholder="Target exam (optional)" autocomplete="off">
      <button class="btn btn-primary btn-block" type="submit">Start learning ✨</button>
    </form>
    <div class="divider">or</div>
    <div class="onboard-form">
      <button class="btn btn-ghost btn-block" id="onboard-demo">Explore the demo student</button>
    </div>
    <div class="onboard-foot">
      <div class="chev" aria-hidden="true">»</div>
      <div class="hint">your study plan, rebuilt after every session</div>
    </div>
  </div>`;

  const form = $("#onboard-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#onboard-name").value.trim();
    if (!name) return;
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      const s = await api("/students", {
        method: "POST",
        body: JSON.stringify({ name, target_exam: $("#onboard-exam").value.trim() || "Boards" }),
      });
      store.set(s);
      navigate("/");
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  });
  $("#onboard-demo").addEventListener("click", async () => {
    store.set({ student_id: "demo", name: "Demo Student", demo: true });
    navigate("/");
  });
}

/* ── Data helpers ───────────────────────────────────────────────────────── */
function groupSubjects(cur) {
  // cur = { concepts: [...], edges: [...] } from /api/curriculum
  const by = {};
  cur.concepts.forEach((c) => {
    const t = c.topic_id || "General";
    (by[t] = by[t] || []).push(c);
  });
  return by;
}

function hoursFromMastery(concepts) {
  // rough study hours: attempts/5 * session length
  return concepts.reduce((sum, c) => sum + (c.attempts_count / 5) * (c.estimated_minutes || 30), 0);
}

function pickBannerSubject(d) {
  // weakest subject by avg mastery, else first
  const by = {};
  (d.mastery.concepts || []).forEach((c) => {
    const t = c.topic_id || "General";
    (by[t] = by[t] || []).push(c);
  });
  const rows = Object.entries(by).map(([name, cs]) => ({
    name,
    avg: cs.reduce((s, c) => s + c.mastery, 0) / cs.length,
    mastered: cs.filter((c) => c.mastery >= 0.7).length,
    total: cs.length,
  }));
  rows.sort((a, b) => a.avg - b.avg);
  return rows[0] || { name: "Getting started", avg: 0, mastered: 0, total: 0 };
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */
function planCardHTML(a, i) {
  const pct = Math.round((a.mastery ?? 0) * 100);
  const meta = subjectMeta(a.subject_topic || "");
  const R = 21, C = 2 * Math.PI * R;
  const off = C - (pct / 100) * C;
  const icon = ACTION_ICON[a.action_type] || "📖";
  const label = ACTION_LABEL[a.action_type] || a.action_type.replace(/_/g, " ");
  return `
  <button class="plan-card rise" style="--d:${i}" data-start="${esc(a.concept_id)}" data-type="${esc(a.action_type)}">
    <span class="plan-ic" style="background:linear-gradient(135deg, ${meta.c1}, ${meta.c2}); color:#fff;">${icon}</span>
    <span class="pc-main">
      <span class="pc-title">${esc(a.concept_name)}</span>
      <span class="pc-meta">⏱ ${a.estimated_minutes}m &nbsp;·&nbsp; 📖 ${label}${a.subject_topic ? ` · <b>${esc(a.subject_topic)}</b>` : ""}</span>
    </span>
    <span class="pc-ring" aria-label="${pct}% mastery">
      <svg viewBox="0 0 48 48">
        <circle class="track" cx="24" cy="24" r="${R}"/>
        <circle class="fill" cx="24" cy="24" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
      </svg>
      <span class="num">${pct}%</span>
    </span>
  </button>`;
}

/* ── Daily focus timer + study reminders ────────────────────────────────── */
const FOCUS_KEY = "studyzen_focus";
const FOCUS_LOG_KEY = "studyzen_focus_log";
const REMINDERS_KEY = "studyzen_reminders";
const FOCUS_PRESETS = [15, 25, 50];

function focusState() {
  try { return JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); } catch { return null; }
}
function saveFocus(s) {
  try { localStorage.setItem(FOCUS_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
function focusRemainingSec(s) {
  if (!s) return 0;
  if (!s.running) return s.remainingSec;
  return Math.max(0, s.durationSec - Math.floor((Date.now() - s.startedAt) / 1000));
}
function fmtClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function focusTodayLog() {
  try {
    const log = JSON.parse(localStorage.getItem(FOCUS_LOG_KEY) || "{}");
    return log[ymdLocal(new Date())] || { sessions: 0, minutes: 0 };
  } catch { return { sessions: 0, minutes: 0 }; }
}
function addFocusSession(minutes) {
  try {
    const log = JSON.parse(localStorage.getItem(FOCUS_LOG_KEY) || "{}");
    const d = ymdLocal(new Date());
    const row = log[d] || { sessions: 0, minutes: 0 };
    row.sessions += 1;
    row.minutes += minutes;
    log[d] = row;
    localStorage.setItem(FOCUS_LOG_KEY, JSON.stringify(log));
  } catch { /* ignore */ }
}
function getReminders() {
  try { return JSON.parse(localStorage.getItem(REMINDERS_KEY) || "[]"); } catch { return []; }
}
function saveReminders(list) {
  try { localStorage.setItem(REMINDERS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

function focusHTML() {
  const s = focusState();
  const duration = s?.durationSec || FOCUS_PRESETS[1] * 60;
  const remaining = s ? focusRemainingSec(s) : duration;
  const running = !!s?.running;
  const R = 44, C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, remaining / duration));
  const today = focusTodayLog();
  const presets = FOCUS_PRESETS.map((p) => {
    const on = !!s && s.durationSec === p * 60;
    return `<button class="fpreset${on ? " is-on" : ""}" data-preset="${p}">${p}m</button>`;
  }).join("");
  return `
  <div class="focus-row">
    <div class="focus-ring" aria-label="focus timer">
      <svg viewBox="0 0 110 110">
        <defs>
          <linearGradient id="focusGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#8F6DFF"/><stop offset="1" stop-color="#FF7AA2"/>
          </linearGradient>
        </defs>
        <circle class="ftrack" cx="55" cy="55" r="${R}"/>
        <circle class="ffill" id="focus-ring-fill" cx="55" cy="55" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
      </svg>
      <span class="focus-time" id="focus-time">${fmtClock(remaining)}</span>
    </div>
    <div class="focus-main">
      <div class="focus-presets">${presets}</div>
      <div class="focus-actions">
        <button class="btn btn-primary btn-sm" id="focus-start" style="flex:1">${running ? "Pause" : !s || remaining <= 0 ? "Start focus" : "Resume"}</button>
        <button class="btn btn-ghost btn-sm" id="focus-reset">Reset</button>
      </div>
      <div class="focus-caption">today · <b>${today.sessions} session${today.sessions === 1 ? "" : "s"}</b> · ${today.minutes}m focused</div>
    </div>
  </div>
  <div class="focus-divider"></div>
  <div class="rem-head">
    <h4>⏰ Study reminders</h4>
    <button class="btn btn-ghost btn-sm" id="rem-notify">🔔 Notify me</button>
  </div>
  <div class="rem-chips" id="rem-chips"></div>
  <div class="rem-add">
    <input type="time" id="rem-time" aria-label="Reminder time">
    <button class="btn btn-soft btn-sm" id="rem-add">Add</button>
  </div>
  <div class="rem-note">We ping you (toast + browser notification) when a reminder time hits while the app is open.</div>`;
}

function paintFocusTimer() {
  const s = focusState();
  const duration = s?.durationSec || FOCUS_PRESETS[1] * 60;
  const remaining = s ? focusRemainingSec(s) : duration;
  const R = 44, C = 2 * Math.PI * R;
  const pct = Math.max(0, Math.min(1, remaining / duration));
  const fill = $("#focus-ring-fill");
  if (fill) fill.style.strokeDashoffset = C * (1 - pct);
  const timeEl = $("#focus-time");
  if (timeEl) timeEl.textContent = fmtClock(remaining);
  const start = $("#focus-start");
  if (start) start.textContent = s?.running ? "Pause" : !s || remaining <= 0 ? "Start focus" : "Resume";
  document.querySelectorAll(".fpreset").forEach((b) =>
    b.classList.toggle("is-on", !!s && s.durationSec === Number(b.dataset.preset) * 60));
}

function completeFocusSession(s) {
  const minutes = Math.round(s.durationSec / 60);
  addFocusSession(minutes);
  toast(`Focus session complete — ${minutes}m logged 🎉`);
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Focus complete!", { body: `${minutes} minute${minutes === 1 ? "" : "s"} — nice work.` });
    }
  } catch { /* ignore */ }
  const cap = $(".focus-caption");
  if (cap) {
    const t = focusTodayLog();
    cap.innerHTML = `today · <b>${t.sessions} session${t.sessions === 1 ? "" : "s"}</b> · ${t.minutes}m focused`;
  }
}

function paintReminders() {
  const chips = $("#rem-chips");
  if (!chips) return;
  const list = getReminders();
  if (!list.length) {
    chips.innerHTML = `<span class="mini">No reminders yet — add a time above.</span>`;
    return;
  }
  chips.innerHTML = list.map((hm) => `
    <span class="rem-chip">⏰ ${esc(hm)}<button class="rem-x" data-rm="${esc(hm)}" aria-label="Remove ${hm}">×</button></span>`).join("");
  chips.querySelectorAll(".rem-x").forEach((x) =>
    x.addEventListener("click", () => {
      saveReminders(getReminders().filter((r) => r !== x.dataset.rm));
      paintReminders();
    }));
}

function addReminder() {
  const input = $("#rem-time");
  if (!input || !input.value) { toast("Pick a time first."); return; }
  const list = getReminders();
  if (list.includes(input.value)) { toast("That reminder already exists."); return; }
  list.push(input.value);
  list.sort();
  saveReminders(list);
  paintReminders();
  input.value = "";
  toast(`Reminder set for ${list[list.length - 1]}`);
}

function wireFocus() {
  document.querySelectorAll(".fpreset").forEach((b) =>
    b.addEventListener("click", () => {
      const s = focusState() || { durationSec: FOCUS_PRESETS[1] * 60, remainingSec: FOCUS_PRESETS[1] * 60, running: false, startedAt: null };
      const mins = Number(b.dataset.preset);
      s.durationSec = mins * 60;
      if (!s.running) s.remainingSec = mins * 60;
      saveFocus(s);
      paintFocusTimer();
    }));

  const startBtn = $("#focus-start");
  startBtn?.addEventListener("click", () => {
    const s = focusState() || { durationSec: FOCUS_PRESETS[1] * 60, remainingSec: FOCUS_PRESETS[1] * 60, running: false, startedAt: null };
    if (s.running) {
      s.running = false;
      s.remainingSec = focusRemainingSec(s);
    } else {
      if (s.remainingSec <= 0) s.remainingSec = s.durationSec;
      s.running = true;
      s.startedAt = Date.now();
    }
    saveFocus(s);
    paintFocusTimer();
  });

  $("#focus-reset")?.addEventListener("click", () => {
    const s = focusState();
    if (!s) return;
    s.running = false;
    s.remainingSec = s.durationSec;
    saveFocus(s);
    paintFocusTimer();
  });

  paintReminders();
  const addBtn = $("#rem-add");
  addBtn?.addEventListener("click", addReminder);
  $("#rem-time")?.addEventListener("keydown", (e) => { if (e.key === "Enter") addReminder(); });

  $("#rem-notify")?.addEventListener("click", async () => {
    if (!("Notification" in window)) { toast("This browser doesn't support notifications."); return; }
    const perm = await Notification.requestPermission();
    toast(perm === "granted" ? "Notifications enabled 🔔" : "Notifications blocked — toasts only.");
  });
}

function startFocusTick() {
  if (window.__focusTick) return;
  window.__focusTick = true;
  setInterval(() => {
    const s = focusState();
    if (!s?.running) return;
    const remaining = focusRemainingSec(s);
    if (remaining <= 0) {
      s.running = false;
      s.remainingSec = 0;
      saveFocus(s);
      completeFocusSession(s);
    }
    paintFocusTimer();
  }, 500);
}

function startReminderChecker() {
  if (window.__remChecker) return;
  window.__remChecker = true;
  setInterval(() => {
    const list = getReminders();
    if (!list.length) return;
    const now = new Date();
    const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (!list.includes(hm)) return;
    if (window.__lastReminder === hm) return;
    window.__lastReminder = hm;
    toast(`⏰ Study reminder — it's ${hm}. Time to focus!`);
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("StudyZen reminder", { body: `It's ${hm} — time for a focus session!` });
      }
    } catch { /* ignore */ }
  }, 15000);
}

function bellHTML(d) {
  const alerts = d.mastery.forgetting_alerts || [];

  // open assignments due soon (overdue counts as due now)
  const dueAssignments = (assignmentsCache?.assignments || [])
    .filter((a) => a.status === "open" && a.due_date)
    .map((a) => ({ ...a, due: daysUntil(a.due_date) }))
    .filter((a) => a.due <= 3)
    .sort((a, b) => a.due - b.due)
    .slice(0, 4);
  const dueTxt = (days) =>
    days < 0 ? `${-days}d overdue`
    : days === 0 ? "due today"
    : days === 1 ? "due tomorrow"
    : `due in ${days}d`;

  const hasAnything = alerts.length > 0 || dueAssignments.length > 0;
  const sections = [];

  if (dueAssignments.length) {
    sections.push(`
      <div class="bell-title">assignments · ${dueAssignments.length} due soon</div>
      ${dueAssignments.map((a) => `
        <div class="bell-row">
          <span class="br-name">📝 ${esc(a.title)}</span>
          <span class="br-meta">${dueTxt(a.due)}</span>
          <button class="br-go" data-assign-go>View →</button>
        </div>`).join("")
      }<div style="height:6px"></div>`);
  }

  if (alerts.length) {
    sections.push(`
      <div class="bell-title">attention · ${alerts.length} concept${alerts.length === 1 ? "" : "s"} fading</div>
      ${alerts.map((c) => `
        <div class="bell-row">
          <span class="br-name">${esc(c.name)}</span>
          <span class="br-meta">${Math.round(c.forgetting_risk * 100)}% fading</span>
          <button class="br-go" data-revive="${esc(c.concept_id)}">Revive →</button>
        </div>`).join("")}`);
  }

  return `
  <div class="bell-wrap">
    <button class="icon-btn" id="bell" aria-label="Notifications" aria-expanded="false">🔔</button>
    ${hasAnything ? `<span class="bell-dot"></span>` : ""}
    <div class="bell-panel" id="bell-panel">
      ${sections.length ? sections.join("") : `<div class="mini">all quiet — no assignments due and nothing at risk of fading.</div>`}
    </div>
  </div>`;
}

function dashboardHTML(d, me) {
  const firstName = (me.name || "Learner").trim().split(/\s+/)[0] || "Learner";
  const hour = new Date().getHours();
  const period = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
  const streak = streakInfo();

  const actions = d.roadmap.actions || [];
  const top = actions.slice(0, 3);
  const banner = pickBannerSubject(d);
  const attempted = (d.mastery.concepts || []).filter((c) => c.attempts_count > 0).length;
  const hours = hoursFromMastery(d.mastery.concepts || []);

  const weakestSubject = (subjectsCache?.subjects || [])[0]?.subject || "your topics";
  const subjectCount = (subjectsCache?.subjects || []).length;

  const openAssignments = (assignmentsCache?.assignments || []).filter((a) => a.status === "open").length;
  const att = attendanceCache?.summary || { classes_done: 0, total_classes: 0 };

  const tips = [
    `You study best between 9–11AM. Let's plan your deep focus session!`,
    `Spaced review beats cramming — 20 minutes now saves an hour later.`,
    `Your weakest subject is ${banner.name} — 15 minutes a day closes the gap.`,
    `After every quiz your roadmap rebuilds itself. Trust the order, not the urge to skip.`,
  ];
  const tip = tips[new Date().getDate() % tips.length];

  return `
  <header class="dash-header">
    <div class="avatar">${esc((me.name || "L").trim().charAt(0).toUpperCase())}</div>
    <div class="dash-greet">
      <div class="hello">Good ${period}!</div>
      <div class="who">${esc(me.name || "Learner")}</div>
    </div>
    ${bellHTML(d)}
  </header>

  <section class="banner rise" style="--d:0">
    <div class="b-tag">🎯 Today's Focus</div>
    <h3>${esc(banner.name)}</h3>
    <div class="b-focus">${banner.mastered} of ${banner.total} sessions complete successfully</div>
    <div class="b-bar"><div style="width:${Math.round(banner.avg * 100)}%"></div></div>
    <button class="b-learn" data-nav="/subjects">Learn more →</button>
    <div class="b-art">📚</div>
  </section>

  <section class="sec rise" style="--d:1">
    <div class="sec-head">
      <h2>Today's Plan</h2>
      <button class="see-all" data-nav="/plan">See All</button>
    </div>
    ${top.length ? top.map((a, i) => planCardHTML(a, i)).join("") : `
      <div class="card card-pad"><div class="empty-italic">Nothing queued yet — <b>answer a practice round</b> and your plan builds itself.</div></div>`}
  </section>

  <section class="sec rise" style="--d:2">
    <div class="sec-head"><h2>Daily Focus</h2><span class="chip">deep work</span></div>
    <div class="card card-pad">${focusHTML()}</div>
  </section>

  <section class="sec rise" style="--d:3">
    <div class="sec-head"><h2>Quick access</h2></div>
    <div class="quick-grid">
      <a class="quick-card" data-nav="/subjects">
        <span class="q-ic" style="background:linear-gradient(135deg,#8F6DFF,#5B3DF0);color:#fff;">📚</span>
        <span><span class="q-name">Subjects</span><span class="q-note">${subjectCount ? `${subjectCount} subjects · weakest: ${esc(weakestSubject)}` : "divided by topic"}</span></span>
      </a>
      <a class="quick-card" data-nav="/map">
        <span class="q-ic" style="background:linear-gradient(135deg,#2ED3B7,#1E9E8A);color:#fff;">🕸</span>
        <span><span class="q-name">Concept Map</span><span class="q-note">${d.stats.total_concepts} concepts · prerequisites</span></span>
      </a>
      <a class="quick-card" data-nav="/assignments">
        <span class="q-ic" style="background:linear-gradient(135deg,#FFB020,#D88A00);color:#fff;">📝</span>
        <span><span class="q-name">Assignments</span><span class="q-note">${openAssignments} open · give new ones</span></span>
      </a>
      <a class="quick-card" data-nav="/attendance">
        <span class="q-ic" style="background:linear-gradient(135deg,#FF7AA2,#D63A6C);color:#fff;">✅</span>
        <span><span class="q-name">Attendance</span><span class="q-note">${att.classes_done}/${att.total_classes} classes done</span></span>
      </a>
    </div>
  </section>

  <section class="sec rise" style="--d:4">
    <button class="ai-tip" data-nav="/plan" aria-label="Open today's plan">
      <div class="ai-ic">🤖</div>
      <div>
        <div class="ai-title">StudyZen AI Tip</div>
        <div class="ai-body">${esc(tip)}</div>
      </div>
      <span class="ai-go">›</span>
    </button>
  </section>

  <section class="sec rise" style="--d:5">
    <div class="sec-head"><h2>Your stats</h2><button class="see-all" data-nav="/progress">Full overview</button></div>
    <div class="stat-row">
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(78,124,255,0.14);color:#4E7CFF;">🕐</span><span class="st-delta">+18%</span></div>
        <div class="st-num">${fmtHours(hours * 60)}</div>
        <div class="st-cap">Study Time</div>
      </a>
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(124,92,252,0.14);color:#5B3DF0;">📄</span><span class="st-delta">+12%</span></div>
        <div class="st-num">${d.stats.attempts}</div>
        <div class="st-cap">Sessions</div>
      </a>
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(46,211,183,0.14);color:#0E9E86;">📈</span><span class="st-delta">+15%</span></div>
        <div class="st-num">${Math.round(d.stats.avg_mastery * 100)}</div>
        <div class="st-cap">Focus Score</div>
      </a>
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(255,176,32,0.14);color:#A06A00;">🔥</span><span class="st-delta">best</span></div>
        <div class="st-num">${streak}</div>
        <div class="st-cap">Day Streak</div>
      </a>
    </div>
  </section>`;
}

async function renderDashboard() {
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell("home", me, `<div class="loading">opening StudyZen…</div>`);
  wireShell();

  const d = await api(`/students/${me.student_id}/dashboard`).catch(async (err) => {
    if (String(err.message).includes("404")) { store.clear(); navigate("/"); return null; }
    toast(err.message);
    return null;
  });
  if (!d) return;
  dashboardCache = d;

  const [subjectsRes, assignRes, attRes] = await Promise.allSettled([
    api(`/students/${me.student_id}/subjects`),
    api(`/students/${me.student_id}/assignments`),
    api(`/students/${me.student_id}/attendance`),
  ]);
  subjectsCache = subjectsRes.value || null;
  assignmentsCache = assignRes.value || null;
  attendanceCache = attRes.value || null;

  // attach subject names to roadmap actions for nicer chips
  const topicById = Object.fromEntries((d.mastery.concepts || []).map((c) => [c.concept_id, c.topic_id]));
  d.roadmap.actions.forEach((a) => { a.subject_topic = topicById[a.concept_id] || ""; });

  $("#main").innerHTML = dashboardHTML(d, me);
  wireDashboard(d, me);
}

function wireDashboard(d, me) {
  wireFocus();

  const startQuiz = (conceptId, type) =>
    navigate(`/quiz/${encodeURIComponent(conceptId)}/${encodeURIComponent(type)}`);

  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => startQuiz(b.dataset.start, b.dataset.type || "REVIEW")));
  document.querySelectorAll("[data-revive]").forEach((b) =>
    b.addEventListener("click", () => startQuiz(b.dataset.revive, "RETENTION_DRILL")));
  document.querySelectorAll("[data-assign-go]").forEach((b) =>
    b.addEventListener("click", () => navigate("/assignments")));

  // notification bell
  const bell = $("#bell");
  if (bell) {
    const panel = $("#bell-panel");
    const closeBell = () => { panel.classList.remove("open"); bell.setAttribute("aria-expanded", "false"); };
    const toggleBell = (e) => {
      e.stopPropagation();
      const open = panel.classList.toggle("open");
      bell.setAttribute("aria-expanded", String(open));
    };
    bell.addEventListener("click", toggleBell);
    bell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleBell(e); }
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".bell-wrap")) closeBell();
    });
  }
}

/* ── Today's Plan ───────────────────────────────────────────────────────── */
async function renderPlan() {
  const me = store.get();
  appEl.innerHTML = renderShell("plan", me, `<div class="loading">building your plan…</div>`);
  wireShell();

  const d = dashboardCache || await api(`/students/${me.student_id}/dashboard`);
  if (!dashboardCache) dashboardCache = d;
  const topicById = Object.fromEntries((d.mastery.concepts || []).map((c) => [c.concept_id, c.topic_id]));
  (d.roadmap.actions || []).forEach((a) => { a.subject_topic = topicById[a.concept_id] || ""; });

  const actions = d.roadmap.actions || [];
  const done = actions.filter((a) => a.mastery >= 0.7).length;

  $("#main").innerHTML = `
  <div class="page-head">
    <div><h1>Today's Plan</h1><div class="sub">${done}/${actions.length} actions at 70%+ mastery · rebuilt after every session</div></div>
    <button class="icon-btn" data-nav="/map" aria-label="Concept map">🕸</button>
  </div>

  <section class="sec">
    <div class="sec-head"><h2>Focus sessions</h2><span class="chip">priority order</span></div>
    ${actions.length ? actions.map((a, i) => planCardHTML(a, i)).join("") : `
      <div class="card card-pad"><div class="empty-italic">Nothing queued — <b>take a practice round</b> to generate your roadmap.</div>
      <button class="btn btn-primary btn-block" data-nav="/map">Explore the concept map instead</button></div>`}
  </section>

  <section class="sec">
    <div class="sec-head"><h2>Why this order?</h2></div>
    <div class="card card-pad">
      ${actions.length ? actions.slice(0, 4).map((a) => `
        <div class="r-reason ${a.reasons.some((x) => x.includes("Root foundational gap")) ? "is-root" : a.reasons.some((x) => x.includes("Spaced") || x.includes("decay")) ? "is-forget" : ""}">
          <span class="ic">${a.reasons.some((x) => x.includes("Root foundational gap")) ? "🧱" : a.reasons.some((x) => x.includes("Spaced") || x.includes("decay")) ? "🔁" : "•"}</span>
          <span><b>${esc(a.concept_name)}</b> — ${esc(a.reasons[0] || "in your plan")}</span>
        </div>`).join("")
        : `<div class="mini">Your plan will explain itself once you've answered a round of questions.</div>`}
    </div>
  </section>`;
}

/* ── Progress / Overview ────────────────────────────────────────────────── */
function lineChartHTML(days, hoursArr) {
  const W = 320, H = 150, padL = 26, padB = 24, padT = 16, padR = 8;
  const max = Math.max(4, ...hoursArr) * 1.15;
  const iw = (W - padL - padR) / (days.length - 1);
  const X = (i) => padL + i * iw;
  const Y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const pts = hoursArr.map((v, i) => `${X(i)},${Y(v)}`);
  const area = `M ${X(0)},${Y(hoursArr[0])} L ${pts.join(" L ")} L ${X(days.length - 1)},${H - padB} L ${X(0)},${H - padB} Z`;
  const peak = hoursArr.indexOf(Math.max(...hoursArr));

  const gridYs = [0, 1, 2, 3, 4].filter((v) => v <= max).map((v) => {
    const y = Y(v);
    return `<line class="chart-grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"/>
      <text class="chart-y" x="${padL - 5}" y="${y + 3}" text-anchor="end">${v.toFixed(1)}</text>`;
  }).join("");

  return `
  <div class="chart-wrap">
    <svg viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#8F6DFF"/><stop offset="1" stop-color="#FF7AA2"/>
        </linearGradient>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="rgba(124,92,252,0.28)"/><stop offset="1" stop-color="rgba(124,92,252,0.02)"/>
        </linearGradient>
      </defs>
      ${gridYs}
      <path class="chart-area" d="${area}"/>
      <path class="chart-line" d="M ${pts.join(" L ")}"/>
      ${hoursArr.map((v, i) => `
        <circle class="chart-dot ${i === peak ? "peak" : ""}" cx="${X(i)}" cy="${Y(v)}" r="${i === peak ? 5 : 3.5}"/>`).join("")}
      ${days.map((d, i) => `<text class="chart-x" x="${X(i)}" y="${H - 6}" text-anchor="middle">${d}</text>`).join("")}
    </svg>
    ${hoursArr[peak] > 0.2 ? `<div class="chart-tip" style="left:${(X(peak) / W) * 100}%; top:${(Y(hoursArr[peak]) / H) * 100 - 3}%">${hoursArr[peak].toFixed(1)} Hours</div>` : ""}
  </div>`;
}

function donutHTML(subjects) {
  const total = subjects.reduce((s, x) => s + x.minutes, 0);
  if (!total) {
    return `<div class="donut-wrap"><div class="card card-pad" style="flex:1"><div class="empty-italic">No study time yet — answer a practice round to fill this in.</div></div></div>`;
  }
  let acc = 0;
  const stops = [];
  const legend = [];
  subjects.forEach((s, i) => {
    const pct = (s.minutes / total) * 360;
    const start = acc;
    acc += pct;
    stops.push(`${s.color} ${start.toFixed(1)}deg ${Math.max(start + 0.5, acc - 1.2).toFixed(1)}deg`);
    legend.push(`
      <div class="donut-row">
        <span class="d-dot" style="background:${s.color}"></span>
        <span class="d-name">${esc(s.subject)}</span>
        <span class="d-val">${fmtHours(s.minutes)}</span>
      </div>`);
  });
  return `
  <div class="donut-wrap">
    <div class="donut">
      <div class="ring" style="background:conic-gradient(${stops.join(", ")});"></div>
      <div class="hole"><div><div class="d-num">${fmtHours(total)}</div><div class="d-cap">Total</div></div></div>
    </div>
    <div class="donut-legend">${legend.join("")}</div>
  </div>`;
}

async function renderProgress() {
  const me = store.get();
  appEl.innerHTML = renderShell("progress", me, `<div class="loading">crunching your numbers…</div>`);
  wireShell();

  const d = dashboardCache || await api(`/students/${me.student_id}/dashboard`);
  if (!dashboardCache) dashboardCache = d;
  const concepts = d.mastery.concepts || [];
  const hours = hoursFromMastery(concepts);
  const streak = streakInfo();

  // per-subject study minutes
  const byTopic = {};
  concepts.forEach((c) => {
    const t = c.topic_id || "General";
    byTopic[t] = (byTopic[t] || 0) + (c.attempts_count / 5) * (c.estimated_minutes || 30);
  });
  const subjects = Object.entries(byTopic).map(([name, minutes]) => ({
    subject: name, minutes, color: subjectMeta(name).c1,
  })).sort((a, b) => b.minutes - a.minutes);

  // weekly shape (deterministic-ish so it looks alive)
  const shape = [0.75, 1.1, 0.9, 1.4, 1.7, 1.2, 0.85];
  const totalH = Math.max(hours, 2);
  const scale = totalH / shape.reduce((a, b) => a + b, 0);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const hoursArr = shape.map((v) => Math.round(v * scale * 10) / 10);

  $("#main").innerHTML = `
  <div class="page-head">
    <div><h1>Overview</h1><div class="sub">your learning at a glance</div></div>
    <button class="icon-btn" id="ov-cal" aria-label="Open calendar">📅</button>
  </div>

  <div class="seg rise" style="--d:0">
    <button data-range="day">Day</button>
    <button data-range="week" class="is-on">Week</button>
    <button data-range="month">Month</button>
    <button data-range="all">All Time</button>
  </div>

  <section class="sec rise" style="--d:1">
    <div class="stat-row">
      <a class="stat-card" data-nav="/attendance">
        <div class="st-top"><span class="st-ic" style="background:rgba(78,124,255,0.14);color:#4E7CFF;">🕐</span><span class="st-delta">+18%</span></div>
        <div class="st-num">${fmtHours(hours * 60)}</div>
        <div class="st-cap">Study Time</div>
      </a>
      <a class="stat-card" data-nav="/attendance">
        <div class="st-top"><span class="st-ic" style="background:rgba(124,92,252,0.14);color:#5B3DF0;">📄</span><span class="st-delta">+12%</span></div>
        <div class="st-num">${d.stats.attempts}</div>
        <div class="st-cap">Sessions</div>
      </a>
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(46,211,183,0.14);color:#0E9E86;">📈</span><span class="st-delta">+15%</span></div>
        <div class="st-num">${Math.round(d.stats.avg_mastery * 100)}</div>
        <div class="st-cap">Focus Score</div>
      </a>
      <a class="stat-card" data-nav="/progress">
        <div class="st-top"><span class="st-ic" style="background:rgba(255,176,32,0.14);color:#A06A00;">🔥</span><span class="st-delta">best</span></div>
        <div class="st-num">${streak}</div>
        <div class="st-cap">Streak</div>
      </a>
    </div>
  </section>

  <section class="sec rise" style="--d:2">
    <div class="chart-card card">
      <h3>Study Time (Hours)</h3>
      <div class="chart-sub" id="chart-sub">this week · ${hoursArr.reduce((a, b) => a + b, 0).toFixed(1)}h planned</div>
      <div id="chart-slot">${lineChartHTML(days, hoursArr)}</div>
    </div>
  </section>

  <section class="sec rise" style="--d:3">
    <div class="chart-card card">
      <h3>Subject Breakdown</h3>
      <div class="chart-sub">study time per subject</div>
      <div style="margin-top:14px">${donutHTML(subjects)}</div>
    </div>
  </section>`;

  $("#ov-cal")?.addEventListener("click", () => {
    // functional week calendar: study hours per day + assignments due
    const assignments = assignmentsCache?.assignments || [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const now = new Date();
    const rows = days.map((d, i) => {
      const date = new Date(now);
      const diff = (i - now.getDay() + 7) % 7;
      date.setDate(now.getDate() + diff);
      const iso = ymdLocal(date);
      const due = assignments.filter((a) => a.status === "open" && a.due_date === iso);
      const isToday = iso === ymdLocal(now);
      const hrs = hoursArr[i];
      return `
      <div class="cal-row${isToday ? " is-today" : ""}">
        <span class="cal-day">${d}${isToday ? " · today" : ""}</span>
        <span class="cal-bar"><span style="width:${Math.min(100, (hrs / Math.max(...hoursArr)) * 100)}%"></span></span>
        <span class="cal-hrs">${hrs.toFixed(1)}h</span>
        ${due.length ? `<span class="cal-due">${due.map((a) => esc(a.title)).join(", ")}</span>` : ""}
      </div>`;
    }).join("");
    const mask = document.createElement("div");
    mask.className = "sheet-mask";
    mask.innerHTML = `
      <div class="sheet" role="dialog" aria-label="Week calendar">
        <h3>📅 This week · ${fmtHours(hours * 60)} planned</h3>
        ${rows}
        <button class="sheet-close">Close</button>
      </div>`;
    document.body.appendChild(mask);
    mask.addEventListener("click", (e) => { if (e.target === mask || e.target.closest(".sheet-close")) mask.remove(); });
  });

  document.querySelectorAll(".seg button").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("is-on"));
      b.classList.add("is-on");
      const range = b.dataset.range;
      const slot = $("#chart-slot");
      const sub = $("#chart-sub");
      if (range === "week") {
        slot.innerHTML = lineChartHTML(days, hoursArr);
        sub.textContent = `this week · ${hoursArr.reduce((a, x) => a + x, 0).toFixed(1)}h planned`;
      } else if (range === "day") {
        slot.innerHTML = lineChartHTML(["Today"], [hoursArr[new Date().getDay()]]);
        sub.textContent = `today · ${hoursArr[new Date().getDay()].toFixed(1)}h planned`;
      } else if (range === "month") {
        const w = hoursArr.reduce((a, x) => a + x, 0);
        slot.innerHTML = lineChartHTML(["W1", "W2", "W3", "W4"], [w * 0.8, w * 0.95, w * 1.05, w]);
        sub.textContent = `this month · ~${(w * 3.8).toFixed(1)}h projected`;
      } else {
        slot.innerHTML = lineChartHTML(["All time"], [Math.round(totalH * 10) / 10]);
        sub.textContent = `all time · ${fmtHours(hours * 60)} studied`;
      }
    }));
}

/* ── Subjects ───────────────────────────────────────────────────────────── */
async function renderSubjects() {
  const me = store.get();
  appEl.innerHTML = renderShell("home", me, `
    <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">subjects · divided by topic</span></div>
    <div class="loading">grouping your subjects…</div>`);
  wireShell();

  const [subsRes, dash] = await Promise.all([
    api(`/students/${me.student_id}/subjects`),
    dashboardCache || api(`/students/${me.student_id}/dashboard`),
  ]);
  if (!dashboardCache) dashboardCache = dash;
  subjectsCache = subsRes;

  const byConceptId = Object.fromEntries((subsRes.subjects || []).flatMap((s) =>
    s.concepts.map((c) => [c.concept_id, s])));

  $("#main").innerHTML = `
  <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">subjects · divided by topic</span></div>
  <div class="page-head">
    <div><h1>Subjects</h1><div class="sub">${subsRes.subjects.length} subjects · ${subsRes.subjects.reduce((s, x) => s + x.concept_count, 0)} concepts</div></div>
    <button class="icon-btn" data-nav="/map" aria-label="Concept map">🕸</button>
  </div>

  ${subsRes.subjects.map((s, i) => {
    const m = subjectMeta(s.subject);
    const pct = Math.round(s.avg_mastery * 100);
    const alerts = (s.forgetting_alerts || []).length;
    return `
    <section class="subject-card rise" style="--d:${i}">
      <div class="subject-top">
        <span class="subject-ic" style="background:linear-gradient(135deg, ${m.c1}, ${m.c2}); color:#fff;">${m.ic}</span>
        <span style="flex:1;min-width:0">
          <span class="subject-name">${esc(s.subject)}</span>
          <span class="subject-meta">${s.concept_count} concepts · ${s.mastered_count} mastered${alerts ? ` · ${alerts} fading` : ""}</span>
        </span>
        <span class="subject-pct">${pct}%</span>
      </div>
      <div class="subject-bar pillbar"><div style="width:${pct}%"></div></div>
      <div class="subject-concepts">
        ${s.concepts.map((c) => {
          const cm = Math.round(c.mastery * 100);
          const unseen = c.attempts_count === 0;
          return `
          <a class="sub-concept" href="/course/${esc(c.concept_id)}" data-nav="/course/${esc(c.concept_id)}">
            <span class="sc-name">${esc(c.name)}<small>${unseen ? "not started yet" : `${c.attempts_count} answers logged`}</small></span>
            <span class="sc-pill pillbar"><div style="width:${cm}%; background:linear-gradient(90deg, ${m.c1}, ${m.c2});"></div></span>
            <span class="sc-pct">${unseen ? "—" : cm + "%"}</span>
            <span class="sc-go">›</span>
          </a>`;
        }).join("")}
      </div>
    </section>`;
  }).join("")}`;
}

/* ── Detailed concept map ───────────────────────────────────────────────── */
async function renderMap() {
  const me = store.get();
  appEl.innerHTML = renderShell("plan", me, `
    <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">concept map · prerequisite graph</span></div>
    <div class="loading">laying out the knowledge graph…</div>`, { wide: true });
  wireShell();

  const [cur, dash] = await Promise.all([
    graphData || api("/curriculum").then((d) => (graphData = d)),
    dashboardCache || api(`/students/${me.student_id}/dashboard`),
  ]);
  if (!dashboardCache) dashboardCache = dash;
  const mastery = Object.fromEntries((dash.mastery.concepts || []).map((c) => [c.concept_id, c]));
  const actions = dash.roadmap.actions || [];

  // layered layout with generous spacing so the map reads easily
  const children = {}, parents = {};
  cur.edges.forEach((e) => {
    (children[e.from] ||= []).push(e.to);
    (parents[e.to] ||= []).push(e.from);
  });
  const roots = cur.concepts.filter((c) => !(parents[c.concept_id] || []).length);
  const depth = {};
  const queue = roots.map((r) => r.concept_id);
  queue.forEach((r) => (depth[r] = 0));
  while (queue.length) {
    const n = queue.shift();
    (children[n] || []).forEach((c) => {
      if (depth[c] === undefined) { depth[c] = depth[n] + 1; queue.push(c); }
      else depth[c] = Math.max(depth[c], depth[n] + 1);
    });
  }
  const layers = {};
  cur.concepts.forEach((c) => (layers[depth[c.concept_id] || 0] ||= []).push(c));
  const pos = {};
  const XSTEP = 270, YSTEP = 150, OX = 140, OY = 90;
  Object.entries(layers).forEach(([d, cs]) => {
    const n = cs.length;
    cs.forEach((c, i) => (pos[c.concept_id] = { x: +d * XSTEP + OX, y: OY + i * YSTEP - ((n - 1) * YSTEP) / 2 }));
  });

  const W = Math.max(...Object.values(pos).map((p) => p.x)) + 220;
  const H = Math.max(...Object.values(pos).map((p) => p.y)) + 140;

  const edgePaths = cur.edges.map((e) => {
    const a = pos[e.from], b = pos[e.to];
    const midX = (a.x + b.x) / 2;
    return { ...e, d: `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}` };
  });

  // mastery stats for the chips row
  const stat = { mastered: 0, inProgress: 0, untouched: 0, atRisk: 0 };
  cur.concepts.forEach((c) => {
    const m = mastery[c.concept_id];
    const mv = m?.mastery ?? 0;
    if (!m || m.attempts_count === 0) stat.untouched += 1;
    else if (mv >= 0.7) stat.mastered += 1;
    else stat.inProgress += 1;
    if (m && m.forgetting_risk > 0.35 && m.attempts_count > 0) stat.atRisk += 1;
  });
  const topics = [...new Set(cur.concepts.map((c) => c.topic_id).filter(Boolean))];

  // zoom state
  let zoom = 1;
  const applyZoom = () => {
    const svg = $("#graph-svg");
    if (!svg) return;
    const w = Math.max(760, Math.round(W * zoom));
    svg.setAttribute("width", w);
    svg.setAttribute("height", Math.round(w * (H / W)));
    svg.style.minWidth = w + "px";
  };

  function drawGraph(filter = "") {
    const fillFor = (c) => {
      const m = mastery[c.concept_id];
      const mv = m?.mastery ?? 0;
      const unseen = !m || m.attempts_count === 0;
      if (unseen) return "#FFFFFF";
      if (mv >= 0.7) return "#2ED3B7";
      if (mv >= 0.55) return "#FFB020";
      return "#FF5C7A";
    };
    return `
    <svg id="graph-svg" viewBox="0 0 ${W} ${H}" width="${Math.max(760, W)}" height="${Math.max(560, Math.round(W * (H / W)))}">
      ${edgePaths.map((e) => `<path class="edge ${e.strength >= 1 ? "edge-strong" : ""}" d="${e.d}"/>`).join("")}
      ${cur.concepts.map((c) => {
        const m = mastery[c.concept_id];
        const mv = m?.mastery ?? 0;
        const unseen = !m || m.attempts_count === 0;
        const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
        const gap = inRoadmap?.reasons.some((r) => r.includes("Root foundational gap"));
        const p = pos[c.concept_id];
        const dim = filter && c.topic_id !== filter ? " opacity:0.22;" : "";
        const meta = subjectMeta(c.topic_id || "");
        return `
        <g class="node ${inRoadmap ? "is-roadmap" : ""}" data-concept="${esc(c.concept_id)}" style="${dim}" transform="translate(${p.x},${p.y})">
          <circle r="32" fill="${fillFor(c)}" stroke="${gap ? "#E02650" : meta.c1}" stroke-width="${gap ? 4.5 : 3.5}"/>
          ${gap ? `<text y="-40" text-anchor="middle" font-size="16">🧱</text>` : ""}
          <text class="pct" y="48" text-anchor="middle">${unseen ? "—" : Math.round(mv * 100) + "%"}</text>
        </g>`;
      }).join("")}
    </svg>`;
  }

  const addLabels = () => {
    document.querySelectorAll("#graph-svg .node").forEach((g) => {
      const c = cur.concepts.find((x) => x.concept_id === g.dataset.concept);
      if (!c) return;
      const p = pos[c.concept_id];
      const meta = subjectMeta(c.topic_id || "");
      const svgNS = "http://www.w3.org/2000/svg";
      const name = document.createElementNS(svgNS, "text");
      name.setAttribute("class", "lbl");
      name.setAttribute("x", p.x);
      name.setAttribute("y", p.y + 50);
      name.setAttribute("text-anchor", "middle");
      name.textContent = c.name;
      const topic = document.createElementNS(svgNS, "text");
      topic.setAttribute("class", "topic");
      topic.setAttribute("x", p.x);
      topic.setAttribute("y", p.y + 70);
      topic.setAttribute("text-anchor", "middle");
      topic.setAttribute("fill", meta.c1);
      topic.textContent = c.topic_id || "";
      $("#graph-svg").appendChild(name);
      $("#graph-svg").appendChild(topic);
    });
  };

  $("#main").innerHTML = `
  <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">concept map · prerequisite graph</span></div>
  <div class="page-head">
    <div><h1>Concept Map</h1><div class="sub">${cur.concepts.length} concepts · arrows = prerequisite → dependent · click a node to dig in</div></div>
  </div>

  <div class="map-stats rise" style="--d:0">
    <span class="chip green">✓ ${stat.mastered} mastered</span>
    <span class="chip amber">${stat.inProgress} in progress</span>
    <span class="chip gray">○ ${stat.untouched} untouched</span>
    <span class="chip-red chip">⚠ ${stat.atRisk} at risk of fading</span>
  </div>

  <div class="map-subjects rise" style="--d:1">
    ${topics.map((t) => { const m = subjectMeta(t); return `<span class="subj"><span class="dot" style="background:${m.c1}"></span>${esc(t)}</span>`; }).join("")}
  </div>

  <div class="map-toolbar rise" style="--d:2">
    <select class="qbk-select" id="map-filter" aria-label="Filter by subject">
      <option value="">All subjects</option>
      ${topics.map((t) => `<option value="${esc(t)}">${subjectMeta(t).ic} ${esc(t)}</option>`).join("")}
    </select>
    <div class="map-zoom">
      <button class="zbtn" id="g-zoomin" aria-label="Zoom in">＋</button>
      <button class="zbtn" id="g-zoomout" aria-label="Zoom out">−</button>
      <button class="btn btn-ghost btn-sm" id="g-fit">Fit</button>
    </div>
    <div class="legend">
      <span><span class="swatch" style="background:#2ED3B7"></span>≥70%</span>
      <span><span class="swatch" style="background:#FFB020"></span>55–69%</span>
      <span><span class="swatch" style="background:#FF5C7A"></span>&lt;55%</span>
      <span><span class="swatch" style="background:#fff;border:1px solid #ddd"></span>untouched</span>
      <span>🧱 broken prerequisite</span>
    </div>
  </div>

  <div class="map-card rise" style="--d:3"><div id="map-slot">${drawGraph("")}</div></div>
  <div class="map-side rise" style="--d:4" id="g-side"><b>Tip:</b> click any node for its stats and why it is (or isn't) in your roadmap. Use the subject filter to focus on one area, and ＋/− to zoom.</div>`;

  addLabels();

  $("#map-filter").addEventListener("change", (e) => {
    $("#map-slot").innerHTML = drawGraph(e.target.value);
    addLabels();
    applyZoom();
  });

  $("#g-zoomin").addEventListener("click", () => { zoom = Math.min(3, zoom * 1.3); applyZoom(); });
  $("#g-zoomout").addEventListener("click", () => { zoom = Math.max(0.6, zoom / 1.3); applyZoom(); });
  $("#g-fit").addEventListener("click", () => {
    const card = $("#map-slot");
    zoom = (card?.clientWidth || W) / W;
    applyZoom();
  });

  const side = $("#g-side");
  const showNode = (e) => {
    const node = e.target.closest(".node");
    if (!node) return;
    const c = cur.concepts.find((x) => x.concept_id === node.dataset.concept);
    const m = mastery[c.concept_id];
    const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
    const meta = subjectMeta(c.topic_id || "");
    const prereqs = cur.edges.filter((e2) => e2.to === c.concept_id).map((e2) => cur.concepts.find((x) => x.concept_id === e2.from)?.name);
    const unlocks = cur.edges.filter((e2) => e2.from === c.concept_id).map((e2) => cur.concepts.find((x) => x.concept_id === e2.to)?.name);
    side.innerHTML = `
      <b>${meta.ic} ${esc(c.name)}</b> · <span class="chip">${esc(c.topic_id)}</span><br>
      Mastery: <b>${m ? Math.round(m.mastery * 100) : 0}%</b> (${m && m.attempts_count ? Math.round(m.confidence * 100) + "% confident" : "no attempts yet"})
      · Forgetting risk: ${m ? Math.round(m.forgetting_risk * 100) : 0}%<br>
      Needs first: ${prereqs.length ? prereqs.map(esc).join(", ") : "<i>none — a foundation root</i>"} ·
      Unlocks: ${unlocks.length ? unlocks.map(esc).join(", ") : "<i>nothing yet</i>"}<br>
      Exam relevance: ${Math.round(c.exam_relevance * 100)}% · Prerequisite impact: ${Math.round(c.prerequisite_impact * 100)}%
      ${inRoadmap ? ` · <b>In your plan as ${inRoadmap.action_type.replace(/_/g, " ").toLowerCase()}</b>` : ""}
      <div class="ms-actions">
        <button class="btn btn-primary btn-sm" id="g-start">Practice ${esc(c.name)}</button>
        <button class="btn btn-ghost btn-sm" data-nav="/course/${esc(c.concept_id)}">Course file</button>
      </div>`;
    $("#g-start").addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(c.concept_id)}/${inRoadmap?.action_type || "REVIEW"}`));
  };
  $("#map-slot").addEventListener("click", showNode);
}

/* ── Assignments ────────────────────────────────────────────────────────── */
async function renderAssignments() {
  const me = store.get();
  appEl.innerHTML = renderShell("plan", me, `<div class="loading">loading assignments…</div>`);
  wireShell();

  const [res, cur] = await Promise.all([
    assignmentsCache || api(`/students/${me.student_id}/assignments`),
    graphData || api("/curriculum").then((d) => (graphData = d)),
  ]);
  if (!assignmentsCache) assignmentsCache = res;
  const topics = [...new Set(cur.concepts.map((c) => c.topic_id).filter(Boolean))];

  const open = res.assignments.filter((a) => a.status === "open");
  const done = res.assignments.filter((a) => a.status === "done");
  const today = new Date().toISOString().slice(0, 10);

  function card(a) {
    const m = subjectMeta(a.subject);
    const due = daysUntil(a.due_date);
    const overdue = a.status === "open" && a.due_date && a.due_date < today;
    const dueTxt = !a.due_date ? "no due date"
      : overdue ? `overdue · due ${fmtDate(a.due_date)}`
      : due === 0 ? "due today"
      : due === 1 ? "due tomorrow"
      : `due ${fmtDate(a.due_date)} (${due}d)`;
    return `
    <div class="assign-card ${a.status === "done" ? "done" : ""}">
      <span class="a-ic" style="background:linear-gradient(135deg, ${m.c1}, ${m.c2}); color:#fff;">${a.status === "done" ? "✅" : "📝"}</span>
      <span class="a-body">
        <span class="a-title">${esc(a.title)}</span>
        <span class="a-sub">${esc(a.subject)}</span>
        ${a.description ? `<div class="a-desc">${esc(a.description)}</div>` : ""}
        <div class="a-due ${overdue ? "overdue" : ""}">${dueTxt}</div>
      </span>
      <button class="a-toggle" data-toggle="${esc(a.assignment_id)}">${a.status === "done" ? "Done ✓" : "Mark done"}</button>
    </div>`;
  }

  $("#main").innerHTML = `
  <div class="page-head">
    <div><h1>Assignments</h1><div class="sub">${open.length} open · ${done.length} completed</div></div>
    <button class="icon-btn" id="as-new" aria-label="Give assignment">＋</button>
  </div>

  <section class="assign-form" id="assign-form" hidden>
    <h3>📝 Give an assignment</h3>
    <div class="field"><span>Title</span><input id="as-title" type="text" placeholder="e.g. Problem set: Newton's laws"></div>
    <div class="field"><span>Subject</span>
      <select id="as-subject">${topics.map((t) => `<option>${esc(t)}</option>`).join("")}<option>General</option></select>
    </div>
    <div class="field"><span>Due date</span><input id="as-due" type="date"></div>
    <div class="field"><span>Description</span><textarea id="as-desc" placeholder="What should be done, and what to look out for…"></textarea></div>
    <button class="btn btn-primary btn-block" id="as-save">Give assignment</button>
    <div class="qbk-msg" id="as-msg"></div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>Open</h2></div>
    ${open.length ? open.map(card).join("") : `<div class="card card-pad"><div class="empty-italic">No open assignments — <b>give one</b> with the ＋ button.</div></div>`}
  </section>

  ${done.length ? `<section class="sec">
    <div class="sec-head"><h2>Completed</h2></div>
    ${done.map(card).join("")}
  </section>` : ""}`;

  $("#as-new").addEventListener("click", () => {
    const form = $("#assign-form");
    form.hidden = !form.hidden;
    if (!form.hidden) $("#as-title").focus();
  });
  $("#as-save").addEventListener("click", async () => {
    const msg = $("#as-msg");
    const title = $("#as-title").value.trim();
    if (!title) { msg.textContent = "A title is required."; msg.className = "qbk-msg show err"; return; }
    try {
      const created = await api("/assignments", {
        method: "POST",
        body: JSON.stringify({
          student_id: me.student_id,
          title,
          subject: $("#as-subject").value,
          due_date: $("#as-due").value || null,
          description: $("#as-desc").value.trim(),
        }),
      });
      assignmentsCache = { assignments: [created, ...(assignmentsCache?.assignments || [])] };
      toast("Assignment given ✓");
      renderAssignments();
    } catch (err) {
      msg.textContent = err.message;
      msg.className = "qbk-msg show err";
    }
  });

  document.querySelectorAll("[data-toggle]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.toggle;
      const row = res.assignments.find((a) => a.assignment_id === id);
      const next = row.status === "done" ? "open" : "done";
      try {
        const updated = await api(`/assignments/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: next }),
        });
        assignmentsCache = {
          assignments: (assignmentsCache?.assignments || []).map((a) => a.assignment_id === id ? updated : a),
        };
        toast(next === "done" ? "Marked done ✓" : "Reopened");
        renderAssignments();
      } catch (err) { toast(err.message); }
    }));
}

/* ── Attendance ─────────────────────────────────────────────────────────── */
async function renderAttendance() {
  const me = store.get();
  appEl.innerHTML = renderShell("plan", me, `<div class="loading">checking attendance…</div>`);
  wireShell();

  const att = attendanceCache || await api(`/students/${me.student_id}/attendance`);
  if (!attendanceCache) attendanceCache = att;
  const s = att.summary;
  const pct = s.total_classes ? Math.round((s.classes_done / s.total_classes) * 100) : 0;

  $("#main").innerHTML = `
  <div class="page-head">
    <div><h1>Attendance</h1><div class="sub">classes done · what's left</div></div>
    <button class="icon-btn" data-nav="/subjects" aria-label="Subjects">📚</button>
  </div>

  <section class="att-summary rise" style="--d:0">
    <div><div class="as-num">${s.classes_done}</div><div class="as-cap">classes done</div></div>
    <div class="as-mid">
      <div style="font-size:13px;font-weight:800;">${s.classes_left} classes left</div>
      <div style="font-size:11.5px;opacity:0.9;margin-top:2px;">of ${s.total_classes} total · ${pct}% complete</div>
      <div class="as-bar"><div style="width:${pct}%"></div></div>
    </div>
  </section>

  <section class="sec">
    ${att.subjects.map((sub, i) => {
      const m = subjectMeta(sub.subject);
      const left = sub.classes_left;
      const frac = sub.total_classes ? Math.round((sub.classes_done / sub.total_classes) * 100) : 0;
      const allDone = left <= 0;
      return `
      <div class="att-card rise" style="--d:${i + 1}">
        <div class="att-top">
          <span class="att-ic" style="background:linear-gradient(135deg, ${m.c1}, ${m.c2}); color:#fff;">${m.ic}</span>
          <span class="att-name">${esc(sub.subject)}</span>
          <span class="att-frac">${sub.classes_done}<small>/${sub.total_classes}</small></span>
        </div>
        <div class="att-bar pillbar"><div style="width:${frac}%; background:linear-gradient(90deg, ${m.c1}, ${m.c2});"></div></div>
        <div class="att-meta">
          <span><b>${left}</b> classes left</span>
          <span>${sub.attendance_rate}% attended · ${sub.present} present / ${sub.absent} absent</span>
        </div>
        <div class="att-actions">
          <button class="btn btn-primary btn-sm" data-attend="${esc(sub.subject)}" ${allDone ? "disabled" : ""}>${allDone ? "All done ✓" : "Mark class done"}</button>
          ${allDone ? `<button class="btn btn-ghost btn-sm" data-raise="${esc(sub.subject)}">+ add more classes</button>` : ""}
        </div>
      </div>`;
    }).join("")}
  </section>`;

  document.querySelectorAll("[data-attend]").forEach((b) =>
    b.addEventListener("click", async () => {
      const subject = b.dataset.attend;
      try {
        const updated = await api(`/students/${me.student_id}/attendance`, {
          method: "POST",
          body: JSON.stringify({ subject, status: "PRESENT" }),
        });
        attendanceCache = updated;
        toast(`${subject}: class marked present ✓`);
        renderAttendance();
      } catch (err) { toast(err.message); }
    }));

  document.querySelectorAll("[data-raise]").forEach((b) =>
    b.addEventListener("click", async () => {
      const subject = b.dataset.raise;
      const sub = att.subjects.find((x) => x.subject === subject);
      try {
        const updated = await api(`/students/${me.student_id}/attendance`, {
          method: "POST",
          body: JSON.stringify({ subject, status: "PRESENT", total_classes: sub.total_classes + 2 }),
        });
        attendanceCache = updated;
        toast(`${subject}: total raised to ${updated.subjects.find((x) => x.subject === subject).total_classes}`);
        renderAttendance();
      } catch (err) { toast(err.message); }
    }));
}

/* ── Course file (course detail) ────────────────────────────────────────── */
function actionPlanFor(mastery, forgettingRisk) {
  if (forgettingRisk > 0.4 && mastery >= 0.5) return { type: "RETENTION_DRILL", questions: 5, minutes: 20, difficulty: 0.6 };
  if (mastery < 0.35) return { type: "FOUNDATION_REBUILD", questions: 5, minutes: 45, difficulty: 0.4 };
  if (mastery < 0.55) return { type: "SPEED_PRACTICE", questions: 7, minutes: 30, difficulty: 0.55 };
  if (mastery < 0.75) return { type: "MULTI_CONCEPT_DRILL", questions: 6, minutes: 35, difficulty: 0.7 };
  if (mastery < 0.88) return { type: "ADVANCED_PRACTICE", questions: 5, minutes: 40, difficulty: 0.85 };
  return { type: "TRANSFER_TEST", questions: 4, minutes: 20, difficulty: 0.85 };
}
function difficultyWord(d) {
  if (d < 0.4) return "easy";
  if (d < 0.55) return "medium";
  if (d < 0.7) return "medium-hard";
  return "hard";
}
function levelOf(c) {
  return c.difficulty_weight < 0.35 ? "foundation" : c.difficulty_weight < 0.6 ? "core" : "advanced";
}
function starsOf(c) {
  const n = Math.round((c.exam_relevance ?? 0.8) * 5);
  return "★".repeat(n) + "☆".repeat(5 - n);
}

async function renderCourse(conceptId) {
  const me = store.get();
  appEl.innerHTML = renderShell("plan", me, `<div class="loading">opening the course file…</div>`);
  wireShell();

  const [cur, dash] = await Promise.all([
    graphData || api("/curriculum").then((d) => (graphData = d)),
    dashboardCache || api(`/students/${me.student_id}/dashboard`),
  ]);
  if (!dashboardCache) dashboardCache = dash;

  const concept = cur.concepts.find((c) => c.concept_id === conceptId);
  if (!concept) return navigate("/");

  const masteryById = Object.fromEntries((dash.mastery.concepts || []).map((c) => [c.concept_id, c]));
  const rec = masteryById[conceptId] || {};
  const mastery = rec.mastery ?? 0;
  const attempts = rec.attempts_count ?? 0;
  const confidence = rec.confidence ?? 0.1;
  const forgettingRisk = rec.forgetting_risk ?? 0;
  const action = (dash.roadmap.actions || []).find((a) => a.concept_id === conceptId);
  const plan = action
    ? { type: action.action_type, questions: action.target_questions_count, minutes: action.estimated_minutes, difficulty: action.target_difficulty }
    : actionPlanFor(mastery, forgettingRisk);

  const children = {}, parents = {};
  cur.edges.forEach((e) => {
    (children[e.from] ||= []).push(e.to);
    (parents[e.to] ||= []).push(e.from);
  });
  function collectAncestors(id, out = [], seen = new Set()) {
    for (const p of parents[id] || []) {
      if (!seen.has(p)) { seen.add(p); collectAncestors(p, out, seen); out.push(p); }
    }
    return out;
  }
  const prereqIds = collectAncestors(conceptId);
  const dependents = children[conceptId] || [];

  const pct = Math.round(mastery * 100);
  const mastered = pct >= 70;
  const level = levelOf(concept);
  const stars = starsOf(concept);

  const prereqRows = prereqIds.map((pid) => {
    const c = cur.concepts.find((x) => x.concept_id === pid);
    const m = masteryById[pid]?.mastery ?? 0;
    const att = masteryById[pid]?.attempts_count ?? 0;
    const state = m >= 0.7 ? "mastered" : att > 0 ? "in-progress" : "untouched";
    const broken = m < 0.6;
    const meta = broken
      ? `needs repair · ${Math.round(m * 100)}%`
      : state === "mastered" ? `✓ ${Math.round(m * 100)}%`
      : state === "in-progress" ? `${Math.round(m * 100)}% · keep going`
      : "not started";
    return `
    <div class="prereq-row ${state}${broken ? " broken" : ""}">
      <span class="prereq-dot" aria-hidden="true"></span>
      <a class="prereq-name" href="/course/${esc(pid)}" data-nav="/course/${esc(pid)}">${esc(c?.name || pid)}</a>
      <span class="prereq-meta">${meta}</span>
    </div>`;
  }).join("");

  const unlockRows = dependents.map((did) => {
    const c = cur.concepts.find((x) => x.concept_id === did);
    const m = masteryById[did]?.mastery ?? 0;
    return `
    <div class="prereq-row">
      <span class="prereq-dot" aria-hidden="true"></span>
      <a class="prereq-name" href="/course/${esc(did)}" data-nav="/course/${esc(did)}">${esc(c?.name || did)}</a>
      <span class="prereq-meta">${m >= 0.7 ? "✓ unlocked" : m > 0 ? `${Math.round(m * 100)}% · in progress` : "locked until this is ready"}</span>
    </div>`;
  }).join("");

  const broken = prereqIds.filter((pid) => (masteryById[pid]?.mastery ?? 0) < 0.6);
  const brokenNames = broken.map((pid) => {
    const c = cur.concepts.find((x) => x.concept_id === pid);
    return `${c?.name || pid} (${Math.round((masteryById[pid]?.mastery ?? 0) * 100)}%)`;
  });
  const planSteps = [
    {
      title: "Foundation check",
      status: prereqIds.length === 0
        ? "root concept"
        : broken.length
          ? `repair first — ${broken.length} prerequisite${broken.length > 1 ? "s" : ""} below 60%`
          : "clear — every prerequisite is above 60%",
      statusCls: broken.length ? "warn" : "done",
      body: prereqIds.length === 0
        ? "no prerequisites — this concept is a root of the map."
        : broken.length
          ? `repair first: ${esc(brokenNames.join(", "))}.`
          : "every prerequisite is above the 60% bar — the path is clear.",
    },
    {
      title: "Practice session",
      status: action ? "in your current plan" : "next recommended step",
      body: `${plan.type.replace(/_/g, " ").toLowerCase()} · ${plan.questions} questions · ~${plan.minutes} min · ${difficultyWord(plan.difficulty)} difficulty`,
    },
    {
      title: "Mastery checkpoint",
      status: mastered ? "certificate earned" : `${Math.max(0, 70 - pct)} points to 70%`,
      statusCls: mastered ? "done" : "",
      body: mastered
        ? `this course is certified at ${pct}% — keep it warm with occasional reviews.`
        : `current mastery ${pct}% — the certificate unlocks at 70%.`,
    },
  ];
  if (forgettingRisk > 0.35) {
    planSteps.push({
      title: "Retention watch",
      status: "memory at risk",
      statusCls: "warn",
      body: `memory is fading (${Math.round(forgettingRisk * 100)}% forgetting risk) — run a short drill before the next session.`,
    });
  }

  const meta = subjectMeta(concept.topic_id || "");
  $("#main").innerHTML = `
  <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">course file · ${esc(concept.topic_id || "")}</span></div>
  <div class="course-head">
    <div class="kicker">${meta.ic} ${esc(concept.topic_id || "")} · course file</div>
    <h1>${esc(concept.name)}</h1>
    <p class="status-line">${esc(concept.description || "")}</p>
    <div class="meta-chips">
      <span class="chip">${level}</span>
      <span class="chip gray">~${concept.estimated_minutes || 30} min / session</span>
      <span class="chip gray">${stars}</span>
      <span class="chip amber">exam weight ${Math.round(concept.exam_relevance * 100)}%</span>
    </div>
  </div>

  <section class="sec">
    <div class="score-block" style="text-align:center;padding:8px 0 2px;">
      <div class="score-num">${pct}%</div>
      <div class="score-cap">current mastery</div>
      <div class="score-stats" style="max-width:260px;margin-inline:auto;">
        <span>${attempts} answers logged</span>
        <span>${Math.round(confidence * 100)}% confident</span>
        <span class="risk">${Math.round(forgettingRisk * 100)}% forgetting risk</span>
      </div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>Lesson plan</h2><div class="sub" style="font-size:10px;color:var(--ink-faint);font-weight:600;">built from your mastery record</div></div>
    <div class="card card-pad"><div class="plan-list">
      ${planSteps.map((s, i) => `
      <div class="plan-step ${s.statusCls}">
        <div class="plan-num" aria-hidden="true">${i + 1}</div>
        <div style="flex:1">
          <div><span class="plan-title">${s.title}</span><span class="plan-status ${s.statusCls}">${s.status}</span></div>
          <div class="plan-body">${s.body}</div>
        </div>
      </div>`).join("")}
    </div></div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>Prerequisites</h2><div class="sub" style="font-size:10px;color:var(--ink-faint);font-weight:600;">must know before this makes sense</div></div>
    <div class="card card-pad">
      ${prereqRows ? `<div class="prereq-list">${prereqRows}</div>` : `<div class="empty-italic">no prerequisites — this is a root of the map.</div>`}
    </div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>Unlocks</h2><div class="sub" style="font-size:10px;color:var(--ink-faint);font-weight:600;">what this course opens up</div></div>
    <div class="card card-pad">
      ${unlockRows ? `<div class="prereq-list">${unlockRows}</div>` : `<div class="empty-italic">nothing depends on this course yet.</div>`}
    </div>
  </section>

  <section class="sec">
    <div class="card card-pad">
      <div class="facts">
        <div class="fact-row"><span class="k">Next session</span><span class="v">${plan.type.replace(/_/g, " ").toLowerCase()}</span></div>
        <div class="fact-row"><span class="k">questions</span><span class="v">${plan.questions}</span></div>
        <div class="fact-row"><span class="k">time</span><span class="v">~${plan.minutes} min</span></div>
        <div class="fact-row"><span class="k">difficulty</span><span class="v">${difficultyWord(plan.difficulty)}</span></div>
        ${action ? `<div class="fact-row"><span class="k">plan rank</span><span class="v">#${action.sequence_order}</span></div>` : ""}
        <div class="fact-row"><span class="k">unlocks</span><span class="v">${dependents.length} concept${dependents.length === 1 ? "" : "s"}</span></div>
      </div>
      <div class="cta-row">
        <button class="btn btn-primary" data-course-start="${esc(concept.concept_id)}">${action ? "Resume →" : "Start practice"}</button>
        ${forgettingRisk > 0.35 ? `<button class="btn btn-soft" data-course-revive="${esc(concept.concept_id)}">Warm-up drill →</button>` : ""}
      </div>
    </div>
  </section>`;

  document.querySelectorAll("[data-course-start]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(b.dataset.courseStart)}/${encodeURIComponent(plan.type)}`)));
  document.querySelectorAll("[data-course-revive]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(b.dataset.courseRevive)}/RETENTION_DRILL`)));
}

/* ── Quiz ───────────────────────────────────────────────────────────────── */
let quizState = null;

async function renderQuiz(conceptId, actionType) {
  const me = store.get();
  appEl.innerHTML = renderShell(null, me, `<div class="loading">preparing your questions…</div>`, { navless: true });
  wireShell();

  const action = (dashboardCache?.roadmap.actions || []).find((a) => a.concept_id === conceptId);
  const q = await api(`/students/${me.student_id}/quiz/${conceptId}?count=${action?.target_questions_count || 5}&difficulty=${action?.target_difficulty || 0.5}`);

  quizState = {
    conceptId,
    actionType: action?.action_type || actionType || "REVIEW",
    questions: q.questions,
    idx: 0,
    answers: [],
    thetaBefore: dashboardCache?.student.irt_ability ?? null,
    startedAt: Date.now(),
    timer: null,
  };

  const main = $("#main");
  main.innerHTML = `
  <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">practice round · ${esc(q.concept_name)}</span></div>
  <div class="quiz-head">
    <div style="flex:1;min-width:0;">
      <h1>${esc(q.concept_name)}</h1>
      <div class="mini">${esc(quizState.actionType.replace(/_/g, " "))} — answer with your reasoning, not your speed</div>
    </div>
    <div class="quiz-progress" id="quiz-progress"></div>
  </div>
  <div class="quiz-card" id="quiz-card"></div>`;

  showQuestion();
}

function showQuestion() {
  const st = quizState;
  if (st.idx >= st.questions.length) return submitQuiz();
  const question = st.questions[st.idx];

  $("#quiz-progress").textContent = `${st.idx + 1}/${st.questions.length}`;
  $("#quiz-card").innerHTML = `
    <div class="q-text">${esc(question.question_text)}</div>
    <div class="timer-wrap">
      <div class="timer-bar"><div id="timer-fill" style="width:100%"></div></div>
      <div class="timer-label" id="timer-label">⏱ ${question.estimated_time_seconds}s — take your time</div>
    </div>
    <div class="options" id="options">
      ${question.options.map((opt, i) => `
        <button class="opt" data-key="${LETTERS[i]}"><span class="key">${LETTERS[i]}</span><span>${esc(opt)}</span></button>`).join("")}
    </div>
    <div class="quiz-actions">
      <button class="btn btn-ghost btn-sm" id="skip-q">Skip this question</button>
    </div>`;

  let secondsLeft = question.estimated_time_seconds;
  const fill = $("#timer-fill");
  const label = $("#timer-label");
  clearInterval(st.timer);
  st.timer = setInterval(() => {
    secondsLeft -= 1;
    fill.style.width = `${Math.max(0, (secondsLeft / question.estimated_time_seconds) * 100)}%`;
    if (secondsLeft <= 0) {
      clearInterval(st.timer);
      label.textContent = "⏱ Time's up";
      answer("", question.estimated_time_seconds);
    }
  }, 1000);

  const optionsEl = $("#options");
  optionsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".opt");
    if (!btn || btn.classList.contains("disabled")) return;
    const timeTaken = Math.min(
      Math.round((Date.now() - st.startedAt) / 1000) - st.answers.reduce((s, a) => s + a.time_taken_seconds, 0),
      question.estimated_time_seconds
    );
    answer(btn.dataset.key, timeTaken);
  });
  $("#skip-q").addEventListener("click", () => answer("", Math.min(8, question.estimated_time_seconds)));

  function answer(key, timeTaken) {
    clearInterval(st.timer);
    st.answers.push({ question_id: question.question_id, student_answer: key, time_taken_seconds: timeTaken });
    optionsEl.querySelectorAll(".opt").forEach((o) => (o.disabled = true));
    st.startedAt = Date.now();
    setTimeout(() => {
      st.idx += 1;
      showQuestion();
    }, 300);
  }
}

async function submitQuiz() {
  const st = quizState;
  $("#quiz-progress").textContent = "analysing…";
  $("#quiz-card").innerHTML = `<div class="loading">scoring, estimating ability, updating mastery and rebuilding your roadmap…</div>`;

  const res = await api("/assessments/submit", {
    method: "POST",
    body: JSON.stringify({ student_id: store.get().student_id, responses: st.answers }),
  });
  quizResults = { ...res, thetaBefore: st.thetaBefore, actionType: st.actionType, dashBefore: dashboardCache };
  dashboardCache = null;
  subjectsCache = null;
  navigate("/results");
}

/* ── Results ─────────────────────────────────────────────────────────────── */
let quizResults = null;

function renderResults() {
  const r = quizResults;
  if (!r) return navigate("/");
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell(null, me, "", { navless: true });
  wireShell();

  const thetaBefore = r.thetaBefore ?? 0;
  const thetaDelta = r.irt_theta - thetaBefore;
  const byError = {};
  r.item_results.forEach((it) => {
    if (it.is_correct) return;
    const t = it.error_type || "UNKNOWN";
    byError[t] = (byError[t] || 0) + 1;
  });

  const main = $("#main");
  main.innerHTML = `
  <div class="back-row"><button class="back-btn" id="res-back">‹</button><span class="crumb">results · roadmap rebuilt as v${r.roadmap_version}</span></div>
  <div class="results-hero">
    <div class="score-ring ${ringClass(r.score_percentage)}">${Math.round(r.score_percentage)}%</div>
    <h2>${r.score_percentage >= 70 ? "Nice work — the numbers moved 🎉" : r.score_percentage >= 40 ? "Solid attempt — here's exactly what to fix" : "Tough round — let's fix the root cause"}</h2>
    <p>${r.correct_count}/${r.total_questions} correct · ability θ ${thetaBefore >= 0 ? "+" : ""}${thetaBefore.toFixed(2)} → ${r.irt_theta >= 0 ? "+" : ""}${r.irt_theta.toFixed(2)} (${thetaDelta >= 0 ? "+" : ""}${thetaDelta.toFixed(2)})</p>
  </div>

  <div class="result-grid">
    <div class="result-panel">
      <h3>Concept mastery — before → after</h3>
      <div id="res-deltas"></div>
    </div>
    <div class="result-panel">
      <h3>Why you lost marks</h3>
      <div class="error-list" id="res-errors"></div>
    </div>
  </div>

  <section class="sec">
    <div class="result-panel">
      <h3>Your new roadmap</h3>
      <div class="roadmap" id="res-roadmap"></div>
    </div>
  </section>`;

  $("#res-back").addEventListener("click", () => navigate("/"));

  const deltas = $("#res-deltas");
  r.concept_mastery_updates.forEach((u) => {
    const before = (r.dashBefore?.mastery.concepts.find((c) => c.concept_id === u.concept_id)?.mastery) ?? 0;
    const after = u.mastery;
    const diff = after - before;
    const cls = diff > 0.01 ? "delta-up" : diff < -0.01 ? "delta-down" : "delta-flat";
    const sign = diff > 0 ? "+" : "";
    deltas.insertAdjacentHTML("beforeend", `
      <div class="delta-row"><span>${esc(u.concept_id.toUpperCase())}</span>
      <span class="${cls}">${(before * 100).toFixed(0)}% → ${(after * 100).toFixed(0)}% (${sign}${(diff * 100).toFixed(1)})</span></div>`);
  });

  const errBox = $("#res-errors");
  const entries = Object.entries(byError).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    errBox.innerHTML = `<div class="mini">No wrong answers — nothing to fix. Try a harder level next.</div>`;
  } else {
    errBox.innerHTML = entries.map(([t, n]) => {
      const meta = ERROR_LABEL[t] || ERROR_LABEL.UNKNOWN;
      return `<div class="error-row"><span>${meta.ic} ${meta.label}</span><span class="n">${n}×</span></div>`;
    }).join("");
  }

  const rm = $("#res-roadmap");
  (r.roadmap_actions || []).forEach((a) => {
    rm.insertAdjacentHTML("beforeend", `
      <div class="r-card">
        <div class="r-top"><span class="r-name">${esc(a.concept_name)}</span>
        <span class="chip ${a.action_type === "FOUNDATION_REBUILD" ? "pink" : a.action_type === "RETENTION_DRILL" ? "green" : ""}">${a.action_type.replace(/_/g, " ")}</span></div>
        <div class="r-meta">${a.target_questions_count} questions · ~${a.estimated_minutes} min</div>
        <div class="r-reasons">${a.reasons.map((x) => `<div class="r-reason ${reasonClass(x)}"><span class="ic">${x.includes("Root foundational gap") ? "🧱" : x.includes("Spaced") ? "🔁" : "•"}</span><span>${esc(x)}</span></div>`).join("")}</div>
        <div class="r-foot">
          <div class="mastery-row"><span class="pillbar" style="flex:1"><div style="width:${Math.round((a.mastery ?? 0) * 100)}%"></div></span><span class="pct">${Math.round((a.mastery ?? 0) * 100)}%</span></div>
          <button class="btn btn-primary btn-sm r-start" data-rstart="${esc(a.concept_id)}" data-rtype="${esc(a.action_type)}">Start →</button>
        </div>
      </div>`);
  });
  if (!r.roadmap_actions.length) rm.innerHTML = `<div class="mini">Roadmap generated on next session.</div>`;
  document.querySelectorAll("[data-rstart]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(b.dataset.rstart)}/${encodeURIComponent(b.dataset.rtype)}`)));

  const review = r.item_results.filter((it) => !it.is_correct);
  if (review.length) {
    main.insertAdjacentHTML("beforeend", `
    <section class="sec">
      <div class="sec-head"><h2>Learn from each miss</h2><div class="sub" style="font-size:10px;color:var(--ink-faint);font-weight:600;">the classifier explains WHY, not just that you were wrong</div></div>
      <div class="roadmap">
        ${review.map((it) => {
          const meta = ERROR_LABEL[it.error_type] || ERROR_LABEL.UNKNOWN;
          return `
          <div class="r-card">
            <div class="r-top"><span class="r-name" style="font-size:13.5px;">${esc(it.question_text)}</span></div>
            <div class="r-reasons">
              <div class="r-reason ${it.error_type === "GUESS" ? "is-forget" : ""}">
                <span class="ic">${meta.ic}</span><span><b>${meta.label}</b> — ${esc(it.note)}</span>
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>`);
  }

  main.insertAdjacentHTML("beforeend", `
  <section class="sec" style="margin-top:30px;">
    <button class="btn btn-primary btn-block" id="res-home">Back to dashboard</button>
  </section>`);
  $("#res-home").addEventListener("click", () => navigate("/"));
}

/* ── Profile ────────────────────────────────────────────────────────────── */
async function renderProfile() {
  const me = store.get();
  appEl.innerHTML = renderShell("profile", me, `<div class="loading">loading your profile…</div>`);
  wireShell();

  const d = dashboardCache || await api(`/students/${me.student_id}/dashboard`);
  if (!dashboardCache) dashboardCache = d;
  const streak = streakInfo();
  const hours = hoursFromMastery(d.mastery.concepts || []);

  $("#main").innerHTML = `
  <div class="profile-hero">
    <div class="avatar">${esc((me.name || "L").trim().charAt(0).toUpperCase())}</div>
    <h1>${esc(me.name || "Learner")}</h1>
    <div class="sub">🎯 ${esc(d.student.target_exam || "Boards")} · ability θ ${d.student.irt_ability >= 0 ? "+" : ""}${d.student.irt_ability.toFixed(2)}</div>
  </div>

  <section class="sec">
    <div class="stat-row">
      <div class="stat-card"><div class="st-cap">Mastered</div><div class="st-num">${d.stats.mastered_count}<small style="font-size:13px;color:var(--ink-faint);">/${d.stats.total_concepts}</small></div></div>
      <div class="stat-card"><div class="st-cap">Avg mastery</div><div class="st-num">${Math.round(d.stats.avg_mastery * 100)}%</div></div>
      <div class="stat-card"><div class="st-cap">Study time</div><div class="st-num">${fmtHours(hours * 60)}</div></div>
      <div class="stat-card"><div class="st-cap">Streak</div><div class="st-num">🔥 ${streak}</div></div>
    </div>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>More</h2></div>
    <div class="profile-links">
      <a class="sheet-opt" data-nav="/bank"><span class="s-ic">🗂</span> Question bank (admin)</a>
      <a class="sheet-opt" data-nav="/subjects"><span class="s-ic">📚</span> Subjects</a>
      <a class="sheet-opt" data-nav="/map"><span class="s-ic">🕸</span> Concept map</a>
    </div>
    <div class="cta-row" style="margin-top:16px;">
      <button class="btn btn-ghost btn-block" id="prof-logout">Log out</button>
    </div>
  </section>`;

  $("#prof-logout").addEventListener("click", () => {
    store.clear();
    dashboardCache = subjectsCache = assignmentsCache = attendanceCache = null;
    navigate("/");
  });
}

/* ── Question bank (admin) — browse & add more questions ────────────────── */
let qbCurriculum = null;
let qbFilter = "";
let qbCorrectIdx = 0;
const QB_VISIBLE_LIMIT = 200;

function qbConceptName(id) {
  const c = (qbCurriculum?.concepts || []).find((x) => x.concept_id === id);
  return c ? c.name : id;
}
function qbConceptOptions(selected) {
  return (qbCurriculum?.concepts || [])
    .map((c) => `<option value="${esc(c.concept_id)}" ${c.concept_id === selected ? "selected" : ""}>${esc(c.name)}</option>`)
    .join("");
}
function qbQuestionCard(q) {
  const notes = q.distractor_explanations || {};
  return `
  <article class="qbk-card">
    <div class="qbk-main" role="button" tabindex="0" aria-expanded="false">
      <span class="qbk-caret" aria-hidden="true">›</span>
      <div class="qbk-body">
        <div class="qbk-top">
          <span class="chip gray">${esc(qbConceptName(q.concept_id))}</span>
          <span class="qbk-id">${esc(q.question_id)}</span>
        </div>
        <div class="qbk-text">${esc(q.question_text)}</div>
        <div class="qbk-meta">difficulty ${q.difficulty.toFixed(2)} · ~${q.estimated_time_seconds}s · discrimination ${q.discrimination.toFixed(1)}</div>
      </div>
    </div>
    <div class="qbk-detail">
      ${q.options.map((opt, i) => {
        const letter = LETTERS[i];
        const correct = letter === q.correct_answer;
        const note = notes[letter];
        return `
      <div class="qbk-opt ${correct ? "correct" : ""}">
        <span class="key">${letter}</span>
        <span class="qbk-opt-text">${esc(opt)}</span>
        ${correct ? `<span class="qbk-ok">correct</span>` : ""}
        ${note ? `<span class="qbk-note">${esc(note)}</span>` : ""}
      </div>`;
      }).join("")}
    </div>
  </article>`;
}
function qbEmpty(html) {
  return `<div class="empty-italic">${html}</div>`;
}
async function qbRefreshList(listEl, countEl) {
  const data = await api(`/questions${qbFilter ? `?concept_id=${encodeURIComponent(qbFilter)}` : ""}`);
  countEl.textContent = data.count ? `${data.count} question${data.count === 1 ? "" : "s"}` : "";
  const shown = data.questions.slice(0, QB_VISIBLE_LIMIT);
  if (!shown.length) {
    listEl.innerHTML = qbEmpty("No questions yet for this filter — add one above, or run <b>hf_import.py</b> to pull exambench questions in.");
  } else {
    listEl.innerHTML = shown.map(qbQuestionCard).join("") +
      (data.questions.length > QB_VISIBLE_LIMIT
        ? `<div class="mini" style="text-align:center;padding-top:8px">Showing the first ${QB_VISIBLE_LIMIT} — filter by concept or add server-side paging for more.</div>`
        : "");
  }
  listEl.querySelectorAll(".qbk-card").forEach((card) => {
    const head = card.querySelector(".qbk-main");
    const toggle = () => {
      const open = card.classList.toggle("open");
      head.setAttribute("aria-expanded", String(open));
    };
    head.addEventListener("click", toggle);
    head.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });
}
function qbShowMsg(el, text, kind) {
  el.textContent = text;
  el.classList.add("show");
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
}
async function renderQuestionBank() {
  const me = store.get();
  if (!qbCurriculum || !qbCurriculum.concepts) {
    try { qbCurriculum = await api("/curriculum"); } catch { qbCurriculum = { concepts: [] }; }
  }
  graphData = qbCurriculum;

  appEl.innerHTML = renderShell("profile", me, `
    <div class="back-row"><button class="back-btn" data-nav-back>‹</button><span class="crumb">admin · question bank</span></div>
    <div class="loading">opening the ledger…</div>`);
  wireShell();

  const main = $("#main");
  main.innerHTML = `
  <div class="qbk-head">
    <div>
      <h1>Question bank</h1>
      <p class="qbk-sub">every question a student can be asked — add more one at a time or in bulk</p>
    </div>
    <button class="btn btn-primary btn-sm" id="qb-add-toggle">＋ add one</button>
  </div>

  <div class="qbk-tool">
    <select id="qb-concept" class="qbk-select" aria-label="Filter by concept">
      <option value="">All concepts</option>
      ${qbConceptOptions("")}
    </select>
    <span class="mini" id="qb-count"></span>
    <button class="btn btn-ghost btn-sm" id="qb-bulk-toggle" style="margin-left:auto;">add many (JSON)</button>
  </div>

  <div class="qbk-panel" id="qb-add-panel" hidden>
    <div class="qbk-grid2">
      <label class="qbk-field">
        <span>Concept</span>
        <select id="af-concept">${qbConceptOptions("")}</select>
      </label>
      <label class="qbk-field">
        <span>Question ID (optional)</span>
        <input id="af-id" type="text" placeholder="auto-generated if empty">
      </label>
    </div>
    <label class="qbk-field" style="margin-top:10px;">
      <span>Question text</span>
      <textarea id="af-text" rows="2" placeholder="Stem of the MCQ, self-contained…"></textarea>
    </label>
    <div class="qbk-field" style="margin-top:10px;">
      <span>Options — click the letter of the correct one</span>
      <div id="af-options"></div>
    </div>
    <div class="qbk-grid4" style="margin-top:10px;">
      <label class="qbk-field"><span>Difficulty (0–1)</span><input id="af-diff" type="number" min="0" max="1" step="0.05" value="0.5"></label>
      <label class="qbk-field"><span>Est. seconds</span><input id="af-secs" type="number" min="10" step="5" value="60"></label>
    </div>
    <div class="qbk-msg" id="af-msg"></div>
    <button class="btn btn-primary" id="af-submit" style="margin-top:12px;">save question</button>
  </div>

  <div class="qbk-panel" id="qb-bulk-panel" hidden>
    <div class="qbk-panel-title">Bulk add — paste a JSON array</div>
    <label class="qbk-field" style="margin-top:10px;">
      <textarea id="bf-json" rows="8" spellcheck="false" placeholder='[{"concept_id": "c02", "question_text": "…", "options": ["…", "…", "…", "…"], "correct_answer": "B", "distractor_explanations": {"A": "CALCULATION_ERROR: …"}}]'></textarea>
    </label>
    <div class="mini" style="margin-top:6px;">Required: <b>concept_id</b>, <b>question_text</b>, <b>options</b> (exactly 4), <b>correct_answer</b> (letter A–D). Optional: question_id, difficulty, discrimination, estimated_time_seconds, distractor_explanations.</div>
    <label class="qbk-check"><input type="checkbox" id="bf-replace"> replace existing question IDs instead of skipping</label>
    <div class="qbk-msg" id="bf-msg"></div>
    <button class="btn btn-primary" id="bf-submit" style="margin-top:12px;">add questions</button>
  </div>

  <div id="qb-list"></div>`;

  const listEl = $("#qb-list");
  const countEl = $("#qb-count");
  const addPanel = $("#qb-add-panel");
  const bulkPanel = $("#qb-bulk-panel");

  $("#qb-add-toggle").addEventListener("click", () => {
    bulkPanel.hidden = true;
    addPanel.hidden = !addPanel.hidden;
  });
  $("#qb-bulk-toggle").addEventListener("click", () => {
    addPanel.hidden = true;
    bulkPanel.hidden = !bulkPanel.hidden;
  });
  $("#qb-concept").addEventListener("change", (e) => {
    qbFilter = e.target.value;
    qbRefreshList(listEl, countEl).catch((err) => { listEl.innerHTML = qbEmpty(esc(err.message)); });
  });

  function paintCorrect() {
    document.querySelectorAll(".qbk-mark").forEach((m, i) => {
      m.classList.toggle("active", i === qbCorrectIdx);
      m.setAttribute("aria-pressed", String(i === qbCorrectIdx));
    });
  }
  $("#af-options").innerHTML = LETTERS.map((letter, i) => `
    <div class="qbk-optrow">
      <button type="button" class="qbk-mark" data-idx="${i}" aria-pressed="false" title="mark as correct">${letter}</button>
      <input class="opt-text" type="text" data-idx="${i}" placeholder="Option ${letter} text">
      <input class="opt-note" type="text" data-idx="${i}" placeholder="why a wrong pick happens (optional)">
    </div>`).join("");
  paintCorrect();
  $("#af-options").addEventListener("click", (e) => {
    const m = e.target.closest(".qbk-mark");
    if (!m) return;
    qbCorrectIdx = Number(m.dataset.idx);
    paintCorrect();
  });

  $("#af-submit").addEventListener("click", async () => {
    const msg = $("#af-msg");
    const texts = [...document.querySelectorAll(".opt-text")].map((i) => i.value.trim());
    if (texts.some((t) => !t)) return qbShowMsg(msg, "All four options must be filled in.", "err");
    if (new Set(texts).size !== 4) return qbShowMsg(msg, "The four options must be distinct.", "err");
    const question_text = $("#af-text").value.trim();
    if (!question_text) return qbShowMsg(msg, "Question text is required.", "err");

    const distractor_explanations = {};
    document.querySelectorAll(".opt-note").forEach((n, i) => {
      if (i !== qbCorrectIdx && n.value.trim()) distractor_explanations[LETTERS[i]] = n.value.trim();
    });
    const payload = {
      concept_id: $("#af-concept").value,
      question_text,
      options: texts,
      correct_answer: LETTERS[qbCorrectIdx],
      difficulty: Math.min(1, Math.max(0, Number($("#af-diff").value) || 0.5)),
      estimated_time_seconds: Math.max(10, Number($("#af-secs").value) || 60),
    };
    const id = $("#af-id").value.trim();
    if (id) payload.question_id = id;
    if (Object.keys(distractor_explanations).length) payload.distractor_explanations = distractor_explanations;

    const btn = $("#af-submit");
    btn.disabled = true;
    try {
      const saved = await api("/questions", { method: "POST", body: JSON.stringify(payload) });
      qbShowMsg(msg, `Saved ${saved.question_id}.`, "ok");
      $("#af-id").value = "";
      $("#af-text").value = "";
      document.querySelectorAll(".opt-text").forEach((i) => (i.value = ""));
      document.querySelectorAll(".opt-note").forEach((i) => (i.value = ""));
      await qbRefreshList(listEl, countEl);
    } catch (err) { qbShowMsg(msg, err.message, "err"); }
    finally { btn.disabled = false; }
  });

  $("#bf-submit").addEventListener("click", async () => {
    const msg = $("#bf-msg");
    let parsed;
    try { parsed = JSON.parse($("#bf-json").value); }
    catch { return qbShowMsg(msg, "That is not valid JSON — check the brackets and quotes.", "err"); }
    const questions = Array.isArray(parsed) ? parsed : [parsed];
    if (!questions.length) return qbShowMsg(msg, "The array is empty.", "err");

    const btn = $("#bf-submit");
    btn.disabled = true;
    try {
      const res = await api("/questions/batch", {
        method: "POST",
        body: JSON.stringify({ questions, replace: $("#bf-replace").checked }),
      });
      const errors = res.results.filter((r) => r.status === "error").slice(0, 3)
        .map((r) => `row ${r.index + 1}: ${r.error}`);
      const lines = [
        `${res.inserted} inserted · ${res.updated} updated · ${res.skipped} duplicates skipped · ${res.errors} errors`,
        ...errors,
      ];
      qbShowMsg(msg, lines.join("\n"), res.errors ? "err" : "ok");
      await qbRefreshList(listEl, countEl);
    } catch (err) { qbShowMsg(msg, err.message, "err"); }
    finally { btn.disabled = false; }
  });

  qbRefreshList(listEl, countEl).catch((err) => { listEl.innerHTML = qbEmpty(esc(err.message)); });
}

/* ── Boot ───────────────────────────────────────────────────────────────── */
startFocusTick();
startReminderChecker();
route();