// ============================================================================
// BORROWING REQUEST WORKFLOW & BUSINESS RULES (BR-A4-01 to BR-A4-10)
// ============================================================================

let borrowingRequestRecords = [];

const ACTIVE_STATUSES = ["Pending", "Approved", "Released", "Overdue"];
const HISTORY_STATUSES = ["Returned", "Closed", "Rejected", "Cancelled"];

const REQUEST_SELECT_FULL = `
    *,
    equipment ( name, equipment_code, category, status, quantity, available_quantity, location ),
    approver:profiles!borrowing_requests_approved_by_fkey ( full_name ),
    releaser:profiles!borrowing_requests_released_by_fkey ( full_name ),
    receiver:profiles!borrowing_requests_returned_by_fkey ( full_name )
`;
const REQUEST_SELECT_BASIC = `*, equipment ( name, equipment_code, category, status, quantity, available_quantity, location )`;

/**
 * Load borrowing requests (RLS limits Requesters to their own rows)
 */
async function loadRequests({ silent = false } = {}) {
    if (!isSupabaseReady()) return;

    let { data, error } = await supabaseClient
        .from("borrowing_requests")
        .select(REQUEST_SELECT_FULL)
        .order("id", { ascending: false });

    if (error) {
        // Fallback in case foreign key names differ in this database
        ({ data, error } = await supabaseClient
            .from("borrowing_requests")
            .select(REQUEST_SELECT_BASIC)
            .order("id", { ascending: false }));
    }

    if (error) {
        console.error("Error loading borrowing requests:", error.message);
        if (!silent) toast("Could not load borrowing requests: " + error.message, "error");
        return;
    }

    borrowingRequestRecords = data || [];
    await markOverdueInDB();

    displayRequests();
    renderMyRequests();
    renderMyHistory();
}

/** A Released request past its due date is Overdue, even before the DB is updated */
function effectiveStatus(req) {
    if (req.status === "Released" && req.expected_return_date && daysUntil(req.expected_return_date) < 0) return "Overdue";
    return req.status;
}

/**
 * Automatic overdue update (Admin & Staff only; Requesters cannot update rows)
 */
async function markOverdueInDB() {
    const role = currentProfile?.role;
    if (role !== "admin" && role !== "staff") return;

    const ids = borrowingRequestRecords.filter(r => r.status === "Released" && effectiveStatus(r) === "Overdue").map(r => r.id);
    if (ids.length === 0) return;

    const { error } = await supabaseClient
        .from("borrowing_requests")
        .update({ status: "Overdue" })
        .in("id", ids)
        .eq("status", "Released");

    if (!error) {
        borrowingRequestRecords.forEach(r => { if (ids.includes(r.id)) r.status = "Overdue"; });
    } else {
        console.warn("Overdue update skipped:", error.message);
    }
}

// Kept for compatibility with older calls
async function loadMyRequests() { await loadRequests({ silent: true }); }
async function loadMyHistory() { await loadRequests({ silent: true }); }

function myRequests() {
    return borrowingRequestRecords.filter(r => r.requester_id === currentUser?.id);
}

function renderMyRequests() {
    const rows = myRequests().filter(r => ACTIVE_STATUSES.includes(effectiveStatus(r)));
    renderMyRequestsTable("myRequestsTableBody", rows, true);
}

function renderMyHistory() {
    const rows = myRequests().filter(r => HISTORY_STATUSES.includes(r.status));
    renderMyRequestsTable("myHistoryTableBody", rows, false);
}

function renderMyRequestsTable(targetId, records, isActive) {
    const tbody = document.getElementById(targetId);
    if (!tbody) return;

    if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">${icon(isActive ? "inbox" : "history")}<p>${isActive ? "You have no active requests. Browse equipment to submit one." : "No completed transactions yet."}</p></td></tr>`;
        refreshIcons();
        return;
    }

    tbody.innerHTML = records.map(item => {
        const status = effectiveStatus(item);
        let action = `<button class="btn-icon" title="View details" onclick="showRequestDetails(${item.id})">${icon("eye")}</button>`;
        if (isActive && status === "Pending") {
            action = `<button class="btn-action btn-outline-danger" onclick="cancelRequest(${item.id}, this)">${icon("x")}Cancel</button>` + action;
        }
        return `
            <tr>
                <td><strong>#${item.id}</strong><small class="block text-muted">${formatDate(item.request_date)}</small></td>
                <td><strong>${escapeHTML(item.equipment?.name || "Equipment")}</strong><small class="block"><code>${escapeHTML(item.equipment?.equipment_code || "")}</code></small></td>
                <td>${item.quantity}</td>
                <td class="cell-wrap">${escapeHTML(item.purpose)}</td>
                <td>${periodCell(item, status)}</td>
                <td>${requestStatusBadge(status)}</td>
                <td class="text-right nowrap">${action}</td>
            </tr>`;
    }).join("");
    refreshIcons();
}

