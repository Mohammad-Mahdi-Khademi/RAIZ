// --- داده‌های تجهیزات ثابت ---
const equipmentData = [
  {
    id: "RAIZ-001",
    key: "jetson-nano-board",
    name: "Jetson Nano Board",
    icon: "🤖",
    location: "کمد قطعات",
  },
  {
    id: "RAIZ-002",
    key: "jetracer-ros-ai-kit",
    name: "JetRacer ROS AI Kit",
    icon: "🚗",
    location: "میز",
  },
  {
    id: "RAIZ-003",
    key: "jetson-orin",
    name: "Jetson Orin",
    icon: "🤖",
    location: "کمد قطعات",
  },
  {
    id: "RAIZ-004",
    key: "3d-printer",
    name: "پرینتر سه‌بعدی",
    icon: "🧱",
    location: "کمد قطعات",
  },
  {
    id: "RAIZ-005",
    key: "raspberry-board",
    name: "Raspberry Pi Board",
    icon: "🍓",
    location: "کمد قطعات",
  },
  {
    id: "RAIZ-006",
    key: "raspberry-board",
    name: "Raspberry Pi Board",
    icon: "🍓",
    location: "کمد قطعات",
  },
];

const THEME_KEY = "raiz-theme";

let state = {
  equipmentStatus: {},
  logs: [],
};

// ==========================
// API helper
// ==========================
async function api(path, { method = "GET", body } = {}) {
  const opt = { method, headers: {} };

  if (body !== undefined) {
    opt.headers["Content-Type"] = "application/json";
    opt.body = JSON.stringify(body);
  }

  const r = await fetch(path, opt);

  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: "Invalid server response", raw: text };
  }

  if (!r.ok) {
    const msg = data?.error || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  return data;
}

// ==========================
// Initial boot
// ==========================
document.addEventListener("DOMContentLoaded", async () => {
  renderEquipmentCards();
  renderLogFilterOptions();
  initTheme();
  attachGlobalHandlers();

  await loadStateFromAPI();
  updateAllStatusUI();
  renderLogTable();
});

// ==========================
// Load state from API
// ==========================
async function loadStateFromAPI() {
  try {
    const data = await api("/api/state");

    // ایمن‌سازی: اگر سرور فیلدها رو نداد، کرش نکنه
    state.equipmentStatus = data?.equipmentStatus || {};
    state.logs = Array.isArray(data?.logs) ? data.logs : [];
  } catch (err) {
    console.error("Error loading data from API:", err);
    alert("خطا در دریافت اطلاعات از سرور. لطفاً اینترنت یا تنظیمات سرور را بررسی کنید.");
  }
}

// ==========================
// UI: Cards
// ==========================
function renderEquipmentCards() {
  const container = document.getElementById("equipment-list");
  if (!container) return;

  container.innerHTML = equipmentData
    .map(
      (item) => `
      <article class="equipment-card" data-key="${item.key}">
        <div class="equipment-card-inner">
          <div class="equipment-header">
            <div class="equipment-icon">${item.icon}</div>
            <div class="equipment-info">
              <h3>${item.name}</h3>
              <div class="equipment-id">کد: ${item.id}</div>
              <div class="equipment-location">محل نگه‌داری: ${item.location}</div>
            </div>
          </div>

          <div class="equipment-status">
            <div class="status-pill available" data-status-pill="${item.key}">
              <span class="status-icon">✅</span>
              <span class="status-text">آزاد</span>
            </div>
            <div class="status-time" data-status-time="${item.key}" style="font-size:.75rem; color:var(--muted-text);">
              بدون سابقه
            </div>
          </div>

          <div class="current-holder" data-current-holder="${item.key}">
            در حال حاضر نزد کسی نیست.
          </div>

          <form class="borrow-form" data-key="${item.key}">
            <div class="form-row">
              <label>نام و نام خانوادگی</label>
              <input name="fullName" type="text" required placeholder="مثلاً: محمد مهدی خادمی" />
            </div>
            <div class="form-row">
              <label>شماره دانشجویی</label>
              <input name="studentId" type="text" required placeholder="مثلاً: 400541234" />
            </div>
            <div class="form-row">
              <label>شماره تماس</label>
              <input name="phone" type="tel" required placeholder="مثلاً: 09121234567" />
            </div>
            <div class="form-row">
              <label>عملیات</label>
              <select name="action">
                <option value="borrow">برداشت</option>
                <option value="return">تحویل</option>
              </select>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn-primary">
                ثبت عملیات
              </button>
              <div class="helper-text">
                تاریخ و ساعت به صورت خودکار ثبت می‌شود.
              </div>
            </div>
          </form>
        </div>
      </article>
    `
    )
    .join("");

  updateAllStatusUI();
}

