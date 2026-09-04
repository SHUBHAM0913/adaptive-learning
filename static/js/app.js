/* ── MasteryOS frontend (vanilla JS, no build step) ──────────────────────── */
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

function masteryColor(m) {
  if (m >= 0.7) return "green";
  if (m >= 0.55) return "amber";
  if (m >= 0.35) return "red";
  return "red";
}
function barClass(m) {
  if (m >= 0.7) return "bar-green";
  if (m >= 0.55) return "bar-amber";
  return "bar-red";
}
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

function renderTopbar(sub) {
  return `
  <div class="topbar">
    <div class="topbar-inner">
      <div class="logo" data-nav="/">
        <div class="logo-mark">◎</div> MasteryOS
      </div>
      <div class="topbar-spacer"></div>
      ${sub || ""}
    </div>
  </div>`;
}

function navigate(path) {
  history.pushState(null, "", path);
  route();
}

window.addEventListener("popstate", route);

function route() {
  const path = location.pathname;
  if (path === "/") {
    const me = store.get();
    if (me) return renderDashboard();
    return renderOnboarding();
  }
  const m = path.match(/^\/quiz\/([^/]+)\/([^/]+)/);
  if (m) return renderQuiz(decodeURIComponent(m[1]), decodeURIComponent(m[2]));
  if (path === "/graph") return renderGraph();
  if (path === "/results") return renderResults();
  if (path === "/questions") return renderQuestionBank();
  renderOnboarding();
}

