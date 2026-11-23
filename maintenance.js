// ============================================================================
// MAINTENANCE REQUESTS MANAGEMENT
// ============================================================================

let maintenanceRecords = [];

/**
 * Load maintenance requests (Admin & Staff)
 */
async function loadMaintenance({ silent = false } = {}) {
    if (!isSupabaseReady()) return;
    const role = currentProfile?.role;
    if (role !== "admin" && role !== "staff") return;

    const { data, error } = await supabaseClient
        .from("maintenance_requests")
        .select(`
            *,
            equipment ( name, equipment_code, category, location, status ),
            profiles:requested_by ( full_name )
        `)
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading maintenance requests:", error.message);
        if (!silent) toast("Could not load maintenance records: " + error.message, "error");
        return;
    }

    maintenanceRecords = data || [];
    displayMaintenance();
}

/**
 * Render maintenance table
 */
function displayMaintenance() {
    const tableBody = document.getElementById("maintenanceTableBody");
    if (!tableBody) return;

    renderMaintenanceSummary();

    const search = document.getElementById("maintenanceSearch")?.value.toLowerCase().trim() || "";
    const filter = document.getElementById("maintenanceStatusFilter")?.value || "All";

    const filtered = maintenanceRecords.filter(item => {
        const text = `#${item.id} ${item.equipment?.name} ${item.equipment?.equipment_code} ${item.issue_description} ${item.profiles?.full_name}`.toLowerCase();
        return text.includes(search) && (filter === "All" || item.status === filter);
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-cell">${icon("wrench")}<p>No maintenance tickets match your filters.</p></td></tr>`;
        refreshIcons();
        return;
    }

    const role = currentProfile ? currentProfile.role : "requester";

    tableBody.innerHTML = filtered.map(item => {
        let actionHtml = "";
        if (role === "admin" || role === "staff") {
            if (item.status === "Pending") {
                actionHtml = `<button class="btn-action btn-info" onclick="updateMaintenanceStatus(${item.id}, 'In Maintenance', this)">${icon("play")}Start</button>
                              <button class="btn-icon" title="Cancel ticket" onclick="updateMaintenanceStatus(${item.id}, 'Cancelled', this)">${icon("ban")}</button>`;
            } else if (item.status === "In Maintenance") {
                actionHtml = `<button class="btn-action btn-success" onclick="updateMaintenanceStatus(${item.id}, 'Completed', this)">${icon("check")}Complete</button>`;
            } else {
                actionHtml = `<span class="text-muted small">Closed</span>`;
            }
        }

        return `
            <tr>
                <td><strong>#${item.id}</strong></td>
                <td>
                    <div class="cell-asset">
                        <span class="asset-icon">${icon(getCategoryIcon(item.equipment?.category))}</span>
                        <div><strong>${escapeHTML(item.equipment?.name)}</strong><small><code>${escapeHTML(item.equipment?.equipment_code)}</code> · ${escapeHTML(item.equipment?.location || "")}</small></div>
                    </div>
                </td>
                <td class="cell-wrap">${escapeHTML(item.issue_description)}</td>
                <td>${formatDate(item.created_at)}<small class="block text-muted">by ${escapeHTML(item.profiles?.full_name || "Staff")}</small></td>
                <td class="cell-wrap">${escapeHTML(item.resolution_notes || "-")}${item.status === "Completed" ? `<small class="block text-muted">${formatDate(item.updated_at)}</small>` : ""}</td>
                <td>${maintenanceStatusBadge(item.status)}</td>
                <td class="text-right nowrap">${actionHtml}</td>
            </tr>`;
    }).join("");

    refreshIcons();
}

function renderMaintenanceSummary() {
    const el = document.getElementById("maintenanceSummaryChips");
    if (!el) return;
    const count = s => maintenanceRecords.filter(m => m.status === s).length;
    el.innerHTML = `
        <div class="chip-stat"><span>Total tickets</span><strong>${maintenanceRecords.length}</strong></div>
        <div class="chip-stat"><span class="dot dot-warning"></span><span>Pending</span><strong>${count("Pending")}</strong></div>
        <div class="chip-stat"><span class="dot dot-info"></span><span>In maintenance</span><strong>${count("In Maintenance")}</strong></div>
        <div class="chip-stat"><span class="dot dot-good"></span><span>Completed</span><strong>${count("Completed")}</strong></div>
    `;
}

/**
 * Submit Maintenance Request
 */
async function submitMaintenanceRequest(event) {
    event.preventDefault();

    if (!currentUser || (currentProfile?.role !== "admin" && currentProfile?.role !== "staff")) {
        return toast("Only Admin and Staff can submit maintenance requests.", "error", "Unauthorized");
    }

    const equipmentId = document.getElementById("maintEquipmentSelect").value;
    const issueDescription = document.getElementById("maintIssueDescription").value.trim();

    if (!equipmentId || !issueDescription) return toast("Please select equipment and describe the issue.", "warning");

    const open = maintenanceRecords.find(m => String(m.equipment_id) === String(equipmentId) && ["Pending", "In Maintenance"].includes(m.status));
    if (open) return toast(`Ticket #${open.id} is already open for this equipment.`, "warning", "Duplicate ticket");

    const btn = document.getElementById("maintSubmitBtn");
    await withBusy(btn, async () => {
        const { data: req, error } = await supabaseClient
            .from("maintenance_requests")
            .insert([{ equipment_id: Number(equipmentId), requested_by: currentUser.id, issue_description: issueDescription, status: "Pending" }])
            .select()
            .single();

        if (error) return toast("Failed to create maintenance request: " + friendlyDbError(error), "error");

        // BR-A4-09: equipment under maintenance cannot be borrowed
        await supabaseClient.from("equipment").update({ status: "Maintenance" }).eq("id", equipmentId);

        const equip = equipmentRecords.find(e => String(e.id) === String(equipmentId));
        await createAuditLog("MAINTENANCE_REQUESTED", "Maintenance", req.id, `Reported issue on ${equip?.name || "equipment #" + equipmentId}: ${issueDescription}`);

        toast(`Ticket #${req.id} logged. The equipment is now blocked from borrowing.`, "success", "Issue logged");
        document.getElementById("maintenanceForm")?.reset();
        await refreshAllData();
    });
}

/**
 * Update Maintenance Status (In Maintenance / Completed / Cancelled)
 */
async function updateMaintenanceStatus(id, newStatus, btn) {
    const item = maintenanceRecords.find(m => m.id === id);
    if (!item) return;

    let notes = item.resolution_notes || "";

    if (newStatus === "Completed") {
        const result = await openModal({
            title: `Complete ticket #${id}`,
            message: `${item.equipment?.name} (${item.equipment?.equipment_code})`,
            fields: [
                { name: "notes", label: "Resolution notes", type: "textarea", required: true, value: "Equipment repaired and tested. Ready for use." },
                {
                    name: "condition", label: "Condition after repair", type: "select", value: "Good",
                    options: [{ value: "Good", label: "Good" }, { value: "Fair", label: "Fair" }, { value: "Damaged", label: "Damaged - beyond repair" }]
                }
            ],
            confirmText: "Mark completed",
            variant: "success",
            iconName: "check"
        });
        if (!result) return;
        notes = result.notes;
        item._condition = result.condition;
    } else if (newStatus === "Cancelled") {
        const ok = await confirmDialog(`Cancel ticket #${id}?`, "The equipment will be returned to service.", { confirmText: "Cancel ticket", variant: "danger", iconName: "ban" });
        if (!ok) return;
        notes = notes || "Ticket cancelled - no repair needed.";
    } else {
        const ok = await confirmDialog(`Start maintenance for #${id}?`, `${item.equipment?.name} will be marked as being repaired.`, { confirmText: "Start", variant: "primary", iconName: "play" });
        if (!ok) return;
    }

    await withBusy(btn, async () => {
        const { error } = await supabaseClient
            .from("maintenance_requests")
            .update({ status: newStatus, resolution_notes: notes })
            .eq("id", id);

        if (error) return toast("Status update failed: " + friendlyDbError(error), "error");

        // Return the equipment to service when the ticket is closed
        if (newStatus === "Completed" || newStatus === "Cancelled") {
            const otherOpen = maintenanceRecords.some(m => m.id !== id && m.equipment_id === item.equipment_id && ["Pending", "In Maintenance"].includes(m.status));
            const { data: equip } = await supabaseClient.from("equipment").select("*").eq("id", item.equipment_id).single();
            if (equip && !otherOpen) {
                const condition = item._condition || (equip.condition === "For Repair" || equip.condition === "Damaged" ? "Good" : equip.condition);
                const status = condition === "Damaged" ? "Damaged" : equip.available_quantity > 0 ? "Available" : "Borrowed";
                await supabaseClient.from("equipment").update({ status, condition }).eq("id", item.equipment_id);
            }
        }

        await createAuditLog("MAINTENANCE_UPDATED", "Maintenance", id, `Updated maintenance #${id} (${item.equipment?.name}) to ${newStatus}`);
        toast(`Ticket #${id} is now ${newStatus}.`, "success", "Maintenance updated");
        await refreshAllData();
    });
}

function maintenanceStatusBadge(status) {
    const map = { Pending: "clock", "In Maintenance": "wrench", Completed: "circle-check", Cancelled: "ban" };
    return `<span class="badge ${getMaintenanceStatusBadge(status)}">${icon(map[status] || "circle")}${escapeHTML(status)}</span>`;
}

function getMaintenanceStatusBadge(status) {
    switch (status) {
        case "Pending": return "badge-warning";
        case "In Maintenance": return "badge-info";
        case "Completed": return "badge-success";
        default: return "badge-secondary";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("maintenanceForm")?.addEventListener("submit", submitMaintenanceRequest);
    document.getElementById("maintenanceSearch")?.addEventListener("input", displayMaintenance);
    document.getElementById("maintenanceStatusFilter")?.addEventListener("change", displayMaintenance);
});
