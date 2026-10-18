import { api, setSession, getToken, getRole, showToast } from "./api.js";

if (getToken()) {
  window.location.href = getRole() === "teacher" ? "/teacher.html" : "/student.html";
}

const modal = document.getElementById("auth-modal");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const pillTrack = document.getElementById("modal-pill-track");
const authCard = document.querySelector(".auth-card");

function openModal(showSignup) {
  modal.classList.remove("hidden");
  showTab(showSignup);
}
function showTab(showSignup) {
  loginForm.classList.toggle("hidden", showSignup);
  signupForm.classList.toggle("hidden", !showSignup);
  document.getElementById("modal-tab-login").classList.toggle("active", !showSignup);
  document.getElementById("modal-tab-signup").classList.toggle("active", showSignup);
  pillTrack.classList.toggle("signup", showSignup);
}

function setNavPill(showSignup) {
  document.getElementById("tab-login").classList.toggle("active", !showSignup);
  document.getElementById("tab-signup").classList.toggle("active", showSignup);
}

document.getElementById("tab-login").addEventListener("click", () => { openModal(false); setNavPill(false); });
document.getElementById("tab-signup").addEventListener("click", () => { openModal(true); setNavPill(true); });
document.getElementById("hero-get-started").addEventListener("click", () => { openModal(true); setNavPill(true); });
document.getElementById("bottom-get-started")?.addEventListener("click", () => { openModal(true); setNavPill(true); });document.getElementById("modal-tab-login").addEventListener("click", () => showTab(false));
document.getElementById("modal-tab-signup").addEventListener("click", () => showTab(true));
document.getElementById("close-modal").addEventListener("click", () => modal.classList.add("hidden"));

// Role picker cards
document.querySelectorAll(".role-card").forEach(card => {
  card.addEventListener("click", () => {
    document.querySelectorAll(".role-card").forEach(c => c.classList.remove("active"));
    card.classList.add("active");
    document.getElementById("signup-role").value = card.dataset.role;
  });
});

// Show/hide password
document.querySelectorAll(".password-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    const isPassword = input.type === "password";
    input.type = isPassword ? "text" : "password";
    btn.textContent = isPassword ? "Hide" : "Show";
  });
});

function shakeCard() {
  authCard.classList.remove("shake");
  void authCard.offsetWidth;
  authCard.classList.add("shake");
}

async function goToDashboard(role) {
  authCard.classList.add("success-pulse");
  await new Promise(r => setTimeout(r, 250));
  window.location.href = role === "teacher" ? "/teacher.html" : "/student.html";
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/auth/login/", {
      method: "POST",
      body: {
        email: document.getElementById("login-email").value,
        password: document.getElementById("login-password").value,
      },
    });
    setSession(data.token, data.name, data.role);
    goToDashboard(data.role);
  } catch (err) {
    showToast(err.message, "error");
    shakeCard();
  }
});

signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/auth/signup/", {
      method: "POST",
      body: {
        name: document.getElementById("signup-name").value,
        email: document.getElementById("signup-email").value,
        password: document.getElementById("signup-password").value,
        role: document.getElementById("signup-role").value,
      },
    });
    setSession(data.token, data.name, data.role);
    goToDashboard(data.role);
  } catch (err) {
    showToast(err.message, "error");
    shakeCard();
  }
});