function periodCell(req, status) {
    let due = "";
    if (status === "Released" || status === "Overdue") {
        const cls = status === "Overdue" ? "text-danger" : daysUntil(req.expected_return_date) <= 1 ? "text-warning" : "text-muted";
        due = `<small class="block ${cls}">${dueLabel(req.expected_return_date)}</small>`;
    } else if (status === "Approved" && daysUntil(req.expected_return_date) < 0) {
        due = `<small class="block text-warning">Return date has passed - not yet released</small>`;
    }
    const returned = req.actual_return_date ? `<small class="block text-muted">Returned ${formatDate(req.actual_return_date)}</small>` : "";
    return `${formatDate(req.request_date)} → ${formatDate(req.expected_return_date)}${due}${returned}`;
}

/**
 * Display All Borrowing Requests (Admin / Staff management view)
 */
function displayRequests() {
    const tableBody = document.getElementById("requestsTableBody");
    if (!tableBody) return;

    renderRequestStatusTabs();

    const search = document.getElementById("requestSearch")?.value.toLowerCase().trim() || "";
    const statusFilter = document.getElementById("requestStatusFilter")?.value || "All";

    const filtered = borrowingRequestRecords.filter(req => {
        const text = `#${req.id} ${req.borrower_name} ${req.borrower_type} ${req.department} ${req.equipment?.name} ${req.equipment?.equipment_code} ${req.purpose}`.toLowerCase();
        return text.includes(search) && (statusFilter === "All" || effectiveStatus(req) === statusFilter);
    });

    const footer = document.getElementById("requestsTableFooter");
    if (footer) footer.textContent = `Showing ${filtered.length} of ${borrowingRequestRecords.length} requests`;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-cell">${icon("inbox")}<p>No borrowing requests match your filters.</p></td></tr>`;
        refreshIcons();
        return;
    }

    tableBody.innerHTML = filtered.map(req => {
        const status = effectiveStatus(req);
        return `
            <tr>
                <td class="nowrap"><strong>#${req.id}</strong><small class="block text-muted">${timeAgo(req.created_at)}</small></td>
                <td>
                    <div class="cell-person">
                        <span class="avatar avatar-xs">${initials(req.borrower_name)}</span>
                        <div><strong>${escapeHTML(req.borrower_name)}</strong><small class="block text-muted">${escapeHTML(req.borrower_type)} · ${escapeHTML(req.department)}</small></div>
                    </div>
                </td>
                <td><strong>${escapeHTML(req.equipment?.name || "")}</strong><small class="block"><code>${escapeHTML(req.equipment?.equipment_code || "")}</code></small></td>
                <td>${req.quantity}</td>
                <td>${periodCell(req, status)}</td>
                <td>${requestStatusBadge(status)}</td>
                <td class="text-right nowrap">${requestActionButtons(req)}<button class="btn-icon" title="View details" onclick="showRequestDetails(${req.id})">${icon("eye")}</button></td>
            </tr>`;
    }).join("");

    refreshIcons();
}

/** Role-aware action buttons for a request row (also used by dashboards) */
function requestActionButtons(req) {
    const role = currentProfile?.role;
    const status = effectiveStatus(req);

    if (role === "admin") {
        if (status === "Pending") {
            return `<button class="btn-action btn-approve" onclick="approveRequest(${req.id}, this)">${icon("check")}Approve</button>
                    <button class="btn-action btn-reject" onclick="rejectRequest(${req.id}, this)">${icon("x")}Reject</button>`;
        }
    }
    if (role === "admin" || role === "staff") {
        if (status === "Approved") return `<button class="btn-action btn-release" onclick="releaseEquipment(${req.id}, this)">${icon("package-check")}Release</button>`;
        if (status === "Released" || status === "Overdue") return `<button class="btn-action btn-return" onclick="processReturn(${req.id}, this)">${icon("undo-2")}Return</button>`;
        if (status === "Pending" && role === "staff") return `<span class="text-muted small">Awaiting admin</span>`;
    }
    return "";
}