/* ── Onboarding ──────────────────────────────────────────────────────────── */
function renderOnboarding() {
  appEl.innerHTML = `
  <div class="onboard">
    <div class="logo"><div class="logo-mark">◎</div> MasteryOS</div>
    <h1>Learn what you don't know, <em>in the right order.</em></h1>
    <p>Every answer you give rebuilds a personal study plan from five
    learning-science models — mastery, knowledge tracing, ability estimation,
    forgetting curves, and prerequisite logic. No videos to binge. No fake streaks.</p>
    <form class="onboard-form" id="onboard-form">
      <input id="onboard-name" placeholder="Your name" autocomplete="name" maxlength="60" required>
      <button class="btn btn-primary btn-lg" type="submit">Start learning</button>
      <div class="hint">Your plan is rebuilt after every practice session.</div>
    </form>
    <div class="divider">or</div>
    <button class="btn btn-ghost" id="onboard-demo">Explore the demo student's dashboard</button>
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

async function renderDashboard() {
  const me = store.get();
  if (!me) return renderOnboarding();
  appEl.innerHTML = renderTopbar(`
    <div class="student-chip"><span class="dot"></span>${esc(me.name)}</div>
    <button class="btn btn-ghost" id="nav-bank">Question bank</button>
    <button class="btn btn-ghost" id="nav-graph">Concept map</button>
    <button class="btn btn-ghost" id="nav-logout">Switch student</button>
  `);
  $("#nav-bank").addEventListener("click", () => navigate("/questions"));
  $("#nav-graph").addEventListener("click", () => navigate("/graph"));
  $("#nav-logout").addEventListener("click", () => { store.clear(); navigate("/"); });

  $("#app").insertAdjacentHTML("beforeend", `<div class="loading">Loading your study plan…</div>`);
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

  const s = d.student;
  const st = d.stats;
  const actions = d.roadmap.actions || [];
  const forgetting = (d.mastery.forgetting_alerts || []).filter((c) => !actions.some((a) => a.concept_id === c.concept_id));

  const thetaPct = Math.round(((s.irt_ability + 3) / 6) * 100);
  const avgPct = Math.round(st.avg_mastery * 100);

  appEl.insertAdjacentHTML("beforeend", `
  <div class="wrap">
    <div class="hero">
      <div class="hero-card">
        <div class="label">Estimated ability (IRT θ)</div>
        <div class="theta-value">${s.irt_ability >= 0 ? "+" : ""}${s.irt_ability.toFixed(2)}</div>
        <div class="theta-scale">on the −3 … +3 ability scale, estimated from difficulty-corrected answers</div>
        <div class="bar bar-teal"><div style="width:${thetaPct}%"></div></div>
      </div>
      <div class="hero-card">
        <div class="label">Concepts mastered (≥ 70%)</div>
        <div class="theta-value">${st.mastered_count}<small style="font-size:16px;color:var(--text-3);font-weight:500;"> / ${st.total_concepts}</small></div>
        <div class="theta-scale">average mastery ${avgPct}% · ${st.attempts} answers logged</div>
        <div class="bar ${avgPct >= 55 ? "bar-green" : "bar-amber"}"><div style="width:${avgPct}%"></div></div>
      </div>
    </div>

    <section class="block">
      <div class="block-head">
        <h2>Learn next — your personal roadmap</h2>
        <div class="sub">rebuilt after every session · every reason is calculated, not guessed</div>
      </div>
      <div class="roadmap" id="roadmap-list">
        ${actions.length ? actions.map(roadmapCard).join("") : `<div class="empty-state">No roadmap yet — complete a practice session to generate one.</div>`}
      </div>
    </section>

    ${forgetting.length ? `
    <section class="block">
      <div class="block-head">
        <h2>About to forget</h2>
        <div class="sub">memory decays — a 5-minute drill stops it</div>
      </div>
      <div class="forget-strip">
        ${forgetting.map((c) => `
          <div class="forget-card">
            <div class="fc-name">${esc(c.name)}</div>
            <div class="fc-risk">${Math.round(c.forgetting_risk * 100)}% forgetting risk · ${Math.round(c.mastery * 100)}% mastered</div>
            <div class="fc-actions"><button class="btn btn-soft" data-quick="${esc(c.concept_id)}">Revive it</button></div>
          </div>`).join("")}
      </div>
    </section>` : ""}

    <section class="block">
      <div class="block-head">
        <h2>Your mastery map</h2>
        <div class="sub">dashed border = low confidence (too few answers to be sure)</div>
      </div>
      <div class="heatmap" id="heatmap">
        ${d.mastery.concepts.map((c) => {
          const mv = c.mastery;
          const unseen = c.attempts_count === 0;
          return `
          <div class="h-cell mv-${masteryColor(mv)} ${c.confidence < 0.4 ? "low-conf" : ""} ${unseen ? "is-unseen" : ""}" data-concept="${esc(c.concept_id)}">
            <div class="h-name">${esc(c.name)}</div>
            <div class="h-val">${Math.round(mv * 100)}%</div>
            <div class="h-meta">${unseen ? "not attempted yet" : `${c.attempts_count} answers · ${Math.round(c.confidence * 100)}% sure`}</div>
          </div>`;
        }).join("")}
      </div>
    </section>
  </div>`);

  // wire start buttons
  document.querySelectorAll("[data-start]").forEach((b) =>
    b.addEventListener("click", () => {
      const a = actions.find((x) => x.concept_id === b.dataset.start);
      navigate(`/quiz/${encodeURIComponent(a.concept_id)}/${encodeURIComponent(a.action_type)}`);
    }));
  document.querySelectorAll("[data-quick]").forEach((b) =>
    b.addEventListener("click", () =>
      navigate(`/quiz/${encodeURIComponent(b.dataset.quick)}/RETENTION_DRILL`)));

  $("#heatmap").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-concept]");
    if (!cell) return;
    const c = d.mastery.concepts.find((x) => x.concept_id === cell.dataset.concept);
    const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
    alert([
      `${c.name}`,
      `Mastery ${Math.round(c.mastery * 100)}% (confidence ${Math.round(c.confidence * 100)}%)`,
      `Exam relevance ${Math.round(c.exam_relevance * 100)}% · ${c.attempts_count} answers`,
      inRoadmap ? `In your roadmap: ${inRoadmap.action_type.replace(/_/g, " ").toLowerCase()}` : "Not in the current roadmap",
    ].join("\n"));
  });
}

function roadmapCard(a) {
  const gap = a.action_type === "FOUNDATION_REBUILD" && a.reasons.some((r) => r.includes("Root foundational gap"));
  const retention = a.action_type === "RETENTION_DRILL";
  const pct = Math.round(a.priority_score * 100);
  const mv = a.mastery ?? 0;
  return `
  <div class="r-card ${gap ? "is-gap" : retention ? "is-retention" : ""}">
    <div class="r-num">${a.sequence_order}</div>
    <div class="r-body">
      <div class="r-top">
        <span class="r-name">${esc(a.concept_name)}</span>
        <span class="chip chip-${esc(a.action_type)}">${a.action_type.replace(/_/g, " ")}</span>
      </div>
      <div class="r-meta">${a.target_questions_count} questions · ~${a.estimated_minutes} min · priority ${pct}%</div>
      <div class="r-reasons">
        ${a.reasons.map((r) => `<div class="r-reason ${reasonClass(r)}"><span class="ic">${r.includes("Root foundational gap") ? "🧱" : r.includes("Spaced") ? "🔁" : "•"}</span><span>${esc(r)}</span></div>`).join("")}
      </div>
      <div class="r-foot">
        <div class="mastery-row">
          <div class="bar ${barClass(mv)} ${mv === 0 ? "bar-empty" : ""}"><div style="width:${Math.round(mv * 100)}%"></div></div>
          <span class="pct">${Math.round(mv * 100)}%</span>
        </div>
        <button class="btn btn-primary r-start" data-start="${esc(a.concept_id)}">Start practice</button>
      </div>
    </div>
  </div>`;
}

/* ── Quiz ────────────────────────────────────────────────────────────────── */
let quizState = null;

async function renderQuiz(conceptId, actionType) {
  const me = store.get();
  appEl.innerHTML = renderTopbar(`
    <button class="btn btn-ghost" data-nav-back>← Back to plan</button>
  `);
  $("#app").insertAdjacentHTML("beforeend", `<div class="loading">Preparing your questions…</div>`);
  $("[data-nav-back]")?.addEventListener("click", () => navigate("/"));

  const action = (dashboardCache?.roadmap.actions || []).find((a) => a.concept_id === conceptId);
  const q = await api(`/students/${me.student_id}/quiz/${conceptId}?count=${action?.target_questions_count || 5}&difficulty=${action?.target_difficulty || 0.5}`);

  quizState = {
    conceptId,
    actionType: action?.action_type || actionType || "REVIEW",
    questions: q.questions,
    idx: 0,
    answers: [],           // {question_id, student_answer, time_taken_seconds}
    thetaBefore: dashboardCache?.student.irt_ability ?? null,
    startedAt: Date.now(),
    timer: null,
  };

  appEl.insertAdjacentHTML("beforeend", `
  <div class="wrap">
    <div class="quiz-head">
      <div>
        <h1 style="font-size:22px;letter-spacing:-0.5px;">${esc(q.concept_name)}</h1>
        <div class="mini">${esc(quizState.actionType.replace(/_/g, " "))} — answer with your reasoning, not your speed</div>
      </div>
      <div class="quiz-progress" id="quiz-progress"></div>
    </div>
    <div class="quiz-card" id="quiz-card"></div>
  </div>`);

  quizState.thetaBefore = dashboardCache?.student.irt_ability ?? null;
  showQuestion();
}

function showQuestion() {
  const st = quizState;
  if (st.idx >= st.questions.length) return submitQuiz();
  const question = st.questions[st.idx];

  $("#quiz-progress").textContent = `Question ${st.idx + 1} of ${st.questions.length} · ${st.questions.length - st.idx - 1} remaining`;
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
      answer("", question.estimated_time_seconds); // timed out = no answer
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
  $("#quiz-progress").textContent = "Analysing your answers with the five engines…";
  $("#quiz-card").innerHTML = `<div class="loading">Scoring, estimating ability, updating mastery and rebuilding your roadmap…</div>`;

  const res = await api("/assessments/submit", {
    method: "POST",
    body: JSON.stringify({ student_id: store.get().student_id, responses: st.answers }),
  });
  quizResults = { ...res, thetaBefore: st.thetaBefore, actionType: st.actionType };
  dashboardCache = null; // force fresh dashboard after roadmap rebuild
  navigate("/results");
}

/* ── Results ─────────────────────────────────────────────────────────────── */
let quizResults = null;

function renderResults() {
  const r = quizResults;
  if (!r) return navigate("/");
  const me = store.get();
  appEl.innerHTML = renderTopbar(`
    <div class="student-chip"><span class="dot"></span>${esc(me.name)}</div>
    <button class="btn btn-ghost" id="res-back">Back to plan</button>
  `);
  $("#res-back").addEventListener("click", () => navigate("/"));

  const thetaBefore = r.thetaBefore ?? 0;
  const thetaDelta = r.irt_theta - thetaBefore;
  const byError = {};
  r.item_results.forEach((it) => {
    if (it.is_correct) return;
    const t = it.error_type || "UNKNOWN";
    byError[t] = (byError[t] || 0) + 1;
  });

  appEl.insertAdjacentHTML("beforeend", `
  <div class="wrap">
    <div class="results-hero">
      <div class="score-ring ${ringClass(r.score_percentage)}">${Math.round(r.score_percentage)}%</div>
      <h2>${r.score_percentage >= 70 ? "Nice work — the numbers moved" : r.score_percentage >= 40 ? "Solid attempt — here's exactly what to fix" : "Tough round — let's fix the root cause"}</h2>
      <p>${r.correct_count}/${r.total_questions} correct · ability θ ${thetaBefore >= 0 ? "+" : ""}${thetaBefore.toFixed(2)} → ${r.irt_theta >= 0 ? "+" : ""}${r.irt_theta.toFixed(2)} (${thetaDelta >= 0 ? "+" : ""}${thetaDelta.toFixed(2)}) · roadmap rebuilt as version ${r.roadmap_version}</p>
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
  </div>`);

  const deltas = $("#res-deltas");
  r.concept_mastery_updates.forEach((u) => {
    const before = (dashboardCache?.mastery.concepts.find((c) => c.concept_id === u.concept_id)?.mastery) ?? 0;
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
    appEl.insertAdjacentHTML("beforeend", `
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
  appEl.innerHTML = renderTopbar(`
    <button class="btn btn-ghost" data-nav-back>← Back to plan</button>
    <button class="btn btn-ghost" id="nav-bank">Question bank</button>
  `);
  $("[data-nav-back]").addEventListener("click", () => navigate("/"));
  $("#nav-bank").addEventListener("click", () => navigate("/questions"));
  appEl.insertAdjacentHTML("beforeend", `<div class="loading">Laying out the knowledge graph…</div>`);

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

  appEl.insertAdjacentHTML("beforeend", `
  <div class="wrap">
    <div class="graph-toolbar">
      <b>Knowledge map</b>
      <button class="btn btn-ghost" id="g-fit">Fit view</button>
      <div class="legend">
        <span><span class="swatch" style="background:#16a34a"></span>≥70%</span>
        <span><span class="swatch" style="background:#f59e0b"></span>55–69%</span>
        <span><span class="swatch" style="background:#ef4444"></span>&lt;55%</span>
        <span><span class="swatch" style="background:#e5e7eb;border:1px dashed #cbd5e1"></span>untouched</span>
        <span>🧱 = broken prerequisite</span>
      </div>
    </div>
    <div class="graph-card"><svg id="graph-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${Math.max(H, 420)}">
      ${edgePaths.map((e) => `<path class="edge ${e.strength >= 1 ? "edge-strong" : ""}" d="${e.d}"/>`).join("")}
      ${cur.concepts.map((c) => {
        const m = mastery[c.concept_id];
        const mv = m?.mastery ?? 0;
        const unseen = !m || m.attempts_count === 0;
        const fill = unseen ? "#e5e7eb" : mv >= 0.7 ? "#16a34a" : mv >= 0.55 ? "#f59e0b" : "#ef4444";
        const inRoadmap = actions.find((a) => a.concept_id === c.concept_id);
        const gap = inRoadmap?.reasons.some((r) => r.includes("Root foundational gap"));
        const stroke = gap ? "#dc2626" : inRoadmap?.action_type === "RETENTION_DRILL" ? "#0f766e" : "#fff";
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
  </div>`);

  // concept labels under nodes (outside svg coords clash avoided by using svg text)
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

/* ── Question bank (admin) — browse and add more questions ────────────── */
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
  <div class="qm-card">
    <div class="qm-main">
      <div class="qm-caret">▸</div>
      <div class="qm-body">
        <div class="qm-top">
          <span class="chip chip-REVIEW">${esc(qbConceptName(q.concept_id))}</span>
          <span class="qm-id">${esc(q.question_id)}</span>
        </div>
        <div class="qm-qtext">${esc(q.question_text)}</div>
        <div class="qm-meta">difficulty ${q.difficulty.toFixed(2)} · ~${q.estimated_time_seconds}s · discrimination ${q.discrimination.toFixed(1)}</div>
      </div>
    </div>
    <div class="qm-detail">
      <div class="qm-detail-inner">
        ${q.options.map((opt, i) => {
          const letter = LETTERS[i];
          const correct = letter === q.correct_answer;
          const note = notes[letter];
          return `
        <div class="qm-opt ${correct ? "correct" : ""}">
          <span class="key">${letter}</span>
          <span class="qm-opt-text">${esc(opt)}</span>
          ${correct ? `<span class="qm-ok">correct</span>` : ""}
          ${note ? `<span class="qm-note">${esc(note)}</span>` : ""}
        </div>`;
        }).join("")}
      </div>
    </div>
  </div>`;
}

async function qbRefreshList(listEl, countEl) {
  const data = await api(`/questions${qbFilter ? `?concept_id=${encodeURIComponent(qbFilter)}` : ""}`);
  countEl.textContent = data.count ? `${data.count} question${data.count === 1 ? "" : "s"}` : "";
  const shown = data.questions.slice(0, QB_VISIBLE_LIMIT);
  if (!shown.length) {
    listEl.innerHTML = `<div class="empty-state">No questions yet for this filter — add one with <b>＋ Add one question</b> above, or bulk-import from the exambench dataset with <b>hf_import.py</b>.</div>`;
  } else {
    listEl.innerHTML = shown.map(qbQuestionCard).join("") +
      (data.questions.length > QB_VISIBLE_LIMIT
        ? `<div class="mini" style="text-align:center;padding-top:8px">Showing the first ${QB_VISIBLE_LIMIT} — filter by concept or add server-side paging for more.</div>`
        : "");
  }
  listEl.querySelectorAll(".qm-card").forEach((card) => {
    card.querySelector(".qm-main").addEventListener("click", () => card.classList.toggle("open"));
  });
}

function qbShowMsg(el, text, kind) {
  el.textContent = text;
  el.classList.add("show");
  el.classList.toggle("ok", kind === "ok");
  el.classList.toggle("err", kind === "err");
}

async function renderQuestionBank() {
  try {
    qbCurriculum = qbCurriculum || (await api("/curriculum"));
  } catch {
    qbCurriculum = { concepts: [] };
  }

  appEl.innerHTML = renderTopbar(`
    <button class="btn btn-ghost" data-nav-back>← Back</button>
  `);
  $("[data-nav-back]").addEventListener("click", () => navigate("/"));

  appEl.insertAdjacentHTML("beforeend", `
  <div class="wrap">
    <div class="qbank-head">
      <div>
        <h1>Question bank</h1>
        <div class="sub">browse what students get asked · add more questions one at a time or as JSON</div>
      </div>
      <button class="btn btn-primary" id="qb-add-toggle">＋ Add one question</button>
    </div>

    <div class="qbank-toolbar">
      <select id="qb-concept" aria-label="Filter by concept">
        <option value="">All concepts</option>
        ${qbConceptOptions("")}
      </select>
      <span class="mini" id="qb-count"></span>
      <button class="btn btn-ghost" id="qb-bulk-toggle" style="margin-left:auto;">{ } Add many (JSON)</button>
    </div>

    <div class="panel" id="qb-add-panel" hidden>
      <div class="qm-grid2">
        <div class="field">
          <label for="af-concept">Concept</label>
          <select id="af-concept">${qbConceptOptions("")}</select>
        </div>
        <div class="field">
          <label for="af-id">Question ID (optional)</label>
          <input id="af-id" type="text" placeholder="auto-generated if empty">
        </div>
      </div>
      <div class="field" style="margin-top:10px;">
        <label for="af-text">Question text</label>
        <textarea id="af-text" rows="2" placeholder="Stem of the MCQ, self-contained…"></textarea>
      </div>
      <div class="field" style="margin-top:10px;">
        <label>Options — click the letter of the <b>correct</b> one</label>
        <div id="af-options"></div>
      </div>
      <div class="qm-grid4" style="margin-top:12px;">
        <div class="field">
          <label for="af-diff">Difficulty (0–1)</label>
          <input id="af-diff" type="number" min="0" max="1" step="0.05" value="0.5">
        </div>
        <div class="field">
          <label for="af-secs">Est. seconds</label>
          <input id="af-secs" type="number" min="10" step="5" value="60">
        </div>
      </div>
      <div class="qm-msg" id="af-msg"></div>
      <button class="btn btn-primary" id="af-submit" style="margin-top:12px;">Save question</button>
    </div>

    <div class="panel" id="qb-bulk-panel" hidden>
      <h3>Bulk add — paste a JSON array</h3>
      <div class="field" style="margin-top:8px;">
        <textarea id="bf-json" rows="8" spellcheck="false" placeholder='[{"concept_id": "c02", "question_text": "…", "options": ["…", "…", "…", "…"], "correct_answer": "B", "distractor_explanations": {"A": "CALCULATION_ERROR: …"}}]'></textarea>
      </div>
      <div class="mini" style="margin-top:6px;">Required: <b>concept_id</b>, <b>question_text</b>, <b>options</b> (exactly 4), <b>correct_answer</b> (letter A–D). Optional: question_id, difficulty, discrimination, estimated_time_seconds, distractor_explanations (wrong letter → "TAG: note").</div>
      <label class="qm-check"><input type="checkbox" id="bf-replace"> Replace existing question IDs instead of skipping</label>
      <div class="qm-msg" id="bf-msg"></div>
      <button class="btn btn-primary" id="bf-submit" style="margin-top:12px;">Add questions</button>
    </div>

    <div id="qb-list"></div>
  </div>`);

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

  // concept filter in the toolbar drives the server-side ?concept_id= param
  $("#qb-concept").addEventListener("change", (e) => {
    qbFilter = e.target.value;
    qbRefreshList(listEl, countEl).catch((err) => {
      listEl.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    });
  });

  // ── add-one form ────────────────────────────────────────────────────
  function paintCorrect() {
    document.querySelectorAll(".mark").forEach((m, i) => {
      m.classList.toggle("active", i === qbCorrectIdx);
      m.setAttribute("aria-pressed", String(i === qbCorrectIdx));
    });
  }
  $("#af-options").innerHTML = LETTERS.map((letter, i) => `
    <div class="opt-row">
      <button type="button" class="mark" data-idx="${i}" aria-pressed="false" title="mark as correct">${letter}</button>
      <input class="opt-text" type="text" data-idx="${i}" placeholder="Option ${letter} text">
      <input class="opt-note" type="text" data-idx="${i}" placeholder="why a wrong pick happens (optional)">
    </div>`).join("");
  paintCorrect();
  $("#af-options").addEventListener("click", (e) => {
    const m = e.target.closest(".mark");
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

  // initial list
  qbRefreshList(listEl, countEl).catch((err) => {
    listEl.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  });
}

route();