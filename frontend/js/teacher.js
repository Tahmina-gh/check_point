import { api, getToken, getRole, getName, clearSession, showToast, socketUrl, getLastClassId, setLastClassId, escapeHtml } from "./api.js";

if (!getToken() || getRole() !== "teacher") window.location.href = "/";
document.getElementById("teacher-name").textContent = getName();
document.getElementById("logout-btn").onclick = () => { clearSession(); window.location.href = "/"; };

let classes = [];
let currentClassId = null;
let questionCount = 0;
let socket = null;
let currentPulse = null;

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
  const c = classes.find(x => x.id === currentClassId);
  document.getElementById("class-code").textContent = c.code;
  loadQuizzes();
  connectSocket();
}

document.getElementById("create-class-btn").onclick = async () => {
  const name = document.getElementById("new-class-name").value.trim();
  if (!name) return showToast("Enter a class name", "error");
  const created = await api("/classes/", { method: "POST", body: { name } });
  showToast("Class created!");
  setLastClassId(created.id);
  loadClasses();
};

function addQuestionRow() {
  questionCount++;
  const id = "q" + questionCount;
  const div = document.createElement("div");
  div.className = "question-block";
  div.dataset.qid = id;
  div.innerHTML = `
    <div class="question-block-header">
      <span class="question-number-badge">${questionCount}</span>
      <strong style="font-size:0.85rem; color:#555;">Question ${questionCount}</strong>
      <button type="button" class="remove-question-btn" title="Remove question">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <input type="text" class="q-text" placeholder="Question text">
    <input type="text" class="q-topic" placeholder="Topic (e.g. Definitions)">
    ${[0,1,2,3].map(i => `
      <div class="option-row-pro">
        <label class="radio-pill">
          <input type="radio" name="correct-${id}" value="${i}" ${i===0?"checked":""}>
          <span class="radio-pill-dot"></span>
        </label>
        <input type="text" class="q-opt" placeholder="Option ${i+1}">
      </div>`).join("")}
  `;
  document.getElementById("question-list").appendChild(div);

  div.querySelector(".remove-question-btn").addEventListener("click", () => div.remove());
}

document.getElementById("add-question-btn").onclick = addQuestionRow;
addQuestionRow();

document.getElementById("publish-btn").onclick = async () => {
  const title = document.getElementById("quiz-title").value.trim();
  const minutes = parseInt(document.getElementById("quiz-minutes").value);
  const blocks = document.querySelectorAll("#question-list > div");
  const questions = [];
  for (const b of blocks) {
    const text = b.querySelector(".q-text").value.trim();
    const topic = b.querySelector(".q-topic").value.trim() || "General";
    const options = [...b.querySelectorAll(".q-opt")].map(o => o.value.trim());
    const correct_index = parseInt(b.querySelector("input[type=radio]:checked").value);
    if (!text || options.some(o => !o)) return showToast("Fill in all fields", "error");
    questions.push({ text, topic, options, correct_index });
  }
  try {
    await api("/quizzes/", { method: "POST", body: { classroom_id: currentClassId, title, open_minutes: minutes, questions } });
    showToast("Quiz published!");
    document.getElementById("quiz-title").value = "";
    document.getElementById("question-list").innerHTML = "";
    questionCount = 0;
    addQuestionRow();
    loadQuizzes();
  } catch (err) { showToast(err.message, "error"); }
};

async function loadQuizzes() {
  const quizzes = await api(`/quizzes/?classroom_id=${currentClassId}`);
  const wrap = document.getElementById("quiz-list");
  wrap.innerHTML = quizzes.map(q => `
    <div class="card" style="cursor:pointer;" data-id="${q.id}">
      <div class="flex-between">
        <strong>${escapeHtml(q.title)}</strong>
        <span class="tag ${q.is_open ? "" : "tag-muted"}">${q.is_open ? "Open" : "Closed"}</span>
      </div>
      <div class="muted">${q.question_count} questions</div>
    </div>`).join("") || "<p class='muted'>No quizzes yet.</p>";
  wrap.querySelectorAll("[data-id]").forEach(el => {
    el.onclick = () => openResults(parseInt(el.dataset.id));
  });
}