function renderRequestStatusTabs() {
    const el = document.getElementById("requestStatusTabs");
    if (!el) return;
    const current = document.getElementById("requestStatusFilter")?.value || "All";
    const tabs = ["All", "Pending", "Approved", "Released", "Overdue", "Returned", "Rejected", "Cancelled"];
    el.innerHTML = tabs.map(t => {
        const n = t === "All" ? borrowingRequestRecords.length : borrowingRequestRecords.filter(r => effectiveStatus(r) === t).length;
        return `<button class="status-tab ${t === current ? "active" : ""} ${t === "Overdue" && n ? "has-alert" : ""}" onclick="setRequestFilter('${t}')">${t}<span>${n}</span></button>`;
    }).join("");
}

function setRequestFilter(status) {
    const sel = document.getElementById("requestStatusFilter");
    if (sel) sel.value = status;
    displayRequests();
}

/** Open the requests page pre-filtered (used by dashboard links) */
function openRequestsFiltered(status) {
    const sel = document.getElementById("requestStatusFilter");
    if (sel) sel.value = status;
    showSection("requestsSection");
}

/**
 * SUBMIT BORROWING REQUEST (BR-A4-01, BR-A4-09)
 */
async function submitBorrowingRequest(event) {
    event.preventDefault();

    if (!currentUser) {
        toast("You must be logged in to submit a request.", "error");
        return;
    }

    const equipmentId = document.getElementById("requestEquipmentSelect").value;
    const quantity = parseInt(document.getElementById("requestQuantity").value, 10);
    const purpose = document.getElementById("requestPurpose").value.trim();
    const expectedReturnDate = document.getElementById("requestExpectedReturnDate").value;
    const borrowerName = document.getElementById("requestBorrowerName")?.value.trim() || currentProfile?.full_name || "Borrower";
    const borrowerType = document.getElementById("requestBorrowerType")?.value || "Student";
    const department = document.getElementById("requestDepartment")?.value.trim() || "BSIT";

    if (!equipmentId) return toast("Please select the equipment you want to borrow.", "warning");
    if (!Number.isInteger(quantity) || quantity < 1) return toast("Quantity must be at least 1.", "warning");
    if (!purpose) return toast("Please describe the purpose of borrowing.", "warning");
    if (!expectedReturnDate) return toast("Please choose an expected return date.", "warning");

    const today = todayStr();
    if (expectedReturnDate < today) return toast("Expected return date cannot be in the past.", "warning");
    if (daysUntil(expectedReturnDate) > 30) return toast("Borrowing period cannot exceed 30 days.", "warning");

    const alreadyPending = myRequests().find(r => String(r.equipment_id) === String(equipmentId) && ["Pending", "Approved"].includes(r.status));
    if (alreadyPending) {
        return toast(`You already have request #${alreadyPending.id} (${alreadyPending.status}) for this equipment.`, "warning", "Duplicate request");
    }

    const btn = document.getElementById("requestSubmitBtn");
    await withBusy(btn, async () => {
        const { data: equip, error: equipErr } = await supabaseClient.from("equipment").select("*").eq("id", equipmentId).single();
        if (equipErr || !equip) return toast("Unable to fetch equipment details.", "error");

        // BR-A4-09: Equipment under maintenance cannot be borrowed
        if (equip.status === "Maintenance") return toast("This equipment is under maintenance and cannot be borrowed.", "warning", "Unavailable");
        // BR-A4-01: Only available equipment may be requested
        if (equip.status === "Damaged" || equip.available_quantity < quantity) {
            return toast(`Only ${equip.available_quantity} unit(s) of ${equip.name} are available right now.`, "warning", "Insufficient stock");
        }

        const { data: newReq, error: insertErr } = await supabaseClient
            .from("borrowing_requests")
            .insert([{
                requester_id: currentUser.id,
                borrower_name: borrowerName,
                borrower_type: borrowerType,
                department,
                equipment_id: Number(equipmentId),
                quantity,
                purpose,
                request_date: today,
                expected_return_date: expectedReturnDate,
                status: "Pending"
            }])
            .select()
            .single();

        if (insertErr) return toast("Failed to submit request: " + friendlyDbError(insertErr), "error");

        await createAuditLog("CREATED", "Borrowing", newReq.id, `Submitted borrowing request for ${quantity} x ${equip.name} (${equip.equipment_code})`);
        toast(`Request #${newReq.id} was submitted and is waiting for administrator approval.`, "success", "Request submitted");

        const form = document.getElementById("borrowingRequestForm");
        form?.reset();
        document.getElementById("requestBorrowerName").value = currentProfile?.full_name || "";
        setDefaultReturnDate();
        await refreshAllData();
    });
}

