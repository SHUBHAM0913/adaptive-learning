/* ── Fieldnote frontend (vanilla JS, no build step) ──────────────────────
   Dashboard designed as a physical field notebook:
   Fraunces for numbers/headings, Cabinet Grotesk for UI,
   Space Mono for data labels, Caveat only for placeholder/empty-state. */
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
  CONCEPTUAL_ERROR: { label: "Conceptual gap", ic: "💡", cls: "bad" },
  CALCULATION_ERROR: { label: "Calculation slip", ic: "🧮", cls: "bad" },
  FORMULA_SELECTION_ERROR: { label: "Wrong formula picked", ic: "📐", cls: "bad" },
  SIGN_ERROR: { label: "Sign / direction error", ic: "±", cls: "bad" },
  GUESS: { label: "Guessed — answered too fast", ic: "🎲", cls: "bad" },
  TIME_PRESSURE: { label: "Ran out of time", ic: "⏱", cls: "bad" },
  SKIPPED: { label: "Skipped", ic: "⏭", cls: "bad" },
  UNIT_ERROR: { label: "Unit error", ic: "📏", cls: "bad" },
  READING_ERROR: { label: "Misread the question", ic: "👀", cls: "bad" },
  CARELESS_ERROR: { label: "Careless mistake", ic: "😅", cls: "bad" },
  UNKNOWN: { label: "Wrong answer", ic: "❌", cls: "bad" },
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

// Delegated nav: covers shell items AND links rendered later inside #main.
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-nav]");
  if (!a) return;
  e.preventDefault();
  const href = a.dataset.nav;
  if (a.dataset.scroll && location.pathname === href) {
    document.getElementById(a.dataset.scroll)?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (a.dataset.scroll) pendingScroll = a.dataset.scroll;
  navigate(href);
});

function route() {
  const path = location.pathname;
  if (path === "/app" || path === "/app/") {
    // /app is the SPA entry: honour a shareable demo deep-link and let a
    // stored student land straight on their dashboard after a refresh.
    const params = new URLSearchParams(location.search);
    if (params.get("demo")) store.set({ student_id: "demo", name: "Demo Student", demo: true });
    const me = store.get();
    history.replaceState(null, "", "/");
    return me ? renderDashboard() : renderOnboarding();
  }
  if (path === "/") {
    const me = store.get();
    if (me) return renderDashboard();
    return renderOnboarding();
  }
  const m = path.match(/^\/quiz\/([^/]+)\/([^/]+)/);
  if (m) return renderQuiz(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  const c = path.match(/^\/course\/([^/]+)/);
  if (c) return renderCourse(decodeURIComponent(c[1]));
  if (path === "/graph") return renderGraph();
  if (path === "/results") return renderResults();
  if (path === "/questions") return renderQuestionBank();
  renderOnboarding();
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
  if (s.last === today) { /* same day, don't double-count */ }
  else if (s.last === yesterday) s.count += 1;
  else s.count = 1;
  s.last = today;
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* ignore */ }
  return s.count;
}

/* ── Shell: sidebar + main ───────────────────────────────────────────────── */
function renderShell(active, me, content = "") {
  const streak = streakInfo();
  const firstName = (me?.name || "Learner").trim().split(/\s+/)[0] || "Learner";
  const initial = (me?.name || "L").trim().charAt(0).toUpperCase();
  const exam = me?.target_exam || "learner";

  const planCount = dashboardCache ? (dashboardCache.roadmap.actions || []).length : null;
  const graphCount = dashboardCache?.stats.total_concepts ?? 16;
  const nav = [
    { key: "overview", href: "/", label: "Overview", icon: "◉", count: null },
    { key: "plan", href: "/", label: "Study plan", icon: "✎", count: `<span class="nav-count" id="nav-count-plan">${planCount != null ? planCount : "…"}</span>`, scroll: "courses" },
    { key: "graph", href: "/graph", label: "Concept map", icon: "◈", count: `<span class="nav-count" id="nav-count-graph">${graphCount}</span>` },
    { key: "bank", href: "/questions", label: "Question bank", icon: "▢", count: null },
  ].map((n) => `
    <a class="nav-item${active === n.key ? " is-active" : ""}" href="${n.href}"
       data-nav="${n.href}"${n.scroll ? ` data-scroll="${n.scroll}"` : ""}
       aria-label="${n.label}"
       ${active === n.key ? 'aria-current="page"' : ""}>
      <span class="nav-ic" aria-hidden="true">${n.icon}</span>
      <span class="nav-label">${n.label}</span>
      ${n.count || ""}
    </a>`).join("");

  return `
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark" aria-hidden="true">✳</span><span class="brand-name">fieldnote</span></div>
      <nav class="side-nav" aria-label="Primary">${nav}</nav>
      <div class="streak-block">
        <div class="streak-flame" aria-hidden="true">🔥</div>
        <div class="streak-cap">${streak > 1 ? `${streak}-day streak — keep the field notes coming` : "log a session to light your streak"}</div>
      </div>
      <div class="profile">
        <div class="avatar" aria-hidden="true">${esc(initial)}</div>
        <div class="profile-meta">
          <div class="profile-name">${esc(firstName)}</div>
          <div class="profile-sub">${esc(exam)}</div>
        </div>
        <button class="profile-switch" id="nav-logout" title="Switch student" aria-label="Switch student">⇄</button>
      </div>
      <div class="side-foot">fieldnote · built on masteryos</div>
    </aside>
    <div class="shell-main">
      <main id="main" class="page">${content}</main>
    </div>
  </div>`;
}

