// ============================================================================
// SHARED UI HELPERS: icons, toasts, modal dialogs, date & formatting utilities
// ============================================================================

/* ---------- Icons (Lucide) ---------- */

function icon(name, extraClass = "") {
    return `<i data-lucide="${name}" class="icon ${extraClass}"></i>`;
}

let iconRefreshQueued = false;
function refreshIcons() {
    if (iconRefreshQueued) return;
    iconRefreshQueued = true;
    requestAnimationFrame(() => {
        iconRefreshQueued = false;
        if (window.lucide && typeof window.lucide.createIcons === "function") {
            window.lucide.createIcons();
        }
    });
}

/* ---------- Date helpers (local time, not UTC) ---------- */

function localDateStr(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}

function todayStr() {
    return localDateStr(new Date());
}

function addDaysStr(days, from = new Date()) {
    const d = new Date(from);
    d.setDate(d.getDate() + days);
    return localDateStr(d);
}

/** Whole days from today until the given YYYY-MM-DD date (negative = past). */
function daysUntil(dateStr) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    const target = new Date(y, m - 1, d);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((target - today) / 86400000);
}

function formatDate(value) {
    if (!value) return "-";
    const d = typeof value === "string" && value.length === 10 ? new Date(value + "T00:00:00") : new Date(value);
    if (isNaN(d)) return "-";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (isNaN(d)) return "-";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(value) {
    if (!value) return "";
    const diff = (Date.now() - new Date(value).getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return formatDate(value);
}

/** Human description of a due date relative to today. */
function dueLabel(dateStr) {
    const n = daysUntil(dateStr);
    if (n === null) return "";
    if (n < 0) return `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} overdue`;
    if (n === 0) return "Due today";
    if (n === 1) return "Due tomorrow";
    return `Due in ${n} days`;
}

function initials(name) {
    if (!name) return "?";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
}

function roleLabel(role) {
    switch (role) {
        case "admin": return "Administrator";
        case "staff": return "Laboratory Staff";
        default: return "Requester";
    }
}

function greeting() {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
}

/* ---------- Toast notifications ---------- */

function toast(message, type = "success", title = "") {
    let container = document.getElementById("toastContainer");
    if (!container) {
        container = document.createElement("div");
        container.id = "toastContainer";
        container.className = "toast-container";
        container.setAttribute("aria-live", "polite");
        document.body.appendChild(container);
    }

    const icons = { success: "circle-check", error: "circle-x", warning: "triangle-alert", info: "info" };
    const titles = { success: "Success", error: "Error", warning: "Warning", info: "Notice" };

    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "error" ? "alert" : "status");
    el.innerHTML = `
        <span class="toast-icon">${icon(icons[type] || "info")}</span>
        <div class="toast-body">
            <strong>${escapeHTML(title || titles[type] || "Notice")}</strong>
            <span>${escapeHTML(message)}</span>
        </div>
        <button class="toast-close" aria-label="Dismiss">${icon("x")}</button>
    `;
    el.querySelector(".toast-close").addEventListener("click", () => dismiss());
    container.appendChild(el);
    refreshIcons();

    const timer = setTimeout(dismiss, type === "error" ? 7000 : 4500);
    function dismiss() {
        clearTimeout(timer);
        el.classList.add("toast-leave");
        setTimeout(() => el.remove(), 200);
    }
}

/* ---------- Modal dialogs ---------- */

/**
 * Generic modal. Resolves with the form values object on confirm, or null on cancel.
 * fields: [{ name, label, type: 'text'|'textarea'|'select'|'date'|'number', options:[{value,label}], value, required, placeholder, help }]
 */
function openModal({ title, message = "", fields = [], bodyHtml = "", confirmText = "Confirm", cancelText = "Cancel", variant = "primary", iconName = "", hideConfirm = false, wide = false }) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";

        const fieldHtml = fields.map(f => {
            const id = `modal_${f.name}`;
            const req = f.required ? "required" : "";
            let control = "";
            if (f.type === "select") {
                control = `<select id="${id}" name="${f.name}" ${req}>${(f.options || []).map(o =>
                    `<option value="${escapeHTML(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${escapeHTML(o.label)}</option>`).join("")}</select>`;
            } else if (f.type === "textarea") {
                control = `<textarea id="${id}" name="${f.name}" rows="3" placeholder="${escapeHTML(f.placeholder || "")}" ${req}>${escapeHTML(f.value || "")}</textarea>`;
            } else {
                control = `<input id="${id}" name="${f.name}" type="${f.type || "text"}" value="${escapeHTML(f.value ?? "")}" placeholder="${escapeHTML(f.placeholder || "")}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${req}>`;
            }
            return `<div class="form-group"><label for="${id}">${escapeHTML(f.label)}${f.required ? " *" : ""}</label>${control}${f.help ? `<small class="field-help">${escapeHTML(f.help)}</small>` : ""}</div>`;
        }).join("");

        overlay.innerHTML = `
            <form class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modalTitle" novalidate>
                <div class="modal-header">
                    ${iconName ? `<span class="modal-icon modal-icon-${variant}">${icon(iconName)}</span>` : ""}
                    <div>
                        <h3 id="modalTitle">${escapeHTML(title)}</h3>
                        ${message ? `<p class="modal-message">${escapeHTML(message)}</p>` : ""}
                    </div>
                </div>
                ${fieldHtml || bodyHtml ? `<div class="modal-body">${bodyHtml}${fieldHtml}</div>` : ""}
                <div class="modal-footer">
                    <button type="button" class="btn btn-light" data-cancel>${escapeHTML(cancelText)}</button>
                    ${hideConfirm ? "" : `<button type="submit" class="btn btn-${variant}">${escapeHTML(confirmText)}</button>`}
                </div>
            </form>
        `;

        const form = overlay.querySelector("form");
        const close = (result) => {
            document.removeEventListener("keydown", onKey);
            overlay.classList.add("modal-leave");
            setTimeout(() => overlay.remove(), 150);
            resolve(result);
        };
        const onKey = (e) => { if (e.key === "Escape") close(null); };

        overlay.querySelector("[data-cancel]").addEventListener("click", () => close(null));
        overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(null); });
        document.addEventListener("keydown", onKey);

        form.addEventListener("submit", (e) => {
            e.preventDefault();
            const values = {};
            for (const f of fields) {
                const el = form.elements[f.name];
                const v = el.value.trim();
                if (f.required && !v) {
                    el.classList.add("invalid");
                    el.focus();
                    return;
                }
                values[f.name] = v;
            }
            close(values);
        });

        document.body.appendChild(overlay);
        refreshIcons();
        const first = form.querySelector("input, select, textarea") || form.querySelector("button[type=submit]");
        setTimeout(() => first?.focus(), 30);
    });
}

async function confirmDialog(title, message, { confirmText = "Confirm", variant = "primary", iconName = "circle-help" } = {}) {
    const result = await openModal({ title, message, confirmText, variant, iconName });
    return result !== null;
}

/** Disable a button while an async action runs (prevents double submissions). */
async function withBusy(button, fn) {
    if (button) {
        if (button.disabled) return;
        button.disabled = true;
        button.classList.add("is-busy");
    }
    try {
        return await fn();
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove("is-busy");
        }
    }
}

window.icon = icon;
window.refreshIcons = refreshIcons;
window.toast = toast;
window.openModal = openModal;
window.confirmDialog = confirmDialog;
