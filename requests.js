// ============================================================================
// BORROWING REQUEST WORKFLOW & BUSINESS RULES (BR-A4-01 to BR-A4-10)
// ============================================================================

let borrowingRequestRecords = [];

/**
 * Load borrowing requests from Supabase
 */
async function loadRequests() {
    if (!isSupabaseReady()) return;

    const { data, error } = await supabaseClient
        .from("borrowing_requests")
        .select(`
            *,
            equipment (
                name,
                equipment_code,
                category,
                status,
                available_quantity
            )
        `)
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading borrowing requests:", error.message);
        return;
    }

    borrowingRequestRecords = data || [];
    updateOverdueStatusInDB();
    displayRequests();
    if (typeof renderDashboard === "function") renderDashboard();
}

/**
 * Automatic Overdue Check
 */
async function updateOverdueStatusInDB() {
    const todayStr = new Date().toISOString().split("T")[0];

    for (const req of borrowingRequestRecords) {
        if (req.status === "Released" && req.expected_return_date < todayStr) {
            const { error } = await supabaseClient
                .from("borrowing_requests")
                .update({ status: "Overdue" })
                .eq("id", req.id);

            if (!error) req.status = "Overdue";
        }
    }
}

/**
 * Load requests specific to current user (Requester view: My Requests & My History)
 */
async function loadMyRequests() {
    if (!currentUser) return;

    const { data, error } = await supabaseClient
        .from("borrowing_requests")
        .select(`*, equipment (name, equipment_code)`)
        .eq("requester_id", currentUser.id)
        .in("status", ["Pending", "Approved", "Released", "Overdue"])
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading my requests:", error.message);
        return;
    }

    renderMyRequestsTable("myRequestsTableBody", data || []);
}

async function loadMyHistory() {
    if (!currentUser) return;

    const { data, error } = await supabaseClient
        .from("borrowing_requests")
        .select(`*, equipment (name, equipment_code)`)
        .eq("requester_id", currentUser.id)
        .in("status", ["Returned", "Closed", "Rejected"])
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading my history:", error.message);
        return;
    }

    renderMyRequestsTable("myHistoryTableBody", data || []);
}