function wireShell() {
  // [data-nav] links are handled by the delegated listener registered above,
  // so links rendered later inside #main (course files, etc.) work too.
  $("#nav-logout")?.addEventListener("click", () => { store.clear(); navigate("/"); });
}

/* ── Onboarding ──────────────────────────────────────────────────────────── */
function renderOnboarding() {
  appEl.innerHTML = `
  <div class="onboard">
    <div class="brand"><span class="brand-mark" aria-hidden="true">✳</span><span class="brand-name">fieldnote</span></div>
    <h1>Learn what you don't know, <em>in the right order.</em></h1>
    <p>Every answer you give rebuilds a personal study plan from five
    learning-science models — mastery, knowledge tracing, ability estimation,
    forgetting curves, and prerequisite logic. No videos to binge. No fake streaks.</p>
    <form class="onboard-form" id="onboard-form">
      <input id="onboard-name" placeholder="Your name" autocomplete="name" maxlength="60" required>
      <button class="btn btn-primary btn-lg" type="submit">Start learning</button>
      <div class="hint">your plan is rebuilt after every practice session</div>
    </form>
    <div class="divider">or</div>
    <button class="btn btn-ghost btn-lg" id="onboard-demo">Explore the demo student's notebook</button>
  </div>`;

  $("#onboard-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("#onboard-name").value.trim();
    if (!name) return;
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Building your first roadmap…";
    try {
      const s = await api("/students", {
        method: "POST",
        body: JSON.stringify({ name, target_exam: "Boards" }),
      });
      store.set({ student_id: s.student_id, name: s.name });
      navigate("/");
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Start learning";
      alert(err.message);
    }
  });

  $("#onboard-demo").addEventListener("click", () => {
    store.set({ student_id: "demo", name: "Demo Student", demo: true });
    navigate("/");
  });
}

/* ── Dashboard ───────────────────────────────────────────────────────────── */
let dashboardCache = null;

const ARTS = [
  ["#2B6E63", "#143F38"],   // teal
  ["#D98E2B", "#8F5A12"],   // amber
  ["#B4594A", "#6F2F26"],   // rust
];

function stampFor(a) {
  if ((a.mastery ?? 0) < 0.35) return { t: "JUST STARTED", cls: "stamp-amber" };
  if (a.action_type === "RETENTION_DRILL") return { t: "KEEP WARM", cls: "stamp-teal" };
  if (a.action_type === "FOUNDATION_REBUILD") return { t: "REBUILD", cls: "stamp-rust" };
  return { t: "IN PROGRESS", cls: "stamp-ink" };
}

function courseCard(a, i, topicById = {}) {
  const [c1, c2] = ARTS[i % ARTS.length];
  const stamp = stampFor(a);
  const pct = Math.round((a.mastery ?? 0) * 100);
  const topic = topicById[a.concept_id] || "";
  return `
  <article class="course-card rise" style="--d:${i + 2}" data-search="${esc((a.concept_name + " " + topic).toLowerCase())}">
    <div class="course-art" style="--c1:${c1};--c2:${c2}">
      <span class="stamp ${stamp.cls}">${stamp.t}</span>
      <div class="course-pct">${pct}%</div>
      <div class="course-art-ft">field guide · ${esc(topic)}</div>
      <button class="resume-btn" data-start="${esc(a.concept_id)}" data-type="${esc(a.action_type)}">Resume →</button>
    </div>
    <div class="course-body">
      <h3 class="course-name"><a class="course-name-link" href="/course/${esc(a.concept_id)}" data-nav="/course/${esc(a.concept_id)}">${esc(a.concept_name)}</a></h3>
      <div class="course-meta">${a.action_type.replace(/_/g, " ").toLowerCase()} · ~${a.estimated_minutes} min</div>
      <div class="pillbar" aria-hidden="true"><div style="width:${pct}%"></div></div>
    </div>
  </article>`;
}

function levelOf(c) {
  const d = c.difficulty_weight ?? 0.5;
  return d < 0.4 ? "foundations" : d < 0.6 ? "working" : "advanced";
}
function starsOf(c) {
  const n = Math.round((c.exam_relevance ?? 0.8) * 5);
  return "★".repeat(Math.max(0, Math.min(5, n))) + "☆".repeat(Math.max(0, 5 - n));
}

function recRow(c, i) {
  const [t1, t2] = ARTS[i % ARTS.length];
  const label = c.attempts_count > 0 ? "Practice" : "Enroll";
  return `
  <div class="rec-row rise" style="--d:${i + 3}" data-search="${esc((c.name + " " + c.topic_id).toLowerCase())}">
    <div class="rec-thumb" style="--t1:${t1};--t2:${t2}" aria-hidden="true">${esc(c.name.charAt(0))}</div>
    <div class="rec-info">
      <a class="rec-title-link" href="/course/${esc(c.concept_id)}" data-nav="/course/${esc(c.concept_id)}">${esc(c.name)}</a>
      <div class="rec-meta">~${c.estimated_minutes || 30} min · ${levelOf(c)} · ${starsOf(c)}</div>
    </div>
    <button class="enroll-btn" data-course="${esc(c.concept_id)}">${label}</button>
  </div>`;
}

function ticket(a, i) {
  const dates = ["TODAY", "+1D", "+2D"];
  const urgent = a.sequence_order === 1 || (a.reasons || []).some((r) => r.includes("Root foundational gap"));
  return `
  <button class="ticket${urgent ? " is-urgent" : ""}" style="--rot:${(i % 2 ? 1 : -1) * 0.4}deg"
          data-start="${esc(a.concept_id)}" data-type="${esc(a.action_type)}">
    <span class="ticket-date">${dates[i] || "+" + (i + 1) + "D"}</span><br>
    <span class="ticket-name">${esc(a.concept_name)}</span>
    <div class="ticket-meta">${a.target_questions_count} questions · ~${a.estimated_minutes} min · ${a.action_type.replace(/_/g, " ").toLowerCase()}</div>
  </button>`;
}