/**
 * Update a request, dropping the optional `remarks` column if this database doesn't have it yet.
 * Returns { data, error } where data is the updated rows.
 */
async function updateRequestRow(id, payload, extraFilter) {
    const run = async (p) => {
        let q = supabaseClient.from("borrowing_requests").update(p).eq("id", id);
        if (extraFilter) q = q.eq(extraFilter[0], extraFilter[1]);
        return await q.select("id");
    };
    let res = await run(payload);
    if (res.error && "remarks" in payload && /remarks/i.test(res.error.message)) {
        const { remarks, ...rest } = payload;
        res = await run(rest);
    }
    return res;
}

/**
 * APPROVE BORROWING REQUEST (BR-A4-02, BR-A4-03)
 */
async function approveRequest(requestId, btn) {
    if (!currentProfile || currentProfile.role !== "admin") {
        return toast("Only an Administrator may approve or reject requests.", "error", "Unauthorized");
    }

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    // BR-A4-02: Approver cannot approve their own request
    if (req.requester_id === currentUser.id) {
        return toast("You cannot approve your own borrowing request.", "error", "Not allowed");
    }

    const equip = equipmentRecords.find(e => e.id === req.equipment_id);
    const stockNote = equip && (equip.available_quantity < req.quantity || equip.status !== "Available")
        ? ` Note: only ${equip.available_quantity} unit(s) are available now (status: ${equip.status}). It can be released once stock is available.`
        : "";

    const ok = await confirmDialog(`Approve request #${requestId}?`,
        `${req.borrower_name} will be allowed to borrow ${req.quantity} x ${req.equipment?.name} until ${formatDate(req.expected_return_date)}.${stockNote}`,
        { confirmText: "Approve", variant: "success", iconName: "check" });
    if (!ok) return;

    await withBusy(btn, async () => {
        const { data, error } = await updateRequestRow(requestId, {
            status: "Approved",
            approved_by: currentUser.id,
            approved_at: new Date().toISOString()
        }, ["status", "Pending"]);

        if (error) return toast("Failed to approve request: " + friendlyDbError(error), "error");
        if (!data?.length) return toast("This request is no longer pending. The list has been refreshed.", "warning");

        await createAuditLog("APPROVED", "Borrowing", requestId, `Approved borrowing request of ${req.borrower_name} for ${req.equipment?.name}`);
        toast(`Request #${requestId} approved. Staff can now release the equipment.`, "success", "Approved");
        await refreshAllData();
    });
}

/**
 * REJECT BORROWING REQUEST (BR-A4-03)
 */
async function rejectRequest(requestId, btn) {
    if (!currentProfile || currentProfile.role !== "admin") {
        return toast("Only an Administrator may approve or reject requests.", "error", "Unauthorized");
    }

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    const result = await openModal({
        title: `Reject request #${requestId}?`,
        message: `${req.borrower_name} · ${req.quantity} x ${req.equipment?.name}`,
        fields: [{ name: "reason", label: "Reason for rejection", type: "textarea", required: true, placeholder: "e.g. Equipment reserved for a scheduled laboratory class" }],
        confirmText: "Reject request",
        variant: "danger",
        iconName: "x"
    });
    if (!result) return;

    await withBusy(btn, async () => {
        const { data, error } = await updateRequestRow(requestId, {
            status: "Rejected",
            approved_by: currentUser.id,
            approved_at: new Date().toISOString(),
            remarks: result.reason
        }, ["status", "Pending"]);

        if (error) return toast("Failed to reject request: " + friendlyDbError(error), "error");
        if (!data?.length) return toast("This request is no longer pending. The list has been refreshed.", "warning");

        await createAuditLog("REJECTED", "Borrowing", requestId, `Rejected borrowing request of ${req.borrower_name} for ${req.equipment?.name}. Reason: ${result.reason}`);
        toast(`Request #${requestId} has been rejected.`, "info", "Rejected");
        await refreshAllData();
    });
}

