// ============================================================================
// AUDIT LOGGING MODULE
// ============================================================================

let auditLogRecords = [];

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
            action: action,
            module: module,
            record_id: String(recordId || ""),
            description: description
        }]);

        if (error) {
            console.error("Failed to write audit log:", error.message);
        }
    } catch (err) {
        console.error("Audit log error:", err);
    }
}

/**
 * Load and display Audit Logs for Administrator (Admin Only)
 */
async function loadAuditLogs() {
    if (!currentProfile || currentProfile.role !== "admin") {
        console.warn("Audit logs restricted to administrators.");
        return;
    }

    const { data, error } = await supabaseClient
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error loading audit logs:", error.message);
        return;
    }

    auditLogRecords = data || [];
    displayAuditLogs();
}

/**
 * Render Audit Log records with Search and Filter
 */
function displayAuditLogs() {
    const tableBody = document.getElementById("auditLogTableBody");
    if (!tableBody) return;

    const searchInput = document.getElementById("auditSearch")?.value.toLowerCase() || "";
    const actionFilter = document.getElementById("auditActionFilter")?.value || "All";
    const moduleFilter = document.getElementById("auditModuleFilter")?.value || "All";

    const filtered = auditLogRecords.filter(item => {
        const textToSearch = `${item.user_name} ${item.action} ${item.module} ${item.description} ${item.record_id}`.toLowerCase();
        const matchesSearch = textToSearch.includes(searchInput);
        const matchesAction = actionFilter === "All" || item.action === actionFilter;
        const matchesModule = moduleFilter === "All" || item.module === moduleFilter;

        return matchesSearch && matchesAction && matchesModule;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-cell">No audit log records found.</td>
            </tr>
        `;
        return;
    }

    filtered.forEach(log => {
        const formattedDate = new Date(log.created_at).toLocaleString();
        const row = document.createElement("tr");

        row.innerHTML = `
            <td><small>${formattedDate}</small></td>
            <td>
                <strong>${escapeHTML(log.user_name)}</strong>
                <br><span class="badge badge-role">${escapeHTML(log.user_role)}</span>
            </td>
            <td><span class="badge ${getAuditActionBadgeClass(log.action)}">${escapeHTML(log.action)}</span></td>
            <td>${escapeHTML(log.module)}</td>
            <td><code>${escapeHTML(log.record_id || "-")}</code></td>
            <td>${escapeHTML(log.description)}</td>
        `;

        tableBody.appendChild(row);
    });
}

function getAuditActionBadgeClass(action) {
    switch (action) {
        case "APPROVED": return "badge-success";
        case "REJECTED": return "badge-danger";
        case "RELEASED": return "badge-info";
        case "RETURNED": return "badge-primary";
        case "CREATED": return "badge-secondary";
        case "DELETED": return "badge-danger";
        case "LOGIN": return "badge-light";
        case "LOGOUT": return "badge-light";
        default: return "badge-secondary";
    }
}

// DOM Event Listeners for Audit Log filters
document.addEventListener("DOMContentLoaded", () => {
    const search = document.getElementById("auditSearch");
    const actionFilter = document.getElementById("auditActionFilter");
    const moduleFilter = document.getElementById("auditModuleFilter");

    if (search) search.addEventListener("input", displayAuditLogs);
    if (actionFilter) actionFilter.addEventListener("change", displayAuditLogs);
    if (moduleFilter) moduleFilter.addEventListener("change", displayAuditLogs);
});
