// ============================================================================
// MAINTENANCE REQUESTS MANAGEMENT
// ============================================================================

let maintenanceRecords = [];

/**
 * Load maintenance requests
 */
async function loadMaintenance() {
    if (!isSupabaseReady()) return;

    const { data, error } = await supabaseClient
        .from("maintenance_requests")
        .select(`
            *,
            equipment (
                name,
                equipment_code,
                category,
                location
            ),
            profiles:requested_by (
                full_name
            )
        `)
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading maintenance requests:", error.message);
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

    const search = document.getElementById("maintenanceSearch")?.value.toLowerCase() || "";
    const filter = document.getElementById("maintenanceStatusFilter")?.value || "All";

    const filtered = maintenanceRecords.filter(item => {
        const text = `${item.equipment?.name} ${item.equipment?.equipment_code} ${item.issue_description} ${item.profiles?.full_name}`.toLowerCase();
        const matchesSearch = text.includes(search);
        const matchesStatus = filter === "All" || item.status === filter;
        return matchesSearch && matchesStatus;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-cell">No maintenance requests found.</td></tr>`;
        return;
    }

    const role = currentProfile ? currentProfile.role : "requester";

    filtered.forEach(item => {
        const row = document.createElement("tr");

        let actionHtml = "";
        if (role === "admin" || role === "staff") {
            if (item.status === "Pending") {
                actionHtml = `<button class="btn-action btn-info" onclick="updateMaintenanceStatus(${item.id}, 'In Maintenance')">Start Maintenance</button>`;
            } else if (item.status === "In Maintenance") {
                actionHtml = `<button class="btn-action btn-success" onclick="updateMaintenanceStatus(${item.id}, 'Completed')">Complete Repair</button>`;
            } else {
                actionHtml = `<span class="text-muted">Closed</span>`;
            }
        }

        row.innerHTML = `
            <td>#${item.id}</td>
            <td><strong>${escapeHTML(item.equipment?.name)}</strong><br><small>${escapeHTML(item.equipment?.equipment_code)}</small></td>
            <td>${escapeHTML(item.profiles?.full_name || "Staff")}</td>
            <td>${escapeHTML(item.issue_description)}</td>
            <td>${escapeHTML(item.resolution_notes || "-")}</td>
            <td><span class="badge ${getMaintenanceStatusBadge(item.status)}">${item.status}</span></td>
            <td>${actionHtml}</td>
        `;

        tableBody.appendChild(row);
    });
}

/**
 * Submit Maintenance Request
 */
async function submitMaintenanceRequest(event) {
    event.preventDefault();

    if (!currentUser || (currentProfile?.role !== "admin" && currentProfile?.role !== "staff")) {
        alert("Unauthorized: Only Admin and Staff can submit maintenance requests.");
        return;
    }

    const equipmentId = document.getElementById("maintEquipmentSelect").value;
    const issueDescription = document.getElementById("maintIssueDescription").value.trim();

    if (!equipmentId || !issueDescription) {
        alert("Please fill out all required fields.");
        return;
    }

    const { data: req, error } = await supabaseClient
        .from("maintenance_requests")
        .insert([{
            equipment_id: equipmentId,
            requested_by: currentUser.id,
            issue_description: issueDescription,
            status: "Pending"
        }])
        .select()
        .single();

    if (error) {
        alert("Failed to create maintenance request: " + error.message);
        return;
    }

    // Update equipment status to Maintenance
    await supabaseClient.from("equipment").update({ status: "Maintenance" }).eq("id", equipmentId);

    // Audit log
    await createAuditLog("MAINTENANCE_REQUESTED", "Maintenance", req.id, `Submitted maintenance request for equipment ID ${equipmentId}: ${issueDescription}`);

    alert("Maintenance request submitted successfully!");
    document.getElementById("maintenanceForm")?.reset();
    await loadEquipment();
    await loadMaintenance();
}

/**
 * Update Maintenance Status (In Maintenance / Completed)
 */
async function updateMaintenanceStatus(id, newStatus) {
    const item = maintenanceRecords.find(m => m.id === id);
    if (!item) return;

    let notes = item.resolution_notes;
    if (newStatus === "Completed") {
        notes = prompt("Enter repair resolution notes:", "Equipment repaired and tested. Ready for use.") || "Repaired";
    }

    const { error } = await supabaseClient
        .from("maintenance_requests")
        .update({
            status: newStatus,
            resolution_notes: notes
        })
        .eq("id", id);

    if (error) {
        alert("Status update failed: " + error.message);
        return;
    }

    // If repair completed, set equipment back to Available
    if (newStatus === "Completed") {
        await supabaseClient.from("equipment").update({
            status: "Available",
            condition: "Good"
        }).eq("id", item.equipment_id);
    }

    await createAuditLog("MAINTENANCE_UPDATED", "Maintenance", id, `Updated maintenance #${id} status to ${newStatus}`);

    alert(`Maintenance #${id} updated to ${newStatus}`);
    await loadEquipment();
    await loadMaintenance();
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
    const form = document.getElementById("maintenanceForm");
    if (form) form.addEventListener("submit", submitMaintenanceRequest);

    const search = document.getElementById("maintenanceSearch");
    const filter = document.getElementById("maintenanceStatusFilter");
    if (search) search.addEventListener("input", displayMaintenance);
    if (filter) filter.addEventListener("change", displayMaintenance);
});