/**
 * RELEASE EQUIPMENT (BR-A4-04, BR-A4-05, BR-A4-07)
 */
async function releaseEquipment(requestId, btn) {
    const role = currentProfile?.role;
    if (role !== "admin" && role !== "staff") return toast("Only Admin or Staff can release equipment.", "error", "Unauthorized");

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    if (req.status === "Rejected") return toast("Rejected requests cannot be released.", "warning");
    if (req.status !== "Approved") return toast("Only approved requests can be released.", "warning");

    const ok = await confirmDialog(`Release equipment for #${requestId}?`,
        `Hand over ${req.quantity} x ${req.equipment?.name} to ${req.borrower_name}. Due back ${formatDate(req.expected_return_date)}.`,
        { confirmText: "Release", variant: "primary", iconName: "package-check" });
    if (!ok) return;

    await withBusy(btn, async () => {
        // Always check live stock before releasing
        const { data: equip, error: eqErr } = await supabaseClient.from("equipment").select("*").eq("id", req.equipment_id).single();
        if (eqErr || !equip) return toast("Unable to read current equipment stock.", "error");
        if (equip.status === "Maintenance" || equip.status === "Damaged") {
            return toast(`${equip.name} is currently ${equip.status.toLowerCase()} and cannot be released.`, "warning", "Unavailable");
        }
        if (equip.available_quantity < req.quantity) {
            return toast(`Only ${equip.available_quantity} unit(s) are in stock; ${req.quantity} requested.`, "warning", "Insufficient stock");
        }

        const { data, error: reqErr } = await updateRequestRow(requestId, {
            status: "Released",
            released_by: currentUser.id,
            released_at: new Date().toISOString()
        }, ["status", "Approved"]);

        if (reqErr) return toast("Failed to update request: " + friendlyDbError(reqErr), "error");
        if (!data?.length) return toast("This request is no longer approved. The list has been refreshed.", "warning");

        // BR-A4-05: Deduct stock
        const newAvailQty = equip.available_quantity - req.quantity;
        const { error: equipErr } = await supabaseClient
            .from("equipment")
            .update({ available_quantity: newAvailQty, status: newAvailQty === 0 ? "Borrowed" : "Available" })
            .eq("id", req.equipment_id);

        if (equipErr) console.error("Equipment update warning:", equipErr.message);

        await createAuditLog("RELEASED", "Borrowing", requestId, `Released ${req.quantity} x ${req.equipment?.name} to ${req.borrower_name}`);
        toast(`Equipment released to ${req.borrower_name}.`, "success", "Released");
        await refreshAllData();
    });
}

/**
 * PROCESS RETURN (BR-A4-06, BR-A4-08)
 */
