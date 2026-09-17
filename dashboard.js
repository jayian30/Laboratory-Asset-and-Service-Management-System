// ============================================================================
// DASHBOARD & METRICS RENDERER
// ============================================================================

async function renderDashboard() {
    if (!currentProfile) return;

    const role = currentProfile.role || "requester";

    const adminContainer = document.getElementById("adminDashboardView");
    const staffContainer = document.getElementById("staffDashboardView");
    const requesterContainer = document.getElementById("requesterDashboardView");

    if (adminContainer) adminContainer.style.display = role === "admin" ? "block" : "none";
    if (staffContainer) staffContainer.style.display = role === "staff" ? "block" : "none";
    if (requesterContainer) requesterContainer.style.display = role === "requester" ? "block" : "none";

    if (role === "admin") {
        await renderAdminDashboard();
    } else if (role === "staff") {
        await renderStaffDashboard();
    } else if (role === "requester") {
        await renderRequesterDashboard();
    }
}

async function renderAdminDashboard() {
    // Fetch stats
    const totalEq = equipmentRecords.length;
    const availEq = equipmentRecords.filter(e => e.status === "Available" && e.available_quantity > 0).length;
    const borrowedEq = equipmentRecords.filter(e => e.status === "Borrowed" || e.available_quantity < e.quantity).length;
    const maintEq = equipmentRecords.filter(e => e.status === "Maintenance").length;

    const pendingReq = borrowingRequestRecords.filter(r => r.status === "Pending").length;
    const approvedReq = borrowingRequestRecords.filter(r => r.status === "Approved").length;
    const overdueReq = borrowingRequestRecords.filter(r => r.status === "Overdue").length;

    document.getElementById("adminTotalEquip").textContent = totalEq;
    document.getElementById("adminAvailEquip").textContent = availEq;
    document.getElementById("adminBorrowedEquip").textContent = borrowedEq;
    document.getElementById("adminMaintEquip").textContent = maintEq;
    document.getElementById("adminPendingReq").textContent = pendingReq;
    document.getElementById("adminApprovedReq").textContent = approvedReq;
    document.getElementById("adminOverdueReq").textContent = overdueReq;

    // Render Recent Audit Log feed
    const { data: recentLogs } = await supabaseClient
        .from("audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

    const feedTbody = document.getElementById("recentAuditTableBody");
    if (feedTbody) {
        feedTbody.innerHTML = "";
        if (!recentLogs || recentLogs.length === 0) {
            feedTbody.innerHTML = `<tr><td colspan="5" class="empty-cell">No recent activities.</td></tr>`;
        } else {
            recentLogs.forEach(log => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td><small>${new Date(log.created_at).toLocaleTimeString()}</small></td>
                    <td>${escapeHTML(log.user_name)}</td>
                    <td><span class="badge ${getAuditActionBadgeClass(log.action)}">${log.action}</span></td>
                    <td>${escapeHTML(log.module)}</td>
                    <td>${escapeHTML(log.description)}</td>
                `;
                feedTbody.appendChild(tr);
            });
        }
    }
}

async function renderStaffDashboard() {
    const availEq = equipmentRecords.filter(e => e.status === "Available" && e.available_quantity > 0).length;
    const activeBorrowing = borrowingRequestRecords.filter(r => r.status === "Released").length;
    const pendingReq = borrowingRequestRecords.filter(r => r.status === "Pending").length;
    const returnsDue = borrowingRequestRecords.filter(r => r.status === "Overdue" || r.status === "Released").length;
    const maintReq = maintenanceRecords.filter(m => m.status === "Pending" || m.status === "In Maintenance").length;

    document.getElementById("staffAvailEquip").textContent = availEq;
    document.getElementById("staffActiveBorrowing").textContent = activeBorrowing;
    document.getElementById("staffPendingReq").textContent = pendingReq;
    document.getElementById("staffReturnsDue").textContent = returnsDue;
    document.getElementById("staffMaintReq").textContent = maintReq;
}

async function renderRequesterDashboard() {
    if (!currentUser) return;

    const availEq = equipmentRecords.filter(e => e.status === "Available" && e.available_quantity > 0).length;

    const myRequests = borrowingRequestRecords.filter(r => r.requester_id === currentUser.id);
    const myPending = myRequests.filter(r => r.status === "Pending").length;
    const myApproved = myRequests.filter(r => r.status === "Approved").length;
    const myActive = myRequests.filter(r => r.status === "Released" || r.status === "Overdue").length;
    const myCompleted = myRequests.filter(r => r.status === "Returned" || r.status === "Closed").length;

    document.getElementById("reqAvailEquip").textContent = availEq;
    document.getElementById("reqPending").textContent = myPending;
    document.getElementById("reqApproved").textContent = myApproved;
    document.getElementById("reqActive").textContent = myActive;
    document.getElementById("reqCompleted").textContent = myCompleted;
}