// ==========================
// UI: Status update
// ==========================
function updateAllStatusUI() {
  equipmentData.forEach((item) => updateStatusUIFor(item.key));
}

function updateStatusUIFor(key) {
  const status = state.equipmentStatus[key];
  const pill = document.querySelector(`[data-status-pill="${key}"]`);
  const timeEl = document.querySelector(`[data-status-time="${key}"]`);
  const holderEl = document.querySelector(`[data-current-holder="${key}"]`);

  if (!pill || !timeEl || !holderEl) return;

  if (!status) {
    pill.classList.remove("borrowed");
    pill.classList.add("available");
    pill.querySelector(".status-icon").textContent = "✅";
    pill.querySelector(".status-text").textContent = "آزاد";
    timeEl.textContent = "بدون سابقه";
    holderEl.textContent = "در حال حاضر نزد کسی نیست.";
    return;
  }

  const formatted = formatDateTime(status.timestamp);
  const phoneText = status.phone ? ` (شماره تماس: ${status.phone})` : "";

  if (status.lastAction === "borrow") {
    pill.classList.remove("available");
    pill.classList.add("borrowed");
    pill.querySelector(".status-icon").textContent = "⏳";
    pill.querySelector(".status-text").textContent = "در حال استفاده";
    timeEl.textContent = `برداشته شده در: ${formatted}`;
    holderEl.textContent = `نزد: ${status.fullName}${phoneText}`;
  } else {
    pill.classList.remove("borrowed");
    pill.classList.add("available");
    pill.querySelector(".status-icon").textContent = "✅";
    pill.querySelector(".status-text").textContent = "آزاد";
    timeEl.textContent = `آخرین تحویل در: ${formatted}`;
    holderEl.textContent = `آخرین استفاده توسط: ${status.fullName}${phoneText}`;
  }
}

// ==========================
// Handlers
// ==========================
function attachGlobalHandlers() {
  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!form.classList.contains("borrow-form")) return;
    event.preventDefault();
    handleBorrowFormSubmit(form);
  });

  const filterSelect = document.getElementById("log-filter");
  if (filterSelect) {
    filterSelect.addEventListener("change", () => {
      renderLogTable();
    });
  }

  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  const adminOpen = document.getElementById("admin-open");
  if (adminOpen) {
    adminOpen.addEventListener("click", () => {
      window.open("admin.html", "_blank");
    });
  }
}

