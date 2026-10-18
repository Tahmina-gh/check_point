import { api, getToken, getRole, getName, clearSession, showToast, socketUrl, getLastClassId, setLastClassId, escapeHtml } from "./api.js";

if (!getToken() || getRole() !== "student") window.location.href = "/";
document.getElementById("student-name").textContent = getName();
document.getElementById("logout-btn").onclick = () => { clearSession(); window.location.href = "/"; };

let classes = [];
let currentClassId = null;
let socket = null;
let activePulse = null;
let currentQuiz = null;
let answers = {};

// ------------------------------------------------------------------
// In-progress quiz autosave (survives refresh / accidental tab close)
// ------------------------------------------------------------------
function draftKey() { return `quizDraft:${getToken()}`; }

function saveDraft() {
  if (!currentQuiz) return;
  localStorage.setItem(draftKey(), JSON.stringify({ quizId: currentQuiz.id, answers }));
}

function loadDraft() {
  const raw = localStorage.getItem(draftKey());
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

function clearDraft() { localStorage.removeItem(draftKey()); }

async function resumeDraftIfAny() {
  const draft = loadDraft();
  if (!draft) return;
  try {
    const quiz = await api(`/quizzes/${draft.quizId}/take/`);
    currentQuiz = quiz;
    answers = { ...draft.answers };
    document.getElementById("quiz-modal-title").textContent = quiz.title;
    document.getElementById("quiz-modal-mode").textContent = "Graded attempt - one submission only";
    renderQuizBody();
    document.getElementById("quiz-modal").classList.remove("hidden");
    showToast("Restored your in-progress answers");
  } catch (err) {
    clearDraft();
  }
}

async function loadClasses() {
  classes = await api("/classes/");
  if (classes.length === 0) {
    document.getElementById("no-class").classList.remove("hidden");
    document.getElementById("dashboard").classList.add("hidden");
    return;
  }
  document.getElementById("no-class").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
  const sel = document.getElementById("class-select");
  sel.innerHTML = classes.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  const saved = getLastClassId();
  currentClassId = classes.some(c => c.id === saved) ? saved : classes[0].id;
  sel.value = currentClassId;
  onClassChange();
}

document.getElementById("class-select").addEventListener("change", (e) => {
  currentClassId = parseInt(e.target.value);
  setLastClassId(currentClassId);
  onClassChange();
});

function onClassChange() {
  loadQuizzes();
  loadSkillMap();
  checkPulse();
  connectSocket();
}

document.getElementById("join-btn").onclick = async () => {
  const code = document.getElementById("join-code").value.trim().toUpperCase();
  if (!code) return showToast("Enter a code", "error");
  try {
    const joined = await api("/classes/join/", { method: "POST", body: { code } });
    showToast("Joined!");
    document.getElementById("join-code").value = "";
    setLastClassId(joined.id);
    loadClasses();
  } catch (err) { showToast(err.message, "error"); }
};

document.getElementById("join-another-btn").addEventListener("click", () => {
  document.getElementById("no-class").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
});

document.getElementById("cancel-join-class").addEventListener("click", () => {
  document.getElementById("no-class").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
});

async function loadQuizzes() {
  const quizzes = await api(`/quizzes/?classroom_id=${currentClassId}`);
  document.getElementById("quiz-list").innerHTML = quizzes.map(q => {
    let pillClass, label, cardClass;
    if (q.taken) {
      pillClass = "pill-completed"; label = `Completed - ${q.score}%`; cardClass = "quiz-card-default";
    } else if (q.is_open) {
      pillClass = "pill-open"; label = "Open now"; cardClass = "quiz-card-open";
    } else {
      pillClass = "pill-missed"; label = "Missed - quiz closed"; cardClass = "quiz-card-default";
    }
    const canAttempt = !q.taken && q.is_open;
    return `
      <div class="card ${cardClass}" style="border:none;">
        <div class="flex-between">
          <strong>${escapeHtml(q.title)}</strong>
          <span class="${pillClass}">${label}</span>
        </div>
        <div class="muted">${q.question_count} questions</div>
        ${canAttempt ? `<button class="btn btn-primary btn-sm start-btn" data-id="${q.id}" style="margin-top:8px;">Take quiz</button>` : ""}
      </div>`;
  }).join("") || "<p class='muted'>No quizzes yet.</p>";

  document.querySelectorAll(".start-btn").forEach(btn => {
    btn.onclick = () => openQuiz(parseInt(btn.dataset.id));
  });
}

async function openQuiz(quizId) {
  const quiz = await api(`/quizzes/${quizId}/take/`);
  currentQuiz = quiz;

  // Resume a saved draft only if it belongs to this same quiz; otherwise start fresh.
  const draft = loadDraft();
  if (draft && draft.quizId === quizId) {
    answers = { ...draft.answers };
  } else {
    answers = {};
    clearDraft();
  }

  document.getElementById("quiz-modal-title").textContent = quiz.title;
  document.getElementById("quiz-modal-mode").textContent = "Graded attempt - one submission only";
  renderQuizBody();
  document.getElementById("quiz-modal").classList.remove("hidden");
}

function renderQuizBody() {
  const body = document.getElementById("quiz-modal-body");
  body.innerHTML = currentQuiz.questions.map((q, qi) => `
    <div style="margin-bottom:20px;">
      <p><strong>${qi+1}. ${escapeHtml(q.text)}</strong> <span class="tag">${escapeHtml(q.topic)}</span></p>
      ${q.options.map((opt, oi) => `<button type="button" class="opt-btn" data-qid="${q.id}" data-oi="${oi}">${escapeHtml(opt)}</button>`).join("")}
    </div>
  `).join("") + `<button class="btn btn-primary btn-block hidden" id="finish-btn">Finish</button>`;

  // Re-apply any answers already selected (e.g. restored from an autosaved draft)
  Object.entries(answers).forEach(([qid, oi]) => {
    body.querySelectorAll(`[data-qid="${qid}"]`).forEach(b => {
      b.disabled = true;
      if (parseInt(b.dataset.oi) === oi) b.classList.add("selected");
    });
  });
  if (Object.keys(answers).length === currentQuiz.questions.length) {
    document.getElementById("finish-btn").classList.remove("hidden");
  }

  body.querySelectorAll(".opt-btn").forEach(btn => {
    btn.onclick = () => {
      const qid = parseInt(btn.dataset.qid);
      if (answers[qid] !== undefined) return;
      answers[qid] = parseInt(btn.dataset.oi);
      body.querySelectorAll(`[data-qid="${qid}"]`).forEach(b => {
        b.disabled = true;
        if (parseInt(b.dataset.oi) === answers[qid]) b.classList.add("selected");
      });
      saveDraft();
      if (Object.keys(answers).length === currentQuiz.questions.length) {
        document.getElementById("finish-btn").classList.remove("hidden");
      }
    };
  });

  document.getElementById("finish-btn")?.addEventListener("click", submitQuiz);
}

async function submitQuiz() {
  const answerList = Object.entries(answers).map(([qid, oi]) => ({ question_id: parseInt(qid), selected_index: oi }));
  let result;
  try {
    result = await api(`/quizzes/${currentQuiz.id}/submit/`, {
      method: "POST", body: { answers: answerList },
    });
  } catch (err) {
    // e.g. already submitted elsewhere, or the window closed while answering
    showToast(err.message, "error");
    clearDraft();
    document.getElementById("quiz-modal").classList.add("hidden");
    loadQuizzes();
    return;
  }

  clearDraft();

  const body = document.getElementById("quiz-modal-body");
  result.answers.forEach(a => {
    body.querySelectorAll(`[data-qid="${a.question_id}"]`).forEach(b => {
      const oi = parseInt(b.dataset.oi);
      if (oi === a.selected_index) b.classList.add(a.correct ? "correct" : "incorrect");
      if (oi === a.correct_index && !a.correct) b.classList.add("correct");
    });
  });
  document.getElementById("finish-btn").outerHTML = `<div class="tag" style="font-size:1rem;">Score: ${result.score}%</div>`;
  loadQuizzes();
  loadSkillMap();
}

document.getElementById("close-quiz").onclick = () => document.getElementById("quiz-modal").classList.add("hidden");

async function loadSkillMap() {
  const topics = await api(`/skillmap/?classroom_id=${currentClassId}`);
  const R = 34;
  const circumference = 2 * Math.PI * R;

  document.getElementById("skill-map").innerHTML = topics.map(t => {
    const offset = circumference * (1 - t.pct / 100);
    const color = t.pct >= 80 ? "#3f927f" : (t.pct < 50 ? "#f9d476" : "#99b384");
    return `
      <div class="skill-ring-item">
        <svg class="skill-ring-svg" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="${R}" class="ring-bg"></circle>
          <circle cx="50" cy="50" r="${R}" class="ring-progress" stroke="${color}"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
          <text x="50" y="57" text-anchor="middle">${t.pct}%</text>
        </svg>
        <div class="skill-ring-label">${escapeHtml(t.topic)}</div>
      </div>`;
  }).join("") || "<p class='muted'>Take a graded quiz to see your topics.</p>";
}

async function checkPulse() {
  const pulse = await api(`/pulses/active/?classroom_id=${currentClassId}`);
  activePulse = pulse;
  renderPulseBanner();
}

function renderPulseBanner() {
  const banner = document.getElementById("pulse-banner");
  if (!activePulse) { banner.classList.add("hidden"); return; }
  banner.classList.remove("hidden");
  document.getElementById("pulse-question").textContent = activePulse.question;
  document.getElementById("pulse-options").innerHTML = activePulse.options.map((opt, i) =>
    `<button type="button" class="opt-btn pulse-opt" data-oi="${i}">${escapeHtml(opt)}</button>`).join("");
  document.querySelectorAll(".pulse-opt").forEach(btn => {
    btn.onclick = async () => {
      try {
        await api(`/pulses/${activePulse.id}/answer/`, { method: "POST", body: { selected_index: parseInt(btn.dataset.oi) } });
        document.getElementById("pulse-answered").classList.remove("hidden");
        document.querySelectorAll(".pulse-opt").forEach(b => b.disabled = true);
      } catch (err) { showToast(err.message, "error"); }
    };
  });
}

function connectSocket() {
  if (socket) socket.close();
  socket = new WebSocket(socketUrl(currentClassId));
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "pulse_started") { activePulse = msg.data; renderPulseBanner(); }
    if (msg.type === "pulse_ended") { activePulse = null; renderPulseBanner(); }
  };
}

loadClasses();
resumeDraftIfAny();