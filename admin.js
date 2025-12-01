// admin.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDegKLau51gFIorZqxmzduD91iD-0jUPrQ",
  authDomain: "raiz-lab-system.firebaseapp.com",
  projectId: "raiz-lab-system",
  storageBucket: "raiz-lab-system.firebasestorage.app",
  messagingSenderId: "814467176636",
  appId: "1:814467176636:web:a33a55abe4c4e5d04ed8b9",
  measurementId: "G-RB0GG523MT"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const loginSection = document.getElementById("login-section");
const adminSection = document.getElementById("admin-section");
const loginForm = document.getElementById("admin-login-form");
const logoutBtn = document.getElementById("logout-btn");

const logsBody = document.getElementById("admin-logs-body");
const usersBody = document.getElementById("admin-users-body");
const exportLogsBtn = document.getElementById("export-logs");
const exportUsersBtn = document.getElementById("export-users");

onAuthStateChanged(auth, async (user) => {
  if (user) {
    // وارد شده
    loginSection.style.display = "none";
    adminSection.style.display = "flex";
    logoutBtn.style.display = "inline-flex";
    await loadAdminData();
  } else {
    // وارد نشده
    loginSection.style.display = "block";
    adminSection.style.display = "none";
    logoutBtn.style.display = "none";
  }
});

if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = loginForm.email.value.trim();
    const password = loginForm.password.value.trim();

    if (!email || !password) return;

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      console.error(err);
      alert("ورود ناموفق بود. لطفاً ایمیل و رمز عبور را بررسی کنید.");
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error(err);
    }
  });
}

async function loadAdminData() {
  await Promise.all([loadLogs(), loadUsers()]);
}

async function loadLogs() {
  try {
    const logsRef = collection(db, "logs");
    const q = query(logsRef, orderBy("timestamp", "desc"));
    const snap = await getDocs(q);

    const rows = [];
    logsBody.innerHTML = "";

    snap.forEach((docSnap) => {
      const log = docSnap.data();
      rows.push(log);

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
  }
}

async function loadUsers() {
  try {
    const usersRef = collection(db, "users");
    const snap = await getDocs(usersRef);

    const rows = [];
    usersBody.innerHTML = "";

    snap.forEach((docSnap) => {
      const user = docSnap.data();
      rows.push(user);

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
  }
}

// export CSV
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
        // escape "
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