function sealRow(d, st, actions, concepts) {
  const rootGap = actions.find((a) => (a.reasons || []).some((r) => r.includes("Root foundational gap")))?.concept_id || "c01";
  const rootMastery = concepts.find((c) => c.concept_id === rootGap)?.mastery || 0;
  const certs = d.mastery.mastered_count;
  const seals = [
    { label: "1st", sub: "SESSION", cap: "first session", earned: st.attempts >= 1, c1: "#2B6E63", c2: "#1F524A", rot: "-3deg" },
    { label: "10", sub: "ANSWERS", cap: "answers logged", earned: st.attempts >= 10, c1: "#D98E2B", c2: "#8F5A12", rot: "2deg" },
    { label: "1+", sub: "MASTERED", cap: "concept mastered", earned: certs >= 1, c1: "#B4594A", c2: "#6F2F26", rot: "-1.5deg" },
    { label: "ROOT", sub: "SEALED", cap: "foundation repaired", earned: rootMastery >= 0.7, c1: "#3E3B35", c2: "#1C1B19", rot: "2.5deg" },
  ];
  return `
  <div class="seal-row">
    ${seals.map((s) => `
      <div class="seal${s.earned ? "" : " is-locked"}" title="${s.earned ? s.cap : "locked — " + s.cap}">
        <div class="seal-outer" style="--rot:${s.rot}">
          <div class="seal-inner" style="--c1:${s.c1};--c2:${s.c2}">
            <span class="seal-txt">${s.earned ? s.label : "· ·"}</span>
            <span class="seal-sub">${s.earned ? s.sub : "LOCKED"}</span>
          </div>
        </div>
        <div class="seal-cap">${s.cap}</div>
      </div>`).join("")}
  </div>`;
}