function renderMyRequestsTable(targetId, records) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;

    tbody.innerHTML = "";

    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">No requests found.</td></tr>`;
        return;
    }

    records.forEach(item => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>#${item.id}</td>
            <td><strong>${escapeHTML(item.equipment?.name || "Equipment")}</strong><br><small>${escapeHTML(item.equipment?.equipment_code || "")}</small></td>
            <td>${item.quantity}</td>
            <td>${escapeHTML(item.purpose)}</td>
            <td>${item.request_date}</td>
            <td>${item.expected_return_date}</td>
            <td><span class="badge ${getStatusBadgeClass(item.status)}">${item.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

/**
 * Display All Borrowing Requests (Admin / Staff management view)
 */
function displayRequests() {
    const tableBody = document.getElementById("requestsTableBody");
    if (!tableBody) return;

    const search = document.getElementById("requestSearch")?.value.toLowerCase() || "";
    const statusFilter = document.getElementById("requestStatusFilter")?.value || "All";

    const filtered = borrowingRequestRecords.filter(req => {
        const text = `${req.borrower_name} ${req.borrower_type} ${req.department} ${req.equipment?.name} ${req.equipment?.equipment_code} ${req.purpose}`.toLowerCase();
        const matchesSearch = text.includes(search);
        const matchesStatus = statusFilter === "All" || req.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="10" class="empty-cell">No borrowing requests found.</td></tr>`;
        return;
    }

    const userRole = currentProfile ? currentProfile.role : "requester";

    filtered.forEach(req => {
        const row = document.createElement("tr");

        let actionButtons = "";

        // Admin Approval Buttons (BR-A4-03)
        if (userRole === "admin") {
            if (req.status === "Pending") {
                actionButtons = `
                    <button class="btn-action btn-approve" onclick="approveRequest(${req.id})">Approve</button>
                    <button class="btn-action btn-reject" onclick="rejectRequest(${req.id})">Reject</button>
                `;
            } else if (req.status === "Approved") {
                actionButtons = `
                    <button class="btn-action btn-release" onclick="releaseEquipment(${req.id})">Release</button>
                `;
            } else if (req.status === "Released" || req.status === "Overdue") {
                actionButtons = `
                    <button class="btn-action btn-return" onclick="processReturn(${req.id})">Process Return</button>
                `;
            } else {
                actionButtons = `<span class="text-muted">Completed</span>`;
            }
        } else if (userRole === "staff") {
            // Staff can release approved items or process returns, but CANNOT approve or reject
            if (req.status === "Approved") {
                actionButtons = `
                    <button class="btn-action btn-release" onclick="releaseEquipment(${req.id})">Release</button>
                `;
            } else if (req.status === "Released" || req.status === "Overdue") {
                actionButtons = `
                    <button class="btn-action btn-return" onclick="processReturn(${req.id})">Process Return</button>
                `;
            } else if (req.status === "Pending") {
                actionButtons = `<span class="badge badge-warning">Awaiting Admin Review</span>`;
            } else {
                actionButtons = `<span class="text-muted">Completed</span>`;
            }
        } else {
            actionButtons = `<span class="text-muted">No Actions</span>`;
        }

        row.innerHTML = `
            <td>#${req.id}</td>
            <td><strong>${escapeHTML(req.borrower_name)}</strong><br><small>${escapeHTML(req.borrower_type)} (${escapeHTML(req.department)})</small></td>
            <td><strong>${escapeHTML(req.equipment?.name || "")}</strong><br><small>${escapeHTML(req.equipment?.equipment_code || "")}</small></td>
            <td>${req.quantity}</td>
            <td>${escapeHTML(req.purpose)}</td>
            <td>${req.request_date}</td>
            <td>${req.expected_return_date}</td>
            <td>${req.actual_return_date || "-"}</td>
            <td><span class="badge ${getStatusBadgeClass(req.status)}">${req.status}</span></td>
            <td>${actionButtons}</td>
        `;

        tableBody.appendChild(row);
    });
}

/**
 * SUBMIT BORROWING REQUEST (BR-A4-01, BR-A4-09)
 */
async function submitBorrowingRequest(event) {
    event.preventDefault();

    if (!currentUser) {
        alert("You must be logged in to submit a request.");
        return;
    }

    const equipmentId = document.getElementById("requestEquipmentSelect").value;
    const quantity = parseInt(document.getElementById("requestQuantity").value, 10) || 1;
    const purpose = document.getElementById("requestPurpose").value.trim();
    const expectedReturnDate = document.getElementById("requestExpectedReturnDate").value;
    const borrowerName = document.getElementById("requestBorrowerName")?.value.trim() || currentProfile?.full_name || "Borrower";
    const borrowerType = document.getElementById("requestBorrowerType")?.value || "Student";
    const department = document.getElementById("requestDepartment")?.value || "BSIT";

    if (!equipmentId) {
        alert("Please select equipment.");
        return;
    }

    const today = new Date().toISOString().split("T")[0];
    if (expectedReturnDate < today) {
        alert("Expected return date cannot be in the past.");
        return;
    }

    // Fetch equipment details to check availability & maintenance status
    const { data: equip, error: equipErr } = await supabaseClient
        .from("equipment")
        .select("*")
        .eq("id", equipmentId)
        .single();

    if (equipErr || !equip) {
        alert("Unable to fetch equipment details.");
        return;
    }

    // BR-A4-09: Equipment under maintenance cannot be borrowed
    if (equip.status === "Maintenance") {
        alert("Maintenance: This equipment is under maintenance and cannot be borrowed.");
        return;
    }

    // BR-A4-01: Only available equipment may be requested
    if (equip.status === "Damaged" || equip.available_quantity < quantity) {
        alert("Equipment unavailable: This equipment is currently unavailable or insufficient quantity.");
        return;
    }

    // Insert new pending borrowing request
    const { data: newReq, error: insertErr } = await supabaseClient
        .from("borrowing_requests")
        .insert([{
            requester_id: currentUser.id,
            borrower_name: borrowerName,
            borrower_type: borrowerType,
            department: department,
            equipment_id: equipmentId,
            quantity: quantity,
            purpose: purpose,
            request_date: today,
            expected_return_date: expectedReturnDate,
            status: "Pending"
        }])
        .select()
        .single();

    if (insertErr) {
        alert("Failed to submit borrowing request: " + insertErr.message);
        return;
    }

    // Audit Log (BR-A4-10)
    await createAuditLog("CREATED", "Borrowing", newReq.id, `Submitted borrowing request for ${equip.name} (${equip.equipment_code})`);

    alert("Borrowing request submitted successfully! Status is set to Pending for Administrator review.");

    document.getElementById("borrowingRequestForm")?.reset();
    await loadRequests();
    await loadMyRequests();
}

/**
 * APPROVE BORROWING REQUEST (BR-A4-02, BR-A4-03)
 */
async function approveRequest(requestId) {
    if (!currentProfile || currentProfile.role !== "admin") {
        alert("Unauthorized: Only Administrator may approve or reject requests.");
        return;
    }

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    // BR-A4-02: Staff cannot approve their own request
    if (req.requester_id === currentUser.id) {
        alert("Unauthorized: You cannot approve your own borrowing request.");
        return;
    }

    if (!confirm(`Are you sure you want to APPROVE request #${requestId} for ${req.equipment?.name}?`)) return;

    const { error } = await supabaseClient
        .from("borrowing_requests")
        .update({
            status: "Approved",
            approved_by: currentUser.id,
            approved_at: new Date().toISOString()
        })
        .eq("id", requestId);

    if (error) {
        alert("Failed to approve request: " + error.message);
        return;
    }

    // Audit Log (BR-A4-10)
    await createAuditLog("APPROVED", "Borrowing", requestId, `Approved borrowing request for ${req.equipment?.name}`);

    alert(`Request #${requestId} approved successfully!`);
    await loadRequests();
}

/**
 * REJECT BORROWING REQUEST (BR-A4-03)
 */
async function rejectRequest(requestId) {
    if (!currentProfile || currentProfile.role !== "admin") {
        alert("Unauthorized: Only Administrator may approve or reject requests.");
        return;
    }

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    if (!confirm(`Are you sure you want to REJECT request #${requestId}?`)) return;

    const { error } = await supabaseClient
        .from("borrowing_requests")
        .update({
            status: "Rejected",
            approved_by: currentUser.id,
            approved_at: new Date().toISOString()
        })
        .eq("id", requestId);

    if (error) {
        alert("Failed to reject request: " + error.message);
        return;
    }

    // Audit Log (BR-A4-10)
    await createAuditLog("REJECTED", "Borrowing", requestId, `Rejected borrowing request for ${req.equipment?.name}`);

    alert(`Request #${requestId} has been rejected.`);
    await loadRequests();
}

/**
 * RELEASE EQUIPMENT (BR-A4-04, BR-A4-05, BR-A4-07)
 */
async function releaseEquipment(requestId) {
    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    // BR-A4-07 & BR-A4-04: Rejected or Pending requests cannot be released
    if (req.status === "Rejected") {
        alert("Rejected release: Rejected requests cannot be released.");
        return;
    }

    if (req.status !== "Approved") {
        alert("Invalid release: Only approved requests can be released.");
        return;
    }

    if (!confirm(`Confirm releasing equipment "${req.equipment?.name}" to ${req.borrower_name}?`)) return;

    // 1. Update Request Status to Released
    const { error: reqErr } = await supabaseClient
        .from("borrowing_requests")
        .update({
            status: "Released",
            released_by: currentUser.id,
            released_at: new Date().toISOString()
        })
        .eq("id", requestId);

    if (reqErr) {
        alert("Failed to update request: " + reqErr.message);
        return;
    }

    // 2. BR-A4-05: Update Equipment available quantity & status
    const newAvailQty = Math.max(0, (req.equipment?.available_quantity || 1) - req.quantity);
    const newStatus = newAvailQty === 0 ? "Borrowed" : "Available";

    const { error: equipErr } = await supabaseClient
        .from("equipment")
        .update({
            available_quantity: newAvailQty,
            status: newStatus
        })
        .eq("id", req.equipment_id);

    if (equipErr) {
        console.error("Equipment update warning:", equipErr.message);
    }

    // Audit Log (BR-A4-10)
    await createAuditLog("RELEASED", "Borrowing", requestId, `Released equipment ${req.equipment?.name} to ${req.borrower_name}`);

    alert(`Equipment released successfully!`);
    await loadEquipment();
    await loadRequests();
}

/**
 * PROCESS RETURN (BR-A4-06, BR-A4-08)
 */
async function processReturn(requestId) {
    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    // BR-A4-08: Returned transactions cannot be processed twice
    if (req.status === "Returned" || req.status === "Closed") {
        alert("Duplicate return: This borrowing transaction has already been returned.");
        return;
    }

    const condition = prompt("Enter return condition of equipment (Good / Fair / For Repair / Damaged):", "Good");
    if (!condition) return;

    const todayStr = new Date().toISOString().split("T")[0];

    // 1. Update Borrowing Request
    const { error: reqErr } = await supabaseClient
        .from("borrowing_requests")
        .update({
            status: "Returned",
            actual_return_date: todayStr,
            returned_by: currentUser.id,
            returned_at: new Date().toISOString()
        })
        .eq("id", requestId);

    if (reqErr) {
        alert("Return processing failed: " + reqErr.message);
        return;
    }

    // 2. BR-A4-06: Returned equipment becomes Available unless damaged
    let newEquipmentStatus = "Available";
    let newCondition = condition;

    if (condition.toLowerCase().includes("damaged") || condition.toLowerCase().includes("repair")) {
        newEquipmentStatus = "Maintenance";
        // Create maintenance request automatically if returned damaged
        await supabaseClient.from("maintenance_requests").insert([{
            equipment_id: req.equipment_id,
            requested_by: currentUser.id,
            issue_description: `Returned in ${condition} condition by ${req.borrower_name} (Request #${requestId})`,
            status: "Pending"
        }]);
    }

    // Fetch current equipment to safely update available quantity
    const { data: currentEquip } = await supabaseClient.from("equipment").select("*").eq("id", req.equipment_id).single();
    const updatedAvailQty = (currentEquip ? currentEquip.available_quantity : 0) + req.quantity;

    await supabaseClient.from("equipment").update({
        available_quantity: updatedAvailQty,
        status: newEquipmentStatus,
        condition: newCondition
    }).eq("id", req.equipment_id);

    // Audit Log (BR-A4-10)
    await createAuditLog("RETURNED", "Borrowing", requestId, `Processed return for ${req.equipment?.name}. Condition: ${condition}`);

    alert("Equipment return processed successfully!");
    await loadEquipment();
    await loadRequests();
}

function getStatusBadgeClass(status) {
    switch (status) {
        case "Pending": return "badge-warning";
        case "Approved": return "badge-info";
        case "Rejected": return "badge-danger";
        case "Released": return "badge-primary";
        case "Returned": return "badge-success";
        case "Overdue": return "badge-danger";
        case "Closed": return "badge-secondary";
        default: return "badge-secondary";
    }
}

// Attach DOM Event Listeners
document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("borrowingRequestForm");
    if (form) form.addEventListener("submit", submitBorrowingRequest);

    const search = document.getElementById("requestSearch");
    const filter = document.getElementById("requestStatusFilter");
    if (search) search.addEventListener("input", displayRequests);
    if (filter) filter.addEventListener("change", displayRequests);
});