async function openResults(quizId) {
  document.getElementById("results-modal").classList.remove("hidden");
  const data = await api(`/quizzes/${quizId}/results/`);
  document.getElementById("results-title").textContent = data.title;
  document.getElementById("results-body").innerHTML = `
    <p><strong>${data.response_count}</strong> responses - <strong>${data.avg_score}%</strong> average</p>
    ${data.per_question.map(p => `
      <div style="margin-bottom:12px;">
        <div class="flex-between"><span>${escapeHtml(p.text)} <span class="tag">${escapeHtml(p.topic)}</span></span><span>${p.pct}%</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${p.pct}%"></div></div>
      </div>`).join("")}
  `;
}
document.getElementById("close-results").onclick = () => document.getElementById("results-modal").classList.add("hidden");

function renderPulseOptions() {
  document.getElementById("pulse-options").innerHTML = [0,1,2,3].map(i => `
    <div class="flex gap" style="align-items:center; margin-bottom:8px;">
      <input type="radio" name="pulse-correct" value="${i}" ${i===0?"checked":""}>
      <input type="text" class="pulse-opt" placeholder="Option ${i+1}">
    </div>`).join("");
}
renderPulseOptions();

document.getElementById("go-live-btn").onclick = async () => {
  const question = document.getElementById("pulse-question").value.trim();
  const options = [...document.querySelectorAll(".pulse-opt")].map(o => o.value.trim());
  const correct_index = parseInt(document.querySelector("input[name=pulse-correct]:checked").value);
  if (!question || options.some(o => !o)) return showToast("Fill in all fields", "error");
  try {
    const pulse = await api("/pulses/", { method: "POST", body: { classroom_id: currentClassId, question, options, correct_index } });
    currentPulse = { ...pulse, correct_index, options };
    document.getElementById("end-live-btn").classList.remove("hidden");
    renderPulseResults([0,0,0,0]);
  } catch (err) { showToast(err.message, "error"); }
};

document.getElementById("end-live-btn").onclick = async () => {
  await api(`/pulses/${currentPulse.id}/end/`, { method: "POST" });
  currentPulse = null;
  document.getElementById("end-live-btn").classList.add("hidden");
  document.getElementById("pulse-results").innerHTML = "";
};

function renderPulseResults(counts) {
  const total = counts.reduce((a,b)=>a+b,0) || 1;
  document.getElementById("pulse-results").innerHTML = currentPulse.options.map((opt, i) => `
    <div style="margin-bottom:8px;">
      <div class="flex-between"><span>${escapeHtml(opt)} ${i===currentPulse.correct_index?'<span class="tag">Correct</span>':''}</span><span>${counts[i]}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round(100*counts[i]/total)}%"></div></div>
    </div>`).join("");
}

function connectSocket() {
  if (socket) socket.close();
  socket = new WebSocket(socketUrl(currentClassId));
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === "pulse_update" && currentPulse && msg.data.pulse_id === currentPulse.id) {
      renderPulseResults(msg.data.counts);
    }
  };
}

loadClasses();

document.getElementById("add-class-btn").addEventListener("click", () => {
  document.getElementById("no-class").classList.remove("hidden");
  document.getElementById("dashboard").classList.add("hidden");
});

document.getElementById("cancel-new-class").addEventListener("click", () => {
  document.getElementById("no-class").classList.add("hidden");
  document.getElementById("dashboard").classList.remove("hidden");
});

document.getElementById("copy-code-btn").addEventListener("click", () => {
  const code = document.getElementById("class-code").textContent;
  navigator.clipboard.writeText(code);

  const btn = document.getElementById("copy-code-btn");
  const label = document.getElementById("copy-code-label");
  btn.classList.add("copied");
  label.textContent = "Copied!";

  setTimeout(() => {
    btn.classList.remove("copied");
    label.textContent = "Copy";
  }, 1500);
});