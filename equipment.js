// ============================================================================
// EQUIPMENT MANAGEMENT MODULE
// ============================================================================

let equipmentRecords = [];

/**
 * Load equipment records and re-render equipment views
 */
async function loadEquipment({ silent = false } = {}) {
    if (!isSupabaseReady()) return;

    const { data, error } = await supabaseClient
        .from("equipment")
        .select("*")
        .order("equipment_code", { ascending: true });

    if (error) {
        console.error("Error loading equipment:", error.message);
        if (!silent) toast("Could not load equipment: " + error.message, "error");
        return;
    }

    equipmentRecords = data || [];

    populateCategoryFilters();
    populateEquipmentDropdowns();
    displayEquipmentTable();
    loadAvailableEquipmentGrid();
}

function isBorrowable(item) {
    return item.status === "Available" && item.available_quantity > 0;
}

/** Fill both category filter dropdowns from the categories that exist in data */
function populateCategoryFilters() {
    const categories = [...new Set(equipmentRecords.map(e => e.category))].sort();
    ["equipmentCategoryFilter", "availableCategoryFilter"].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const current = sel.value || "All";
        sel.innerHTML = `<option value="All">All Categories</option>` +
            categories.map(c => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
        sel.value = categories.includes(current) ? current : "All";
    });
}

/**
 * Render Equipment Management Table (Admin & Staff View)
 */
