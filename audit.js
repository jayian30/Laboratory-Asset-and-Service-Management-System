// ============================================================================
// AUDIT LOGGING MODULE
// ============================================================================

let auditLogRecords = [];
const AUDIT_DISPLAY_LIMIT = 300;

/**
 * Record a sensitive operation in audit_logs table (BR-A4-10)
 */
async function createAuditLog(action, module, recordId, description) {
    if (!isSupabaseReady()) return;

    try {
        const userId = currentUser ? currentUser.id : null;
        const userName = currentProfile ? currentProfile.full_name : (currentUser ? currentUser.email : "System User");
        const userRole = currentProfile ? currentProfile.role : "unknown";

        const { error } = await supabaseClient.from("audit_logs").insert([{
            user_id: userId,
            user_name: userName,
            user_role: userRole,
            action,
            module,
            record_id: String(recordId || ""),
            description
        }]);

        if (error) console.error("Failed to write audit log:", error.message);
    } catch (err) {
        console.error("Audit log error:", err);
    }
}

/**
 * Load Audit Logs (Admin only)
 */
async function loadAuditLogs({ silent = false } = {}) {
    if (!currentProfile || currentProfile.role !== "admin") return;

    const { data, error } = await supabaseClient
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);

    if (error) {
        console.error("Error loading audit logs:", error.message);
        if (!silent) toast("Could not load audit logs: " + error.message, "error");
        return;
    }

    auditLogRecords = data || [];
    displayAuditLogs();
}

function filteredAuditLogs() {
    const searchInput = document.getElementById("auditSearch")?.value.toLowerCase().trim() || "";
    const actionFilter = document.getElementById("auditActionFilter")?.value || "All";
    const moduleFilter = document.getElementById("auditModuleFilter")?.value || "All";

    return auditLogRecords.filter(item => {
        const text = `${item.user_name} ${item.action} ${item.module} ${item.description} ${item.record_id}`.toLowerCase();
        return text.includes(searchInput)
            && (actionFilter === "All" || item.action === actionFilter)
            && (moduleFilter === "All" || item.module === moduleFilter);
    });
}

/**
 * Render Audit Log records with search and filter
 */
function displayAuditLogs() {
    const tableBody = document.getElementById("auditLogTableBody");
    if (!tableBody) return;

    const filtered = filteredAuditLogs();
    const shown = filtered.slice(0, AUDIT_DISPLAY_LIMIT);

    const footer = document.getElementById("auditTableFooter");
    if (footer) {
        footer.textContent = filtered.length > shown.length
            ? `Showing latest ${shown.length} of ${filtered.length} matching entries. Export CSV for the full list.`
            : `Showing ${filtered.length} of ${auditLogRecords.length} entries`;
    }

    if (shown.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="empty-cell">${icon("scroll-text")}<p>No audit log records found.</p></td></tr>`;
        refreshIcons();
        return;
    }

    tableBody.innerHTML = shown.map(log => `
        <tr>
            <td class="nowrap"><small>${formatDateTime(log.created_at)}</small></td>
            <td>
                <strong>${escapeHTML(log.user_name)}</strong>
                <small class="block text-muted">${escapeHTML(roleLabel(log.user_role))}</small>
            </td>
            <td><span class="badge ${getAuditActionBadgeClass(log.action)}">${escapeHTML(log.action)}</span></td>
            <td>${escapeHTML(log.module)}</td>
            <td><code>${escapeHTML(log.record_id || "-")}</code></td>
            <td class="cell-wrap">${escapeHTML(log.description)}</td>
        </tr>`).join("");

    refreshIcons();
}

/** Download the currently filtered audit log as CSV */
function exportAuditLogsCSV() {
    const rows = filteredAuditLogs();
    if (rows.length === 0) {
        toast("There are no audit entries to export.", "info");
        return;
    }
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Date/Time", "User", "Role", "Action", "Module", "Record ID", "Description"];
    const lines = [header.map(esc).join(",")].concat(rows.map(l =>
        [new Date(l.created_at).toISOString(), l.user_name, l.user_role, l.action, l.module, l.record_id, l.description].map(esc).join(",")
    ));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `audit-logs-${todayStr()}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${rows.length} entries exported.`, "success", "Export complete");
}

function getAuditActionBadgeClass(action) {
    switch (action) {
        case "APPROVED": return "badge-success";
        case "REJECTED": return "badge-danger";
        case "RELEASED": return "badge-primary";
        case "RETURNED": return "badge-success";
        case "CREATED": return "badge-info";
        case "UPDATED": return "badge-violet";
        case "DELETED": return "badge-danger";
        case "CANCELLED": return "badge-secondary";
        case "MAINTENANCE_REQUESTED": return "badge-warning";
        case "MAINTENANCE_UPDATED": return "badge-warning";
        default: return "badge-secondary";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("auditSearch")?.addEventListener("input", displayAuditLogs);
    document.getElementById("auditActionFilter")?.addEventListener("change", displayAuditLogs);
    document.getElementById("auditModuleFilter")?.addEventListener("change", displayAuditLogs);
});
