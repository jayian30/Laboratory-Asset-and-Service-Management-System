// ============================================================================
// USER MANAGEMENT MODULE (ADMIN ONLY)
// ============================================================================

let userProfileRecords = [];

/**
 * Load user profiles for Admin
 */
async function loadUsers() {
    if (!currentProfile || currentProfile.role !== "admin") {
        console.warn("User management is restricted to Administrators.");
        return;
    }

    const { data, error } = await supabaseClient
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });

    if (error) {
        console.error("Error loading users:", error.message);
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

    const search = document.getElementById("userSearch")?.value.toLowerCase() || "";
    const roleFilter = document.getElementById("userRoleFilter")?.value || "All";

    const filtered = userProfileRecords.filter(u => {
        const text = `${u.full_name} ${u.email} ${u.role}`.toLowerCase();
        const matchesSearch = text.includes(search);
        const matchesRole = roleFilter === "All" || u.role === roleFilter;
        return matchesSearch && matchesRole;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="empty-cell">No users found.</td></tr>`;
        return;
    }

    filtered.forEach(user => {
        const row = document.createElement("tr");

        row.innerHTML = `
            <td>
                <strong>${escapeHTML(user.full_name)}</strong>
                <br><small class="text-muted">${user.id}</small>
            </td>
            <td>${escapeHTML(user.email)}</td>
            <td><span class="badge ${getUserRoleBadge(user.role)}">${user.role.toUpperCase()}</span></td>
            <td>${new Date(user.created_at).toLocaleDateString()}</td>
            <td>
                <select class="form-select-sm" onchange="updateUserRole('${user.id}', this.value)" ${user.id === currentUser?.id ? 'disabled' : ''}>
                    <option value="requester" ${user.role === "requester" ? "selected" : ""}>Requester</option>
                    <option value="staff" ${user.role === "staff" ? "selected" : ""}>Laboratory Staff</option>
                    <option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrator</option>
                </select>
            </td>
        `;

        tableBody.appendChild(row);
    });
}

/**
 * Update User Role
 */
async function updateUserRole(userId, newRole) {
    if (!currentProfile || currentProfile.role !== "admin") {
        alert("Unauthorized action.");
        return;
    }

    if (userId === currentUser?.id) {
        alert("You cannot change your own role.");
        return;
    }

    const user = userProfileRecords.find(u => u.id === userId);
    if (!user) return;

    if (!confirm(`Are you sure you want to change ${user.full_name}'s role to ${newRole.toUpperCase()}?`)) {
        await loadUsers();
        return;
    }

    const { error } = await supabaseClient
        .from("profiles")
        .update({ role: newRole })
        .eq("id", userId);

    if (error) {
        alert("Failed to update user role: " + error.message);
        await loadUsers();
        return;
    }

    await createAuditLog("UPDATED", "Users", userId, `Updated role for ${user.full_name} (${user.email}) to ${newRole}`);

    alert(`Role updated successfully for ${user.full_name}`);
    await loadUsers();
}

function getUserRoleBadge(role) {
    switch (role) {
        case "admin": return "badge-danger";
        case "staff": return "badge-info";
        default: return "badge-secondary";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const search = document.getElementById("userSearch");
    const filter = document.getElementById("userRoleFilter");
    if (search) search.addEventListener("input", displayUsers);
    if (filter) filter.addEventListener("change", displayUsers);
});