async function processReturn(requestId, btn) {
    const role = currentProfile?.role;
    if (role !== "admin" && role !== "staff") return toast("Only Admin or Staff can process returns.", "error", "Unauthorized");

    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;

    // BR-A4-08: Returned transactions cannot be processed twice
    if (req.status === "Returned" || req.status === "Closed") {
        return toast("This borrowing transaction has already been returned.", "warning", "Duplicate return");
    }

    const lateDays = Math.max(0, -daysUntil(req.expected_return_date));
    const result = await openModal({
        title: `Process return for #${requestId}`,
        message: `${req.quantity} x ${req.equipment?.name} from ${req.borrower_name}${lateDays ? ` · ${lateDays} day(s) late` : ""}`,
        fields: [
            {
                name: "condition", label: "Condition on return", type: "select", value: "Good", required: true,
                options: [
                    { value: "Good", label: "Good - ready for use" },
                    { value: "Fair", label: "Fair - minor wear" },
                    { value: "For Repair", label: "For Repair - send to maintenance" },
                    { value: "Damaged", label: "Damaged - send to maintenance" }
                ]
            },
            { name: "remarks", label: "Remarks", type: "textarea", placeholder: "Optional notes (missing accessories, issues found...)" }
        ],
        confirmText: "Confirm return",
        variant: "primary",
        iconName: "undo-2"
    });
    if (!result) return;

    const condition = result.condition;
    const needsRepair = condition === "For Repair" || condition === "Damaged";

    await withBusy(btn, async () => {
        const { data, error: reqErr } = await updateRequestRow(requestId, {
            status: "Returned",
            actual_return_date: todayStr(),
            returned_by: currentUser.id,
            returned_at: new Date().toISOString(),
            remarks: result.remarks || (lateDays ? `Returned ${lateDays} day(s) late` : null)
        });

        if (reqErr) return toast("Return processing failed: " + friendlyDbError(reqErr), "error");
        if (!data?.length) return toast("Unable to update this request.", "error");

        // BR-A4-06: Returned equipment becomes available unless damaged
        const { data: currentEquip } = await supabaseClient.from("equipment").select("*").eq("id", req.equipment_id).single();
        if (currentEquip) {
            const updatedAvailQty = Math.min(currentEquip.quantity, currentEquip.available_quantity + req.quantity);
            let newStatus = currentEquip.status;
            let newCondition = currentEquip.condition;

            if (needsRepair) {
                newStatus = "Maintenance";
                newCondition = condition;
            } else if (currentEquip.status === "Borrowed" || currentEquip.status === "Available") {
                newStatus = updatedAvailQty > 0 ? "Available" : "Borrowed";
                if (currentEquip.quantity === 1) newCondition = condition;
            }

            await supabaseClient.from("equipment").update({
                available_quantity: updatedAvailQty,
                status: newStatus,
                condition: newCondition
            }).eq("id", req.equipment_id);
        }

        if (needsRepair) {
            const { data: ticket } = await supabaseClient.from("maintenance_requests").insert([{
                equipment_id: req.equipment_id,
                requested_by: currentUser.id,
                issue_description: `Returned in ${condition} condition by ${req.borrower_name} (Request #${requestId})${result.remarks ? ": " + result.remarks : ""}`,
                status: "Pending"
            }]).select().single();
            if (ticket) await createAuditLog("MAINTENANCE_REQUESTED", "Maintenance", ticket.id, `Auto-created maintenance ticket for ${req.equipment?.name} after damaged return`);
        }

        await createAuditLog("RETURNED", "Borrowing", requestId,
            `Processed return of ${req.equipment?.name} from ${req.borrower_name}. Condition: ${condition}${lateDays ? `. ${lateDays} day(s) late` : ""}`);

        toast(needsRepair ? "Return recorded and a maintenance ticket was created." : "Return recorded. Stock has been restored.", "success", "Returned");
        await refreshAllData();
    });
}

/**
 * CANCEL (Requester, only while Pending)
 */
async function cancelRequest(requestId, btn) {
    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req || req.requester_id !== currentUser?.id) return;
    if (req.status !== "Pending") return toast("Only pending requests can be cancelled.", "warning");

    const ok = await confirmDialog(`Cancel request #${requestId}?`, `Your request for ${req.equipment?.name} will be withdrawn.`,
        { confirmText: "Cancel request", variant: "danger", iconName: "x" });
    if (!ok) return;

    await withBusy(btn, async () => {
        const { data, error } = await updateRequestRow(requestId, { status: "Cancelled" }, ["status", "Pending"]);

        if (error || !data?.length) {
            console.error("Cancel failed:", error?.message);
            return toast("The database does not allow cancellation yet. Ask the administrator to run the upgrade script in seed_data.sql.", "error", "Cannot cancel");
        }

        await createAuditLog("CANCELLED", "Borrowing", requestId, `Requester cancelled borrowing request for ${req.equipment?.name}`);
        toast(`Request #${requestId} was cancelled.`, "info", "Cancelled");
        await refreshAllData();
    });
}

/**
 * Request details with a status timeline
 */