function dashboardHTML(d, me) {
  const s = d.student;
  const st = d.stats;
  const actions = d.roadmap.actions || [];
  const concepts = d.mastery.concepts || [];
  const forgetting = d.mastery.forgetting_alerts || [];

  const firstName = (s.name || "Learner").trim().split(/\s+/)[0] || "Learner";
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const streak = streakInfo();

  const attempted = concepts.filter((c) => c.attempts_count > 0).length;
  const minutes = concepts.reduce((sum, c) => sum + (c.attempts_count / 5) * (c.estimated_minutes || 30), 0);
  const hours = Math.round(minutes / 6) / 10;
  const certs = d.mastery.mastered_count;
  const total = st.total_concepts;
  const avgPct = Math.round(st.avg_mastery * 100);
  const pacePct = Math.round((certs / Math.max(total, 1)) * 100);

  const topicById = Object.fromEntries(concepts.map((c) => [c.concept_id, c.topic_id || ""]));
  const top = actions.slice(0, 3);
  const recommended = concepts
    .filter((c) => !actions.some((a) => a.concept_id === c.concept_id))
    .filter((c) => c.mastery < 0.7)
    .sort((a, b) => (b.forgetting_risk - a.forgetting_risk) || (b.exam_relevance - a.exam_relevance) || (a.mastery - b.mastery))
    .slice(0, 6);

  const R = 52;
  const C = 2 * Math.PI * R;
  const ringOffset = C - (pacePct / 100) * C;

  return `
  <header class="dash-header rise" style="--d:0">
    <div class="header-copy">
      <div class="eyebrow">DAY ${streak} · ${streak > 1 ? "WEEK STREAK ACTIVE" : "FIRST DAY"}</div>
      <h1 class="greeting">Good ${period}, <em>${esc(firstName)}</em>.</h1>
      <p class="status-line">${certs} of ${total} concepts mastered · average mastery ${avgPct}% · ${st.attempts} answers logged</p>
    </div>
    <div class="header-tools">
      <div class="search-wrap">
        <input class="search-input" id="search" type="search" placeholder="Search your field guide…" aria-label="Search courses and concepts">
      </div>
      <div class="bell-wrap" id="bell" role="button" tabindex="0" aria-label="Notifications: ${forgetting.length} concept${forgetting.length === 1 ? "" : "s"} at risk of forgetting" aria-expanded="false">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        ${forgetting.length ? '<span class="bell-dot" aria-hidden="true"></span>' : ""}
        <div class="bell-panel" id="bell-panel" role="region" aria-label="Notifications">
          <div class="bell-title">field alerts · memory at risk</div>
          ${forgetting.length ? forgetting.map((c) => `
            <div class="bell-row">
              <span class="br-name">${esc(c.name)}</span>
              <span class="br-meta">${Math.round(c.forgetting_risk * 100)}% fading</span>
              <button class="br-go" data-revive="${esc(c.concept_id)}">Revive →</button>
            </div>`).join("")
            : '<div class="empty-italic">all quiet — nothing at risk of fading.</div>'}
        </div>
      </div>
    </div>
  </header>

  <section class="ledger rise" style="--d:1" aria-label="Your totals">
    <div class="ledger-item">
      <span class="ledger-label">courses enrolled</span>
      <span class="ledger-num">${attempted}</span>
      <span class="ledger-sub">of ${total} in your field guide</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label">hours learned</span>
      <span class="ledger-num">${hours.toFixed(1)}</span>
      <span class="ledger-sub">across all practice sessions</span>
    </div>
    <div class="ledger-item">
      <span class="ledger-label">certificates</span>
      <span class="ledger-num">${certs}</span>
      <span class="ledger-sub">concepts at 70%+ mastery</span>
    </div>
  </section>

  <div class="dash-grid">
    <div class="dash-main">
      <section class="block" id="courses">
        <div class="block-head">
          <h2>Continue learning</h2>
          <div class="sub">your roadmap, rebuilt after every session</div>
        </div>
        <div class="courses-grid">
          ${top.length ? top.map((a, i) => courseCard(a, i, topicById)).join("") : `<div class="empty-italic">nothing queued yet — answer a practice round to build your plan.</div>`}
        </div>
        <div class="empty-italic" id="courses-empty" hidden>nothing here matches — try another word.</div>
      </section>

      <section class="block" id="rec">
        <div class="block-head">
          <h2>Recommended for you</h2>
          <div class="sub">ranked by forgetting risk, then exam weight</div>
        </div>
        <div class="rec-list">
          ${recommended.length ? recommended.map(recRow).join("") : `<div class="empty-italic">you've covered everything on the list — nice work.</div>`}
        </div>
        <div class="empty-italic" id="rec-empty" hidden>nothing matches — try a different search.</div>
      </section>
    </div>

    <aside class="rail">
      <div class="rail-block rise" style="--d:2">
        <div class="rail-head">Weekly pace <span class="sub">mastery target 70%</span></div>
        <div class="pace-ring" role="img" aria-label="${pacePct}% of concepts mastered">
          <svg viewBox="0 0 120 120">
            <circle class="ring-track" cx="60" cy="60" r="${R}"/>
            <circle class="ring-fill" cx="60" cy="60" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${ringOffset}"/>
          </svg>
          <div class="ring-center">
            <div class="ring-num">${certs}</div>
            <div class="ring-cap">of ${total}</div>
          </div>
        </div>
        <div class="pace-note">${certs ? `${certs} concept${certs === 1 ? "" : "s"} at 70%+ mastery` : "no certificates yet — keep practising"}</div>
      </div>

      <div class="rail-block rise" style="--d:3">
        <div class="rail-head">Upcoming <span class="sub">your next sessions</span></div>
        <div class="deadline-list">
          ${top.length ? top.map(ticket).join("") : `<div class="empty-italic">no sessions booked.</div>`}
        </div>
      </div>

      <div class="rail-block rise" style="--d:4">
        <div class="rail-head">Field notes <span class="sub">earned stamps</span></div>
        ${sealRow(d, st, actions, concepts)}
      </div>

      <div class="rail-block field-log rise" style="--d:5">
        <div class="rail-head">Field log</div>
        <textarea class="ruled-textarea" id="field-log" aria-label="Field log notes" placeholder="jot down what you noticed while you practised today…"></textarea>
        <div class="log-hint" id="log-hint">saved to this device</div>
      </div>
    </aside>
  </div>`;
}

async function renderDashboard() {
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell("overview", me, `<div class="loading">opening your field notebook…</div>`);
  wireShell();

  const d = await api(`/students/${me.student_id}/dashboard`).catch(async (err) => {
    if (String(err.message).includes("404")) {
      store.clear();
      navigate("/");
      return null;
    }
    alert(err.message);
    return null;
  });
  if (!d) return;
  dashboardCache = d;

  $("#nav-count-plan").textContent = (d.roadmap.actions || []).length;
  $("#nav-count-graph").textContent = d.stats.total_concepts;

  $("#main").innerHTML = dashboardHTML(d, me);
  if (pendingScroll) {
    const target = pendingScroll;
    pendingScroll = null;
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  wireDashboard(d, me);
}

function wireDashboard(d, me) {
  const startQuiz = (conceptId, type) =>
    navigate(`/quiz/${encodeURIComponent(conceptId)}/${encodeURIComponent(type)}`);

  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => startQuiz(b.dataset.start, b.dataset.type || "REVIEW")));
  document.querySelectorAll("[data-course]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/course/${encodeURIComponent(b.dataset.course)}`)));
  document.querySelectorAll("[data-revive]").forEach((b) =>
    b.addEventListener("click", () => startQuiz(b.dataset.revive, "RETENTION_DRILL")));

  // live search across course cards + recommended rows
  const search = $("#search");
  const coursesEmpty = $("#courses-empty");
  const recEmpty = $("#rec-empty");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let cardHits = 0;
    let recHits = 0;
    document.querySelectorAll(".course-card").forEach((el) => {
      const hit = !q || el.dataset.search.includes(q);
      el.hidden = !hit;
      if (hit) cardHits += 1;
    });
    document.querySelectorAll(".rec-row").forEach((el) => {
      const hit = !q || el.dataset.search.includes(q);
      el.hidden = !hit;
      if (hit) recHits += 1;
    });
    coursesEmpty.hidden = cardHits > 0;
    recEmpty.hidden = recHits > 0;
  });

  // notification bell
  const bell = $("#bell");
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

  // field log (Caveat placeholder, ruled lines; content kept locally)
  const log = $("#field-log");
  const hint = $("#log-hint");
  log.value = localStorage.getItem("fieldnote_log") || "";
  log.addEventListener("input", () => {
    try { localStorage.setItem("fieldnote_log", log.value); } catch { /* ignore */ }
    hint.textContent = "saved ✓";
    clearTimeout(log._t);
    log._t = setTimeout(() => { hint.textContent = "saved to this device"; }, 1600);
  });
}