// ==========================
// Submit operation (borrow/return)
// ==========================
async function handleBorrowFormSubmit(form) {
  const key = form.dataset.key;
  const fullName = (form.fullName.value || "").trim();
  const studentId = (form.studentId.value || "").trim();
  const phone = (form.phone.value || "").trim();
  const action = form.action.value; // borrow / return

  if (!fullName || !studentId || !phone) {
    alert("لطفاً نام، شماره دانشجویی و شماره تماس را کامل وارد کنید.");
    return;
  }

  const equipment = equipmentData.find((e) => e.key === key);
  const currentStatus = state.equipmentStatus[key];

  // محدودیت‌ها (کلاینت) — سرور هم باید همین‌ها رو دوباره چک کند
  if (action === "borrow") {
    if (currentStatus && currentStatus.lastAction === "borrow") {
      if (currentStatus.studentId !== studentId) {
        alert("این وسیله در حال حاضر نزد شخص دیگری است و فقط همان فرد می‌تواند تحویل دهد.");
        return;
      } else {
        alert("این وسیله همین حالا هم به نام شما در حال استفاده ثبت شده است.");
        return;
      }
    }
  } else if (action === "return") {
    if (!currentStatus || currentStatus.lastAction !== "borrow") {
      alert("این وسیله در حال حاضر به نام کسی در حال استفاده ثبت نشده است.");
      return;
    }
    if (currentStatus.studentId !== studentId) {
      alert("فقط فردی که وسیله را برداشته می‌تواند آن را تحویل دهد.");
      return;
    }
  }

  // ارسال به سرور
  try {
    const payload = {
      key,
      fullName,
      studentId,
      phone,
      action,
      equipmentName: equipment ? equipment.name : key,
      equipmentId: equipment ? equipment.id : key,
      location: equipment ? equipment.location : "",
    };

    const out = await api("/api/operation", { method: "POST", body: payload });

    const equipmentStatusItem = out?.equipmentStatusItem;
    const logEntry = out?.logEntry;

    if (equipmentStatusItem) {
      state.equipmentStatus[key] = equipmentStatusItem;
    } else {
      // fallback اگر سرور نداد
      state.equipmentStatus[key] = {
        lastAction: action,
        fullName,
        studentId,
        phone,
        timestamp: new Date().toISOString(),
      };
    }

    if (logEntry) {
      state.logs.unshift(logEntry);
    } else {
      state.logs.unshift({
        key,
        equipmentName: equipment ? equipment.name : key,
        fullName,
        studentId,
        phone,
        action,
        timestamp: new Date().toISOString(),
      });
    }

    updateStatusUIFor(key);
    renderLogTable();
    form.reset();
  } catch (err) {
    console.error("Error submitting operation:", err);
    alert("خطا در ثبت اطلاعات. لطفاً دوباره تلاش کنید.");
  }
}

// ==========================
// Logs table
// ==========================
function renderLogFilterOptions() {
  const select = document.getElementById("log-filter");
  if (!select) return;

  equipmentData.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.key;
    opt.textContent = `${item.name}`;
    select.appendChild(opt);
  });
}

function renderLogTable() {
  const tbody = document.getElementById("log-table-body");
  const filterSelect = document.getElementById("log-filter");
  if (!tbody) return;

  const filter = filterSelect ? filterSelect.value : "all";
  let logs = state.logs || [];

  if (filter !== "all") {
    logs = logs.filter((log) => log.key === filter);
  }

  if (logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align:center; color:var(--muted-text); padding:.7rem;">
          هنوز هیچ برداشتی ثبت نشده است.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = logs
    .map((log) => {
      const actionLabel = log.action === "borrow" ? "برداشت" : "تحویل";
      const actionIcon = log.action === "borrow" ? "⬆️" : "⬇️";

      return `
        <tr>
          <td>${log.equipmentName}</td>
          <td>${log.fullName}</td>
          <td>${log.phone || "-"}</td>
          <td>${actionIcon} ${actionLabel}</td>
          <td>${formatDateTime(log.timestamp)}</td>
        </tr>
      `;
    })
    .join("");
}

// ==========================
// Date format (fa-IR)
// ==========================
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

// ==========================
// Theme
// ==========================
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark") {
    document.body.classList.add("dark");
  } else {
    document.body.classList.remove("dark");
  }
  refreshThemeButton();
}

function toggleTheme() {
  document.body.classList.toggle("dark");
  const isDark = document.body.classList.contains("dark");
  localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
  refreshThemeButton();
}

function refreshThemeButton() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const isDark = document.body.classList.contains("dark");
  btn.textContent = isDark ? "☀️ حالت روشن" : "🌙 حالت تاریک";
}
