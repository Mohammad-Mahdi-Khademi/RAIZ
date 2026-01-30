const loginSection = document.getElementById("login-section");
const adminSection = document.getElementById("admin-section");
const loginForm = document.getElementById("admin-login-form");
const logoutBtn = document.getElementById("logout-btn");

const logsBody = document.getElementById("admin-logs-body");
const usersBody = document.getElementById("admin-users-body");
const exportLogsBtn = document.getElementById("export-logs");
const exportUsersBtn = document.getElementById("export-users");

const ADMIN_TOKEN_KEY = "raiz-admin-token";

// ------------------ API helper ------------------
async function api(path, { method = "GET", body, auth = true } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  if (auth) {
    const token = localStorage.getItem(ADMIN_TOKEN_KEY);
    if (token) headers.Authorization = "Bearer " + token;
  }

  const r = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "Invalid server response", raw: text };
  }

  if (!r.ok) {
    throw new Error(data?.error || `HTTP ${r.status}`);
  }
  return data;
}

// ------------------ Auth state ------------------
function setLoggedInUI(isLoggedIn) {
  if (isLoggedIn) {
    loginSection.style.display = "none";
    adminSection.style.display = "flex";
    logoutBtn.style.display = "inline-flex";
  } else {
    loginSection.style.display = "block";
    adminSection.style.display = "none";
    logoutBtn.style.display = "none";
  }
}

async function bootstrap() {
  const token = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (!token) {
    setLoggedInUI(false);
    return;
  }
  
  try {
    setLoggedInUI(true);
    await loadAdminData();
  } catch (e) {
    console.error(e);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setLoggedInUI(false);
  }
}

bootstrap();

// ------------------ Login ------------------
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value.trim();
    if (!email || !password) return;

    try {
      const out = await api("/api/admin/login", {
        method: "POST",
        body: { email, password },
        auth: false,
      });

      if (!out?.idToken) throw new Error("Missing token");
      localStorage.setItem(ADMIN_TOKEN_KEY, out.idToken);

      setLoggedInUI(true);
      await loadAdminData();
    } catch (err) {
      console.error(err);
      alert("ورود ناموفق بود. لطفاً ایمیل و رمز عبور را بررسی کنید.");
    }
  });
}

// ------------------ Logout ------------------
if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    setLoggedInUI(false);
  });
}

// ------------------ Load Admin Data ------------------
async function loadAdminData() {
  await Promise.all([loadLogs(), loadUsers()]);
}

async function loadLogs() {
  try {
    const out = await api("/api/admin/logs");
    const rows = Array.isArray(out?.logs) ? out.logs : [];

    logsBody.innerHTML = "";
    rows.forEach((log) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${log.equipmentName || ""}</td>
        <td>${log.fullName || ""}</td>
        <td>${log.studentId || ""}</td>
        <td>${log.phone || ""}</td>
        <td>${log.action === "borrow" ? "برداشت" : "تحویل"}</td>
        <td>${formatDateTime(log.timestamp)}</td>
      `;
      logsBody.appendChild(tr);
    });

    // ذخیره برای export
    logsBody._data = rows;
  } catch (err) {
    console.error("Error loading logs:", err);
    throw err;
  }
}

async function loadUsers() {
  try {
    const out = await api("/api/admin/users");
    const rows = Array.isArray(out?.users) ? out.users : [];

    usersBody.innerHTML = "";
    rows.forEach((user) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${user.fullName || ""}</td>
        <td>${user.studentId || ""}</td>
        <td>${user.phone || ""}</td>
      `;
      usersBody.appendChild(tr);
    });

    usersBody._data = rows;
  } catch (err) {
    console.error("Error loading users:", err);
    throw err;
  }
}

// ------------------ Export CSV ------------------
if (exportLogsBtn) {
  exportLogsBtn.addEventListener("click", () => {
    const data = logsBody._data || [];
    const header = ["equipmentName", "fullName", "studentId", "phone", "action", "timestamp"];
    downloadCsv("logs.csv", header, data);
  });
}

if (exportUsersBtn) {
  exportUsersBtn.addEventListener("click", () => {
    const data = usersBody._data || [];
    const header = ["fullName", "studentId", "phone"];
    downloadCsv("users.csv", header, data);
  });
}

function downloadCsv(filename, header, rows) {
  const lines = [];
  lines.push(header.join(","));
  rows.forEach((row) => {
    const line = header
      .map((key) => {
        const val = row[key] != null ? String(row[key]) : "";
        const escaped = val.replace(/"/g, '""');
        return `"${escaped}"`;
      })
      .join(",");
    lines.push(line);
  });

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(d);
  } catch {
    return iso;
  }
}