function displayEquipmentTable() {
    const tableBody = document.getElementById("equipmentTableBody");
    if (!tableBody) return;

    renderEquipmentSummary();

    const search = document.getElementById("equipmentSearch")?.value.toLowerCase().trim() || "";
    const statusFilter = document.getElementById("equipmentStatusFilter")?.value || "All";
    const catFilter = document.getElementById("equipmentCategoryFilter")?.value || "All";

    const filtered = equipmentRecords.filter(item => {
        const text = `${item.name} ${item.equipment_code} ${item.category} ${item.location} ${item.condition} ${item.description}`.toLowerCase();
        return text.includes(search)
            && (statusFilter === "All" || item.status === statusFilter)
            && (catFilter === "All" || item.category === catFilter);
    });

    const footer = document.getElementById("equipmentTableFooter");
    if (footer) footer.textContent = `Showing ${filtered.length} of ${equipmentRecords.length} assets`;

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="empty-cell">${icon("package-search")}<p>No equipment matches your filters.</p></td></tr>`;
        refreshIcons();
        return;
    }

    const userRole = currentProfile ? currentProfile.role : "requester";

    tableBody.innerHTML = filtered.map(item => {
        const pct = item.quantity > 0 ? Math.round((item.available_quantity / item.quantity) * 100) : 0;
        let actions = "";
        if (userRole === "admin" || userRole === "staff") {
            actions += `<button class="btn-icon" title="Edit" aria-label="Edit ${escapeHTML(item.name)}" onclick="editEquipment(${item.id})">${icon("pencil")}</button>`;
            if (item.status !== "Maintenance") {
                actions += `<button class="btn-icon" title="Report issue" aria-label="Report issue" onclick="quickReportIssue(${item.id})">${icon("wrench")}</button>`;
            }
        }
        if (userRole === "admin") {
            actions += `<button class="btn-icon btn-icon-danger" title="Delete" aria-label="Delete ${escapeHTML(item.name)}" onclick="deleteEquipment(${item.id})">${icon("trash-2")}</button>`;
        }

        return `
            <tr>
                <td>
                    <div class="cell-asset">
                        <span class="asset-icon">${icon(getCategoryIcon(item.category))}</span>
                        <div>
                            <strong>${escapeHTML(item.name)}</strong>
                            <small><code>${escapeHTML(item.equipment_code)}</code>${item.description ? " · " + escapeHTML(item.description) : ""}</small>
                        </div>
                    </div>
                </td>
                <td>${escapeHTML(item.category)}</td>
                <td>
                    <div class="stock-cell">
                        <span><strong>${item.available_quantity}</strong> / ${item.quantity}</span>
                        <div class="meter"><div class="meter-fill ${pct === 0 ? "meter-empty" : pct < 50 ? "meter-low" : ""}" style="width:${pct}%"></div></div>
                    </div>
                </td>
                <td>${escapeHTML(item.location || "-")}</td>
                <td><span class="badge ${getConditionBadge(item.condition)}">${escapeHTML(item.condition)}</span></td>
                <td>${statusBadge(item.status)}</td>
                <td class="text-right nowrap">${actions || '<span class="text-muted">Read only</span>'}</td>
            </tr>`;
    }).join("");

    refreshIcons();
}

function renderEquipmentSummary() {
    const el = document.getElementById("equipmentSummaryChips");
    if (!el) return;
    const count = s => equipmentRecords.filter(e => e.status === s).length;
    const units = equipmentRecords.reduce((a, e) => a + e.quantity, 0);
    const out = equipmentRecords.reduce((a, e) => a + (e.quantity - e.available_quantity), 0);
    el.innerHTML = `
        <div class="chip-stat"><span>Assets</span><strong>${equipmentRecords.length}</strong></div>
        <div class="chip-stat"><span>Total units</span><strong>${units}</strong></div>
        <div class="chip-stat"><span>Units on loan</span><strong>${out}</strong></div>
        <div class="chip-stat"><span class="dot dot-good"></span><span>Available</span><strong>${count("Available")}</strong></div>
        <div class="chip-stat"><span class="dot dot-serious"></span><span>Fully borrowed</span><strong>${count("Borrowed")}</strong></div>
        <div class="chip-stat"><span class="dot dot-warning"></span><span>Maintenance</span><strong>${count("Maintenance")}</strong></div>
        <div class="chip-stat"><span class="dot dot-critical"></span><span>Damaged</span><strong>${count("Damaged")}</strong></div>
    `;
}

/**
 * Render Available Equipment Cards (Requester Browse View)
 */
function loadAvailableEquipmentGrid() {
    const gridContainer = document.getElementById("availableEquipmentGrid");
    if (!gridContainer) return;

    const search = document.getElementById("availableSearch")?.value.toLowerCase().trim() || "";
    const categoryFilter = document.getElementById("availableCategoryFilter")?.value || "All";

    // BR-A4-01 & BR-A4-09: Available only if status is 'Available' and qty > 0
    const availableItems = equipmentRecords.filter(item => {
        const text = `${item.name} ${item.equipment_code} ${item.description} ${item.category}`.toLowerCase();
        return text.includes(search)
            && (categoryFilter === "All" || item.category === categoryFilter)
            && isBorrowable(item);
    });

    if (availableItems.length === 0) {
        gridContainer.innerHTML = `<div class="empty-card">${icon("package-search")}<h4>No available equipment found</h4><p>Try a different search term or category.</p></div>`;
        refreshIcons();
        return;
    }

    gridContainer.innerHTML = availableItems.map(item => `
        <article class="equipment-card">
            <div class="equipment-card-top">
                <span class="equipment-card-icon">${icon(getCategoryIcon(item.category))}</span>
                <span class="equipment-card-badge">${escapeHTML(item.category)}</span>
            </div>
            <h3 class="equipment-card-title">${escapeHTML(item.name)}</h3>
            <p class="equipment-card-code"><code>${escapeHTML(item.equipment_code)}</code> · ${escapeHTML(item.condition)} condition</p>
            <p class="equipment-card-desc">${escapeHTML(item.description || "Laboratory equipment ready for borrowing.")}</p>
            <div class="equipment-card-meta">
                <span>${icon("map-pin")} ${escapeHTML(item.location || "Main Laboratory")}</span>
                <span class="stock-badge">${item.available_quantity} of ${item.quantity} available</span>
            </div>
            <button class="btn btn-primary btn-block" onclick="openBorrowModalForItem(${item.id})">
                ${icon("hand")} Request to Borrow
            </button>
        </article>
    `).join("");

    refreshIcons();
}

/**
 * Populate Equipment select dropdowns for Forms
 */
function populateEquipmentDropdowns() {
    const borrowSelect = document.getElementById("requestEquipmentSelect");
    const maintSelect = document.getElementById("maintEquipmentSelect");

    if (borrowSelect) {
        const current = borrowSelect.value;
        borrowSelect.innerHTML = `<option value="">-- Select Available Equipment --</option>` +
            equipmentRecords.filter(isBorrowable).map(item =>
                `<option value="${item.id}">${escapeHTML(item.equipment_code)} - ${escapeHTML(item.name)} (${item.available_quantity} available)</option>`
            ).join("");
        if (current && equipmentRecords.some(e => String(e.id) === current && isBorrowable(e))) borrowSelect.value = current;
        updateRequestQtyHelp();
    }

    if (maintSelect) {
        const current = maintSelect.value;
        maintSelect.innerHTML = `<option value="">-- Select Equipment --</option>` +
            equipmentRecords.map(item =>
                `<option value="${item.id}">${escapeHTML(item.equipment_code)} - ${escapeHTML(item.name)} (${escapeHTML(item.status)})</option>`
            ).join("");
        if (current) maintSelect.value = current;
    }
}

/** Show available quantity next to the request quantity input and cap it */
function updateRequestQtyHelp() {
    const select = document.getElementById("requestEquipmentSelect");
    const qty = document.getElementById("requestQuantity");
    const help = document.getElementById("requestQtyHelp");
    if (!select || !qty) return;
    const item = equipmentRecords.find(e => String(e.id) === select.value);
    if (item) {
        qty.max = item.available_quantity;
        if (help) help.textContent = `Maximum ${item.available_quantity} unit(s) available`;
    } else {
        qty.removeAttribute("max");
        if (help) help.textContent = "";
    }
}

function openEquipmentForm() {
    clearEquipmentForm(false);
    document.getElementById("equipmentFormPanel")?.classList.remove("hidden");
    document.getElementById("equipmentName")?.focus();
}

/**
 * SAVE or UPDATE EQUIPMENT (Admin & Staff)
 */
async function saveEquipment(event) {
    event.preventDefault();

    if (!currentProfile || (currentProfile.role !== "admin" && currentProfile.role !== "staff")) {
        toast("You do not have permission to manage equipment.", "error", "Unauthorized");
        return;
    }

    const id = document.getElementById("equipmentId").value;
    const name = document.getElementById("equipmentName").value.trim();
    const equipmentCode = document.getElementById("equipmentCode").value.trim().toUpperCase();
    const category = document.getElementById("equipmentCategory").value;
    const description = document.getElementById("equipmentDescription").value.trim();
    const quantity = parseInt(document.getElementById("equipmentQuantity").value, 10);
    const location = document.getElementById("equipmentLocation").value.trim() || "Main Laboratory";
    const condition = document.getElementById("equipmentCondition").value;

    if (!name || !equipmentCode || !category) {
        toast("Equipment name, asset code, and category are required.", "warning");
        return;
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
        toast("Quantity must be a whole number of at least 1.", "warning");
        return;
    }

    const duplicate = equipmentRecords.find(e => e.equipment_code.toLowerCase() === equipmentCode.toLowerCase() && String(e.id) !== String(id));
    if (duplicate) {
        toast(`Asset code ${equipmentCode} is already used by "${duplicate.name}".`, "warning", "Duplicate code");
        return;
    }

    const btn = document.getElementById("equipmentSaveBtn");
    await withBusy(btn, async () => {
        if (id) {
            const existing = equipmentRecords.find(e => String(e.id) === String(id));
            if (!existing) {
                toast("This record no longer exists. Refresh and try again.", "error");
                return;
            }

            // Keep units that are currently on loan out of the available count
            const unitsOnLoan = existing.quantity - existing.available_quantity;
            if (quantity < unitsOnLoan) {
                toast(`${unitsOnLoan} unit(s) are currently borrowed. Quantity cannot be lower than that.`, "warning", "Invalid quantity");
                return;
            }
            const availableQuantity = quantity - unitsOnLoan;
            const hasOpenTicket = (typeof maintenanceRecords !== "undefined") &&
                maintenanceRecords.some(m => m.equipment_id === existing.id && ["Pending", "In Maintenance"].includes(m.status));
            const status = deriveEquipmentStatus({ condition, availableQuantity, previousStatus: existing.status, hasOpenTicket });

            const { error } = await supabaseClient
                .from("equipment")
                .update({ name, equipment_code: equipmentCode, category, description, quantity, available_quantity: availableQuantity, location, condition, status })
                .eq("id", id);

            if (error) {
                toast("Update failed: " + friendlyDbError(error), "error");
                return;
            }

            await createAuditLog("UPDATED", "Equipment", id, `Updated equipment ${name} (${equipmentCode})`);
            toast(`${name} was updated.`, "success", "Equipment updated");
        } else {
            const status = deriveEquipmentStatus({ condition, availableQuantity: quantity, previousStatus: "Available", hasOpenTicket: false });
            const { data: newEquip, error } = await supabaseClient
                .from("equipment")
                .insert([{ name, equipment_code: equipmentCode, category, description, quantity, available_quantity: quantity, status, location, condition }])
                .select()
                .single();

            if (error) {
                toast("Insert failed: " + friendlyDbError(error), "error");
                return;
            }

            await createAuditLog("CREATED", "Equipment", newEquip.id, `Created new equipment ${name} (${equipmentCode})`);
            toast(`${name} was added to the inventory.`, "success", "Equipment added");
        }

        clearEquipmentForm(true);
        await refreshAllData();
    });
}

/** Single source of truth for equipment status after an edit */
function deriveEquipmentStatus({ condition, availableQuantity, previousStatus, hasOpenTicket }) {
    if (condition === "Damaged") return "Damaged";
    if (condition === "For Repair" || hasOpenTicket) return "Maintenance";
    return availableQuantity > 0 ? "Available" : "Borrowed";
}

/**
 * EDIT EQUIPMENT
 */
function editEquipment(id) {
    const item = equipmentRecords.find(e => e.id === id);
    if (!item) return;

    document.getElementById("equipmentFormPanel")?.classList.remove("hidden");
    document.getElementById("equipmentId").value = item.id;
    document.getElementById("equipmentName").value = item.name;
    document.getElementById("equipmentCode").value = item.equipment_code;
    document.getElementById("equipmentCategory").value = item.category;
    if (document.getElementById("equipmentCategory").value !== item.category) {
        // Category not in list: add it so the value is preserved
        const opt = document.createElement("option");
        opt.value = opt.textContent = item.category;
        document.getElementById("equipmentCategory").appendChild(opt);
        document.getElementById("equipmentCategory").value = item.category;
    }
    document.getElementById("equipmentDescription").value = item.description || "";
    document.getElementById("equipmentQuantity").value = item.quantity;
    document.getElementById("equipmentLocation").value = item.location || "";
    document.getElementById("equipmentCondition").value = item.condition;

    const onLoan = item.quantity - item.available_quantity;
    const help = document.getElementById("equipmentQtyHelp");
    if (help) help.textContent = onLoan > 0 ? `${onLoan} unit(s) currently on loan` : "";

    document.getElementById("equipmentFormTitle").textContent = `Edit ${item.equipment_code}`;
    document.getElementById("equipmentFormPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * DELETE EQUIPMENT (TC-A4-09: Admin only)
 */
async function deleteEquipment(id) {
    if (!currentProfile || currentProfile.role !== "admin") {
        toast("Only an Administrator may delete equipment records.", "error", "Unauthorized");
        return;
    }

    const item = equipmentRecords.find(e => e.id === id);
    if (!item) return;

    if (item.status === "Borrowed" || item.available_quantity < item.quantity) {
        toast("Equipment with units on loan cannot be deleted.", "warning", "Cannot delete");
        return;
    }

    const ok = await confirmDialog(`Delete ${item.equipment_code}?`, `"${item.name}" will be permanently removed from the inventory. This cannot be undone.`, { confirmText: "Delete", variant: "danger", iconName: "trash-2" });
    if (!ok) return;

    const { error } = await supabaseClient.from("equipment").delete().eq("id", id);

    if (error) {
        if (error.code === "23503") {
            toast("This equipment has borrowing history and cannot be deleted. Set its condition to Damaged to retire it instead.", "warning", "Cannot delete");
        } else {
            toast("Delete failed: " + friendlyDbError(error), "error");
        }
        return;
    }

    await createAuditLog("DELETED", "Equipment", id, `Deleted equipment ${item.name} (${item.equipment_code})`);
    toast(`${item.name} was deleted.`, "success", "Equipment deleted");
    await refreshAllData();
}

/** Open the maintenance form prefilled for an item */
function quickReportIssue(id) {
    showSection("maintenanceSection");
    const sel = document.getElementById("maintEquipmentSelect");
    if (sel) sel.value = id;
    document.getElementById("maintIssueDescription")?.focus();
}

function clearEquipmentForm(hide = false) {
    document.getElementById("equipmentForm")?.reset();
    document.getElementById("equipmentId").value = "";
    document.getElementById("equipmentFormTitle").textContent = "Add New Equipment";
    const help = document.getElementById("equipmentQtyHelp");
    if (help) help.textContent = "";
    if (hide) document.getElementById("equipmentFormPanel")?.classList.add("hidden");
}

function openBorrowModalForItem(equipId) {
    const item = equipmentRecords.find(e => e.id === equipId);
    if (!item) return;

    showSection("myRequestsSection");
    const select = document.getElementById("requestEquipmentSelect");
    if (select) {
        select.value = equipId;
        updateRequestQtyHelp();
    }
    document.getElementById("borrowingRequestForm")?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById("requestPurpose")?.focus({ preventScroll: true });
}

function friendlyDbError(error) {
    if (!error) return "Unknown error";
    if (error.code === "23505") return "A record with the same unique value already exists.";
    if (error.code === "23514") return "One of the values is not allowed by the database rules.";
    if (error.code === "42501" || /row-level security/i.test(error.message)) return "You do not have permission to perform this action.";
    return error.message;
}

function statusBadge(status) {
    const map = {
        Available: ["badge-success", "circle-check"],
        Borrowed: ["badge-serious", "arrow-up-right"],
        Maintenance: ["badge-warning", "wrench"],
        Damaged: ["badge-danger", "octagon-alert"]
    };
    const [cls, ic] = map[status] || ["badge-secondary", "circle"];
    return `<span class="badge ${cls}">${icon(ic)}${escapeHTML(status)}</span>`;
}

function getEquipmentStatusBadge(status) {
    switch (status) {
        case "Available": return "badge-success";
        case "Borrowed": return "badge-serious";
        case "Maintenance": return "badge-warning";
        case "Damaged": return "badge-danger";
        default: return "badge-secondary";
    }
}

function getConditionBadge(cond) {
    switch (cond) {
        case "Good": return "badge-success";
        case "Fair": return "badge-info";
        case "For Repair": return "badge-warning";
        case "Damaged": return "badge-danger";
        default: return "badge-secondary";
    }
}

/** Lucide icon name per category */
function getCategoryIcon(cat) {
    switch (cat) {
        case "Laptop": return "laptop";
        case "Tablet": return "tablet";
        case "Projector": return "projector";
        case "Camera": return "camera";
        case "Microphone": return "mic";
        case "Speaker": return "speaker";
        case "Router": return "router";
        case "Microcontroller": return "cpu";
        case "Toolkit": return "wrench";
        default: return "package";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("equipmentForm")?.addEventListener("submit", saveEquipment);

    ["equipmentSearch"].forEach(id => document.getElementById(id)?.addEventListener("input", displayEquipmentTable));
    ["equipmentStatusFilter", "equipmentCategoryFilter"].forEach(id => document.getElementById(id)?.addEventListener("change", displayEquipmentTable));

    document.getElementById("availableSearch")?.addEventListener("input", loadAvailableEquipmentGrid);
    document.getElementById("availableCategoryFilter")?.addEventListener("change", loadAvailableEquipmentGrid);

    document.getElementById("requestEquipmentSelect")?.addEventListener("change", updateRequestQtyHelp);
});