function showRequestDetails(requestId) {
    const req = borrowingRequestRecords.find(r => r.id === requestId);
    if (!req) return;
    const status = effectiveStatus(req);

    const step = (done, label, when, who, variant = "") => `
        <li class="tl-item ${done ? "done" : ""} ${variant}">
            <span class="tl-dot"></span>
            <div><strong>${label}</strong><small>${done ? `${when ? formatDateTime(when) : ""}${who ? " · " + escapeHTML(who) : ""}` : "Not yet"}</small></div>
        </li>`;

    const decided = req.approved_at && ["Rejected"].includes(req.status);
    const timeline = `
        <ul class="timeline">
            ${step(true, "Request submitted", req.created_at, req.borrower_name)}
            ${decided
                ? step(true, "Rejected", req.approved_at, req.approver?.full_name, "tl-danger")
                : req.status === "Cancelled"
                    ? step(true, "Cancelled by requester", req.updated_at, req.borrower_name, "tl-muted")
                    : step(!!req.approved_at, "Approved", req.approved_at, req.approver?.full_name)}
            ${["Rejected", "Cancelled"].includes(req.status) ? "" : step(!!req.released_at, "Released to borrower", req.released_at, req.releaser?.full_name)}
            ${["Rejected", "Cancelled"].includes(req.status) ? "" : step(!!req.returned_at, "Returned", req.returned_at, req.receiver?.full_name, status === "Overdue" ? "tl-danger" : "")}
        </ul>`;

    const body = `
        <div class="detail-grid">
            <div><span>Status</span>${requestStatusBadge(status)}</div>
            <div><span>Equipment</span><strong>${escapeHTML(req.equipment?.name || "")}</strong><small><code>${escapeHTML(req.equipment?.equipment_code || "")}</code></small></div>
            <div><span>Borrower</span><strong>${escapeHTML(req.borrower_name)}</strong><small>${escapeHTML(req.borrower_type)} · ${escapeHTML(req.department)}</small></div>
            <div><span>Quantity</span><strong>${req.quantity}</strong></div>
            <div><span>Borrow period</span><strong>${formatDate(req.request_date)} → ${formatDate(req.expected_return_date)}</strong>${["Released", "Overdue"].includes(status) ? `<small class="${status === "Overdue" ? "text-danger" : ""}">${dueLabel(req.expected_return_date)}</small>` : ""}</div>
            <div><span>Actual return</span><strong>${formatDate(req.actual_return_date)}</strong></div>
            <div class="span-2"><span>Purpose</span><p>${escapeHTML(req.purpose)}</p></div>
            ${req.remarks ? `<div class="span-2"><span>Remarks</span><p>${escapeHTML(req.remarks)}</p></div>` : ""}
        </div>
        <h4 class="detail-subhead">Timeline</h4>
        ${timeline}`;

    openModal({ title: `Request #${req.id}`, bodyHtml: body, cancelText: "Close", hideConfirm: true, iconName: "file-text", wide: true });
}

function requestStatusBadge(status) {
    const map = {
        Pending: "hourglass", Approved: "thumbs-up", Rejected: "circle-x", Released: "package-open",
        Returned: "circle-check", Overdue: "alarm-clock", Closed: "archive", Cancelled: "ban"
    };
    return `<span class="badge ${getStatusBadgeClass(status)}">${icon(map[status] || "circle")}${escapeHTML(status)}</span>`;
}

function getStatusBadgeClass(status) {
    switch (status) {
        case "Pending": return "badge-warning";
        case "Approved": return "badge-info";
        case "Rejected": return "badge-danger";
        case "Released": return "badge-primary";
        case "Returned": return "badge-success";
        case "Overdue": return "badge-danger";
        default: return "badge-secondary";
    }
}

function setDefaultReturnDate() {
    const dateInput = document.getElementById("requestExpectedReturnDate");
    if (!dateInput) return;
    dateInput.min = todayStr();
    dateInput.max = addDaysStr(30);
    if (!dateInput.value) dateInput.value = addDaysStr(3);
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("borrowingRequestForm")?.addEventListener("submit", submitBorrowingRequest);
    document.getElementById("requestSearch")?.addEventListener("input", displayRequests);
    document.getElementById("requestStatusFilter")?.addEventListener("change", displayRequests);
    setDefaultReturnDate();
});