/* ── Course file (course detail) ─────────────────────────────────────────── */
// Mirrors engines/roadmap.py determine_action_type so the lesson plan matches
// what the backend would schedule for this concept right now.
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

async function renderCourse(conceptId) {
  const me = store.get();
  if (!me) return renderOnboarding();

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

  const children = {};
  const parents = {};
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

  const main = $("#main");
  main.innerHTML = courseFileHTML({
    concept, rec, pct: Math.round(mastery * 100), attempts, confidence, forgettingRisk,
    plan, action, prereqIds, dependents, masteryById, cur,
  });
  $("#nav-count-plan").textContent = (dash.roadmap.actions || []).length;

  $("[data-nav-back]")?.addEventListener("click", () => navigate("/"));
  document.querySelectorAll("[data-course-start]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(b.dataset.courseStart)}/${encodeURIComponent(plan.type)}`)));
  document.querySelectorAll("[data-course-revive]").forEach((b) =>
    b.addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(b.dataset.courseRevive)}/RETENTION_DRILL`)));
}

function courseFileHTML(o) {
  const { concept, pct, attempts, confidence, forgettingRisk, plan, action, prereqIds, dependents, masteryById, cur } = o;
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
        ? "no prerequisites — this concept is a root of the field guide."
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

  return `
  <div class="wrap">
    <div class="pagebar">
      <button class="btn btn-ghost" data-nav-back>← Back to plan</button>
      <div class="crumb">course file · ${esc(concept.topic_id || "")}</div>
    </div>
    <article class="course-file">
      <header class="course-file-head rise" style="--d:0">
        <div class="kicker">field guide · ${esc(concept.topic_id || "")} · course file</div>
        <h1 class="greeting">${esc(concept.name)}</h1>
        <p class="status-line">${esc(concept.description || "")}</p>
        <div class="meta-chips">
          <span class="mchip">${level}</span>
          <span class="mchip">~${concept.estimated_minutes || 30} min / session</span>
          <span class="mchip">${stars}</span>
          <span class="mchip">exam weight ${Math.round(concept.exam_relevance * 100)}%</span>
          <span class="mchip">prerequisite impact ${Math.round(concept.prerequisite_impact * 100)}%</span>
        </div>
      </header>

      <div class="course-file-grid">
        <div class="course-file-main">
          <section class="block rise" style="--d:1">
            <div class="block-head"><h2>Lesson plan</h2><div class="sub">built from your mastery record</div></div>
            <div class="plan-list">
              ${planSteps.map((s, i) => `
              <div class="plan-step ${s.statusCls}">
                <div class="plan-num" aria-hidden="true">${i + 1}</div>
                <div>
                  <div class="plan-head">
                    <span class="plan-title">${s.title}</span>
                    <span class="plan-status ${s.statusCls}">${s.status}</span>
                  </div>
                  <div class="plan-body">${s.body}</div>
                </div>
              </div>`).join("")}
            </div>
          </section>

          <section class="block rise" style="--d:2">
            <div class="block-head"><h2>Prerequisites</h2><div class="sub">must know before this makes sense</div></div>
            ${prereqRows ? `<div class="prereq-list">${prereqRows}</div>` : `<div class="empty-italic">no prerequisites — this is a root of the field guide.</div>`}
          </section>

          <section class="block rise" style="--d:3">
            <div class="block-head"><h2>Unlocks</h2><div class="sub">what this course opens up</div></div>
            ${unlockRows ? `<div class="prereq-list">${unlockRows}</div>` : `<div class="empty-italic">nothing depends on this course yet.</div>`}
          </section>
        </div>

        <aside class="course-file-rail rise" style="--d:2">
          <div class="rail-block">
            <div class="rail-head">Course score <span class="sub">mastery</span></div>
            <div class="score-block">
              <div class="score-num">${pct}%</div>
              <div class="score-cap">current mastery</div>
              <div class="score-stats">
                <span>${attempts} answers logged</span>
                <span>${Math.round(confidence * 100)}% confident</span>
                <span class="risk">${Math.round(forgettingRisk * 100)}% forgetting risk</span>
              </div>
            </div>
          </div>

          <div class="rail-block">
            <div class="rail-head">Next session <span class="sub">${plan.type.replace(/_/g, " ").toLowerCase()}</span></div>
            <div class="facts" style="margin-top:10px">
              <div class="fact-row"><span class="k">questions</span><span class="v">${plan.questions}</span></div>
              <div class="fact-row"><span class="k">time</span><span class="v">~${plan.minutes} min</span></div>
              <div class="fact-row"><span class="k">difficulty</span><span class="v">${difficultyWord(plan.difficulty)}</span></div>
              ${action ? `<div class="fact-row"><span class="k">plan rank</span><span class="v">#${action.sequence_order}</span></div>` : ""}
            </div>
            <div class="cta-row">
              <button class="btn btn-primary" data-course-start="${esc(concept.concept_id)}">${action ? "Resume →" : "Start practice"}</button>
              ${forgettingRisk > 0.35 ? `<button class="btn btn-soft" data-course-revive="${esc(concept.concept_id)}">Warm-up drill →</button>` : ""}
            </div>
          </div>

          <div class="rail-block">
            <div class="rail-head">Course facts</div>
            <div class="facts" style="margin-top:10px">
              <div class="fact-row"><span class="k">level</span><span class="v">${level}</span></div>
              <div class="fact-row"><span class="k">session length</span><span class="v">~${concept.estimated_minutes || 30} min</span></div>
              <div class="fact-row"><span class="k">exam weight</span><span class="v">${Math.round(concept.exam_relevance * 100)}%</span></div>
              <div class="fact-row"><span class="k">unlocks</span><span class="v">${dependents.length} concept${dependents.length === 1 ? "" : "s"}</span></div>
            </div>
          </div>
        </aside>
      </div>
    </article>
  </div>`;
}

/* ── Quiz ────────────────────────────────────────────────────────────────── */
let quizState = null;

async function renderQuiz(conceptId, actionType) {
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell(null, me, `<div class="loading">preparing your questions…</div>`);
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
  <div class="wrap">
    <div class="pagebar">
      <button class="btn btn-ghost" data-nav-back>← Back to plan</button>
      <div class="crumb">practice round</div>
    </div>
    <div class="quiz-head">
      <div>
        <h1>${esc(q.concept_name)}</h1>
        <div class="mini">${esc(quizState.actionType.replace(/_/g, " "))} — answer with your reasoning, not your speed</div>
      </div>
      <div class="quiz-progress" id="quiz-progress"></div>
    </div>
    <div class="quiz-card" id="quiz-card"></div>
  </div>`;

  $("[data-nav-back]").addEventListener("click", () => navigate("/"));
  showQuestion();
}

function showQuestion() {
  const st = quizState;
  if (st.idx >= st.questions.length) return submitQuiz();
  const question = st.questions[st.idx];

  $("#quiz-progress").textContent = `question ${st.idx + 1} of ${st.questions.length} · ${st.questions.length - st.idx - 1} remaining`;
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
      <button class="btn btn-ghost" id="skip-q">Skip this question</button>
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
    }, 350);
  }
}

