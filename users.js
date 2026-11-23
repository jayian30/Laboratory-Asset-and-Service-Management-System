// ============================================================================
// USER MANAGEMENT MODULE (ADMIN ONLY)
// ============================================================================

let userProfileRecords = [];

/**
 * Load user profiles for Admin
 */
async function loadUsers({ silent = false } = {}) {
    if (!currentProfile || currentProfile.role !== "admin") return;

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error loading users:", error.message);
        if (!silent) toast("Could not load users: " + error.message, "error");
        return;
    }

    userProfileRecords = data || [];
    displayUsers();
}

/**
 * Display User Profiles Table
 */
function displayUsers() {
    const tableBody = document.getElementById("usersTableBody");
    if (!tableBody) return;

    renderUserSummary();

    const search = document.getElementById("userSearch")?.value.toLowerCase().trim() || "";
    const roleFilter = document.getElementById("userRoleFilter")?.value || "All";

    const filtered = userProfileRecords.filter(u => {
        const text = `${u.full_name} ${u.email} ${u.role}`.toLowerCase();
        return text.includes(search) && (roleFilter === "All" || u.role === roleFilter);
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">${icon("user-x")}<p>No users found.</p></td></tr>`;
        refreshIcons();
        return;
    }

    tableBody.innerHTML = filtered.map(user => {
        const reqs = borrowingRequestRecords.filter(r => r.requester_id === user.id);
        const active = reqs.filter(r => ["Pending", "Approved", "Released", "Overdue"].includes(effectiveStatus(r))).length;
        const isSelf = user.id === currentUser?.id;
        return `
            <tr>
                <td>
                    <div class="cell-person">
                        <span class="avatar avatar-sm avatar-${user.role}">${initials(user.full_name)}</span>
                        <div><strong>${escapeHTML(user.full_name)}${isSelf ? ' <span class="badge badge-secondary">You</span>' : ""}</strong><small class="block text-muted">${escapeHTML(user.email)}</small></div>
                    </div>
                </td>
                <td><span class="badge ${getUserRoleBadge(user.role)}">${escapeHTML(roleLabel(user.role))}</span></td>
                <td>${reqs.length} total${active ? `<small class="block text-muted">${active} active</small>` : ""}</td>
                <td>${formatDate(user.created_at)}</td>
                <td class="text-right">
                    <select class="form-select-sm" aria-label="Role for ${escapeHTML(user.full_name)}" onchange="updateUserRole('${user.id}', this.value, this)" ${isSelf ? "disabled title=\"You cannot change your own role\"" : ""}>
                        <option value="requester" ${user.role === "requester" ? "selected" : ""}>Requester</option>
                        <option value="staff" ${user.role === "staff" ? "selected" : ""}>Laboratory Staff</option>
                        <option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrator</option>
                    </select>
                </td>
            </tr>`;
    }).join("");

    refreshIcons();
}

function renderUserSummary() {
    const el = document.getElementById("userSummaryChips");
    if (!el) return;
    const count = r => userProfileRecords.filter(u => u.role === r).length;
    el.innerHTML = `
        <div class="chip-stat"><span>Total users</span><strong>${userProfileRecords.length}</strong></div>
        <div class="chip-stat"><span>Administrators</span><strong>${count("admin")}</strong></div>
        <div class="chip-stat"><span>Laboratory staff</span><strong>${count("staff")}</strong></div>
        <div class="chip-stat"><span>Requesters</span><strong>${count("requester")}</strong></div>
    `;
}

/**
 * Update User Role
 */
async function updateUserRole(userId, newRole, selectEl) {
    if (!currentProfile || currentProfile.role !== "admin") {
        toast("Unauthorized action.", "error");
        return;
    }

    const user = userProfileRecords.find(u => u.id === userId);
    if (!user) return;

    if (userId === currentUser?.id) {
        toast("You cannot change your own role.", "warning");
        if (selectEl) selectEl.value = user.role;
        return;
    }

    const ok = await confirmDialog("Change user role?", `${user.full_name} will change from ${roleLabel(user.role)} to ${roleLabel(newRole)}.`,
        { confirmText: "Change role", variant: "primary", iconName: "user-cog" });
    if (!ok) {
        if (selectEl) selectEl.value = user.role;
        return;
    }

    const { error } = await supabaseClient.from("profiles").update({ role: newRole }).eq("id", userId);

    if (error) {
        toast("Failed to update user role: " + friendlyDbError(error), "error");
        if (selectEl) selectEl.value = user.role;
        return;
    }

    await createAuditLog("UPDATED", "Users", userId, `Changed role of ${user.full_name} (${user.email}) from ${user.role} to ${newRole}`);
    toast(`${user.full_name} is now ${roleLabel(newRole)}.`, "success", "Role updated");
    await refreshAllData();
}

function getUserRoleBadge(role) {
    switch (role) {
        case "admin": return "badge-violet";
        case "staff": return "badge-info";
        default: return "badge-secondary";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("userSearch")?.addEventListener("input", displayUsers);
    document.getElementById("userRoleFilter")?.addEventListener("change", displayUsers);
});
