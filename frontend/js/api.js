const API_BASE = "/api";

export function getToken() { return localStorage.getItem("token"); }
export function setSession(token, name, role) {
  localStorage.setItem("token", token);
  localStorage.setItem("name", name);
  localStorage.setItem("role", role);
}
export function getRole() { return localStorage.getItem("role"); }
export function getName() { return localStorage.getItem("name"); }
export function clearSession() { localStorage.clear(); }

export function getLastClassId() {
  const v = localStorage.getItem("lastClassId");
  return v ? parseInt(v) : null;
}
export function setLastClassId(id) { localStorage.setItem("lastClassId", id); }

// Escape text before inserting it into innerHTML. Anything that came from another
// user (class names, quiz titles, question text, options, topics, etc.) must go
// through this before being placed in a template string used as innerHTML.
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = "Token " + token;

  const res = await fetch(API_BASE + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.detail) || "Request failed");
  return data;
}

export function showToast(msg, type = "") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show " + type;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = ""; }, 2500);
}

export function socketUrl(classroomId) {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws/class/${classroomId}/?token=${getToken()}`;
}