async function submitQuiz() {
  const st = quizState;
  $("#quiz-progress").textContent = "analysing your answers with the five engines…";
  $("#quiz-card").innerHTML = `<div class="loading">scoring, estimating ability, updating mastery and rebuilding your roadmap…</div>`;

  const res = await api("/assessments/submit", {
    method: "POST",
    body: JSON.stringify({ student_id: store.get().student_id, responses: st.answers }),
  });
  quizResults = { ...res, thetaBefore: st.thetaBefore, actionType: st.actionType, dashBefore: dashboardCache };
  dashboardCache = null;
  navigate("/results");
}

/* ── Results ─────────────────────────────────────────────────────────────── */
let quizResults = null;

function renderResults() {
  const r = quizResults;
  if (!r) return navigate("/");
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell(null, me, "");
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
  <div class="wrap">
    <div class="pagebar">
      <button class="btn btn-ghost" id="res-back">← Back to plan</button>
      <div class="crumb">results · roadmap rebuilt as version ${r.roadmap_version}</div>
    </div>
    <div class="results-hero">
      <div class="score-ring ${ringClass(r.score_percentage)}">${Math.round(r.score_percentage)}%</div>
      <h2>${r.score_percentage >= 70 ? "Nice work — the numbers moved" : r.score_percentage >= 40 ? "Solid attempt — here's exactly what to fix" : "Tough round — let's fix the root cause"}</h2>
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

    <div class="result-panel" style="margin-top:12px;">
      <h3>Your new roadmap</h3>
      <div class="roadmap" id="res-roadmap"></div>
    </div>
  </div>`;

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
      <div class="r-card ${a.reasons.some((x) => x.includes("Root foundational gap")) ? "is-gap" : a.action_type === "RETENTION_DRILL" ? "is-retention" : ""}">
        <div class="r-num">${a.sequence_order}</div>
        <div class="r-body">
          <div class="r-top"><span class="r-name">${esc(a.concept_name)}</span>
          <span class="chip chip-${esc(a.action_type)}">${a.action_type.replace(/_/g, " ")}</span></div>
          <div class="r-meta">${a.target_questions_count} questions · ~${a.estimated_minutes} min</div>
          <div class="r-reasons">${a.reasons.map((x) => `<div class="r-reason ${reasonClass(x)}"><span class="ic">${x.includes("Root foundational gap") ? "🧱" : x.includes("Spaced") ? "🔁" : "•"}</span><span>${esc(x)}</span></div>`).join("")}</div>
        </div>
      </div>`);
  });
  if (!r.roadmap_actions.length) rm.innerHTML = `<div class="mini">Roadmap generated on next session.</div>`;

  const review = r.item_results.filter((it) => !it.is_correct);
  if (review.length) {
    main.insertAdjacentHTML("beforeend", `
    <section class="block">
      <div class="block-head"><h2>Learn from each miss</h2><div class="sub">the classifier explains WHY, not just that you were wrong</div></div>
      <div class="roadmap">
        ${review.map((it) => {
          const meta = ERROR_LABEL[it.error_type] || ERROR_LABEL.UNKNOWN;
          return `
          <div class="r-card">
            <div class="r-body">
              <div class="r-top"><span class="r-name" style="font-size:14px;font-weight:650;">${esc(it.question_text)}</span></div>
              <div class="r-reasons">
                <div class="r-reason ${it.error_type === "GUESS" ? "is-forget" : ""}">
                  <span class="ic">${meta.ic}</span><span><b>${meta.label}</b> — ${esc(it.note)}</span>
                </div>
              </div>
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>`);
  }
}

/* ── Concept graph ───────────────────────────────────────────────────────── */
let graphData = null;

async function renderGraph() {
  const me = store.get();
  if (!me) return renderOnboarding();

  appEl.innerHTML = renderShell("graph", me, `<div class="loading">laying out the knowledge graph…</div>`);
  wireShell();

  const [cur, dash] = await Promise.all([
    graphData || api("/curriculum").then((d) => (graphData = d)),
    api(`/students/${me.student_id}/dashboard`),
  ]);
  const mastery = Object.fromEntries(dash.mastery.concepts.map((c) => [c.concept_id, c]));
  const actions = dash.roadmap.actions || [];

  // layered layout: x by depth from roots, y by position within layer
  const children = {};
  const parents = {};
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
  Object.entries(layers).forEach(([d, cs]) => {
    cs.forEach((c, i) => (pos[c.concept_id] = { x: +d * 200 + 90, y: i * 92 + 60 }));
  });

  const W = Math.max(...Object.values(pos).map((p) => p.x)) + 130;
  const H = Math.max(...Object.values(pos).map((p) => p.y)) + 70;

  const edgePaths = cur.edges.map((e) => {
    const a = pos[e.from], b = pos[e.to];
    const midX = (a.x + b.x) / 2;
    return { ...e, d: `M ${a.x} ${a.y} C ${midX} ${a.y}, ${midX} ${b.y}, ${b.x} ${b.y}` };
  });

  const main = $("#main");
  main.innerHTML = `
  <div class="wrap">
    <div class="pagebar">
      <button class="btn btn-ghost" data-nav-back>← Back to plan</button>
      <div class="crumb">concept map · prerequisite graph</div>
    </div>
    <div class="graph-toolbar">
      <b>Knowledge map</b>
      <button class="btn btn-ghost" id="g-fit">Fit view</button>
      <div class="legend">
        <span><span class="swatch" style="background:#3E8A7D"></span>≥70%</span>
        <span><span class="swatch" style="background:#D98E2B"></span>55–69%</span>
        <span><span class="swatch" style="background:#B4594A"></span>&lt;55%</span>
        <span><span class="swatch" style="background:#fff"></span>untouched</span>
        <span>🧱 = broken prerequisite</span>
      </div>
    </div>
    <div class="graph-card"><svg id="graph-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${Math.max(H, 420)}">
      ${edgePaths.map((e) => `<path class="edge ${e.strength >= 1 ? "edge-strong" : ""}" d="${e.d}"/>`).join("")}
      ${cur.concepts.map((c) => {
        const m = mastery[c.concept_id];
        const mv = m?.mastery ?? 0;
        const unseen = !m || m.attempts_count === 0;
        const fill = unseen ? "#fff" : mv >= 0.7 ? "#3E8A7D" : mv >= 0.55 ? "#D98E2B" : "#B4594A";
        const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
        const gap = inRoadmap?.reasons.some((r) => r.includes("Root foundational gap"));
        const stroke = gap ? "#8A3E33" : inRoadmap?.action_type === "RETENTION_DRILL" ? "#2B6E63" : "#F7F6F2";
        const p = pos[c.concept_id];
        return `
        <g class="node" data-concept="${esc(c.concept_id)}" transform="translate(${p.x},${p.y})">
          <circle r="26" fill="${fill}" stroke="${stroke}" stroke-width="${gap ? 4 : 3}"/>
          ${gap ? `<text y="-34" text-anchor="middle" font-size="16">🧱</text>` : ""}
          <text class="pct" y="44" text-anchor="middle">${unseen ? "—" : Math.round(mv * 100) + "%"}</text>
        </g>`;
      }).join("")}
    </svg></div>
    <div class="graph-side" id="g-side"></div>
  </div>`;

  $("[data-nav-back]").addEventListener("click", () => navigate("/"));

  // concept labels under nodes
  document.querySelectorAll("#graph-svg .node").forEach((g) => {
    const c = cur.concepts.find((x) => x.concept_id === g.dataset.concept);
    const p = pos[c.concept_id];
    const svgNS = "http://www.w3.org/2000/svg";
    const t = document.createElementNS(svgNS, "text");
    t.setAttribute("class", "lbl");
    t.setAttribute("x", p.x);
    t.setAttribute("y", p.y + 40);
    t.setAttribute("text-anchor", "middle");
    t.textContent = c.name;
    $("#graph-svg").appendChild(t);
  });

  const side = $("#g-side");
  side.innerHTML = `<b>Tip:</b> click any node for its stats and why it is (or isn't) in your roadmap. Arrows point from prerequisite → dependent concept.`;

  $("#graph-svg").addEventListener("click", (e) => {
    const node = e.target.closest(".node");
    if (!node) return;
    const c = cur.concepts.find((x) => x.concept_id === node.dataset.concept);
    const m = mastery[c.concept_id];
    const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
    const prereqs = cur.edges.filter((e) => e.to === c.concept_id).map((e) => cur.concepts.find((x) => x.concept_id === e.from)?.name);
    const unlocks = cur.edges.filter((e) => e.from === c.concept_id).map((e) => cur.concepts.find((x) => x.concept_id === e.to)?.name);
    side.innerHTML = `
      <b>${esc(c.name)}</b> — ${esc(c.topic_id)}<br>
      Mastery: <b>${m ? Math.round(m.mastery * 100) : 0}%</b> (${m && m.attempts_count ? Math.round(m.confidence * 100) + "% confident" : "no attempts yet"})
      · Forgetting risk: ${m ? Math.round(m.forgetting_risk * 100) : 0}%<br>
      Needs first: ${prereqs.length ? prereqs.map(esc).join(", ") : "<i>none — a foundation root</i>"} ·
      Unlocks: ${unlocks.length ? unlocks.map(esc).join(", ") : "<i>nothing yet</i>"}<br>
      Exam relevance: ${Math.round(c.exam_relevance * 100)}% · Prerequisite impact: ${Math.round(c.prerequisite_impact * 100)}%<br>
      ${inRoadmap ? `In your roadmap as <b>${inRoadmap.action_type.replace(/_/g, " ").toLowerCase()}</b>${inRoadmap.reasons.length ? " — " + inRoadmap.reasons[0].toLowerCase() : ""}` : "Not in the current roadmap"}
      <div style="margin-top:10px"><button class="btn btn-primary" id="g-start">Practice ${esc(c.name)}</button></div>`;
    $("#g-start").addEventListener("click", () => navigate(`/quiz/${encodeURIComponent(c.concept_id)}/${inRoadmap?.action_type || "REVIEW"}`));
  });

  $("#g-fit").addEventListener("click", () => {
    const svg = $("#graph-svg");
    svg.style.minWidth = "0";
    svg.setAttribute("width", Math.min(W, svg.parentElement.clientWidth - 10));
  });
}

/* ── Question bank (admin) — browse & add more questions ──────────────── */
let qbCurriculum = null; // /api/curriculum payload (concept list)
let qbFilter = "";      // "" = all concepts
let qbCorrectIdx = 0;    // which option is marked correct in the add form
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
          <span class="chip">${esc(qbConceptName(q.concept_id))}</span>
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
  return `<div class="empty-state" style="font-family:var(--font-hand);font-style:italic;font-size:18px;">${html}</div>`;
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
  if (!me) return renderOnboarding();
  if (!qbCurriculum || !qbCurriculum.concepts) {
    try { qbCurriculum = await api("/curriculum"); } catch { qbCurriculum = { concepts: [] }; }
  }
  graphData = qbCurriculum;

  appEl.innerHTML = renderShell("bank", me);
  wireShell();

  const main = $("#main");
  main.innerHTML = `
  <div class="wrap">
    <div class="qbk-head">
      <div>
        <h1>Question bank</h1>
        <p class="qbk-sub">the ledger of every question a student can be asked — add more one at a time or in bulk</p>
      </div>
      <button class="btn btn-primary" id="qb-add-toggle">＋ add one question</button>
    </div>

    <div class="qbk-tool">
      <select id="qb-concept" class="qbk-select" aria-label="Filter by concept">
        <option value="">All concepts</option>
        ${qbConceptOptions("")}
      </select>
      <span class="mini" id="qb-count"></span>
      <button class="btn btn-ghost" id="qb-bulk-toggle" style="margin-left:auto;">add many (JSON)</button>
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
      <label class="qbk-field" style="margin-top:12px;">
        <span>Question text</span>
        <textarea id="af-text" rows="2" placeholder="Stem of the MCQ, self-contained…"></textarea>
      </label>
      <div class="qbk-field" style="margin-top:12px;">
        <span>Options — click the letter of the correct one</span>
        <div id="af-options"></div>
      </div>
      <div class="qbk-grid4" style="margin-top:12px;">
        <label class="qbk-field">
          <span>Difficulty (0–1)</span>
          <input id="af-diff" type="number" min="0" max="1" step="0.05" value="0.5">
        </label>
        <label class="qbk-field">
          <span>Est. seconds</span>
          <input id="af-secs" type="number" min="10" step="5" value="60">
        </label>
      </div>
      <div class="qbk-msg" id="af-msg"></div>
      <button class="btn btn-primary" id="af-submit" style="margin-top:14px;">save question</button>
    </div>

    <div class="qbk-panel" id="qb-bulk-panel" hidden>
      <div class="qbk-panel-title">Bulk add — paste a JSON array</div>
      <label class="qbk-field" style="margin-top:10px;">
        <textarea id="bf-json" rows="8" spellcheck="false" placeholder='[{"concept_id": "c02", "question_text": "…", "options": ["…", "…", "…", "…"], "correct_answer": "B", "distractor_explanations": {"A": "CALCULATION_ERROR: …"}}]'></textarea>
      </label>
      <div class="mini" style="margin-top:6px;">Required: <b>concept_id</b>, <b>question_text</b>, <b>options</b> (exactly 4), <b>correct_answer</b> (letter A–D). Optional: question_id, difficulty, discrimination, estimated_time_seconds, distractor_explanations (wrong letter → "TAG: note").</div>
      <label class="qbk-check"><input type="checkbox" id="bf-replace"> replace existing question IDs instead of skipping</label>
      <div class="qbk-msg" id="bf-msg"></div>
      <button class="btn btn-primary" id="bf-submit" style="margin-top:14px;">add questions</button>
    </div>

    <div id="qb-list"></div>
  </div>`;

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
    qbRefreshList(listEl, countEl).catch((err) => {
      listEl.innerHTML = qbEmpty(esc(err.message));
    });
  });

  // ── add-one form ────────────────────────────────────────────────────
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
      if (i !== qbCorrectIdx && n.value.trim()) {
        distractor_explanations[LETTERS[i]] = n.value.trim();
      }
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
    } catch (err) {
      qbShowMsg(msg, err.message, "err");
    } finally {
      btn.disabled = false;
    }
  });

  // ── bulk JSON ───────────────────────────────────────────────────────
  $("#bf-submit").addEventListener("click", async () => {
    const msg = $("#bf-msg");
    let parsed;
    try {
      parsed = JSON.parse($("#bf-json").value);
    } catch {
      return qbShowMsg(msg, "That is not valid JSON — check the brackets and quotes.", "err");
    }
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
    } catch (err) {
      qbShowMsg(msg, err.message, "err");
    } finally {
      btn.disabled = false;
    }
  });

  qbRefreshList(listEl, countEl).catch((err) => {
    listEl.innerHTML = qbEmpty(esc(err.message));
  });
}

route();