// ============================================================================
// EQUIPMENT MANAGEMENT MODULE
// ============================================================================

let equipmentRecords = [];

/**
 * Load Equipment records
 */
async function loadEquipment() {
    if (!isSupabaseReady()) return;

    const { data, error } = await supabaseClient
        .from("equipment")
        .select("*")
        .order("id", { ascending: false });

    if (error) {
        console.error("Error loading equipment:", error.message);
        return;
    }

    equipmentRecords = data || [];

    displayEquipmentTable();
    loadAvailableEquipmentGrid();
    populateEquipmentDropdowns();
    if (typeof renderDashboard === "function") renderDashboard();
}

/**
 * Render Equipment Management Table (Admin & Staff View)
 */
function displayEquipmentTable() {
    const tableBody = document.getElementById("equipmentTableBody");
    if (!tableBody) return;

    const search = document.getElementById("equipmentSearch")?.value.toLowerCase() || "";
    const filter = document.getElementById("equipmentStatusFilter")?.value || "All";

    const filtered = equipmentRecords.filter(item => {
        const text = `${item.name} ${item.equipment_code} ${item.category} ${item.location} ${item.condition}`.toLowerCase();
        const matchesSearch = text.includes(search);
        const matchesStatus = filter === "All" || item.status === filter;
        return matchesSearch && matchesStatus;
    });

    tableBody.innerHTML = "";

    if (filtered.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="9" class="empty-cell">No equipment records found.</td></tr>`;
        return;
    }

    const userRole = currentProfile ? currentProfile.role : "requester";

    filtered.forEach(item => {
        const row = document.createElement("tr");

        let actionButtons = "";
        if (userRole === "admin" || userRole === "staff") {
            actionButtons += `<button class="btn-action btn-edit" onclick="editEquipment(${item.id})">Edit</button>`;
        }

        // TC-A4-09: Delete restricted to Admin ONLY
        if (userRole === "admin") {
            actionButtons += ` <button class="btn-action btn-delete" onclick="deleteEquipment(${item.id})">Delete</button>`;
        }

        row.innerHTML = `
            <td>#${item.id}</td>
            <td><code>${escapeHTML(item.equipment_code)}</code></td>
            <td><strong>${escapeHTML(item.name)}</strong><br><small class="text-muted">${escapeHTML(item.description || "")}</small></td>
            <td>${escapeHTML(item.category)}</td>
            <td>${item.available_quantity} / ${item.quantity}</td>
            <td>${escapeHTML(item.location || "Lab 101")}</td>
            <td><span class="badge ${getConditionBadge(item.condition)}">${item.condition}</span></td>
            <td><span class="badge ${getEquipmentStatusBadge(item.status)}">${item.status}</span></td>
            <td>${actionButtons || '<span class="text-muted">Read Only</span>'}</td>
        `;

        tableBody.appendChild(row);
    });
}

/**
 * Render Available Equipment Cards (Requester Browse View)
 */
function loadAvailableEquipmentGrid() {
    const gridContainer = document.getElementById("availableEquipmentGrid");
    if (!gridContainer) return;

    const search = document.getElementById("availableSearch")?.value.toLowerCase() || "";
    const categoryFilter = document.getElementById("availableCategoryFilter")?.value || "All";

    const availableItems = equipmentRecords.filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(search) || item.equipment_code.toLowerCase().includes(search);
        const matchesCategory = categoryFilter === "All" || item.category === categoryFilter;
        // BR-A4-01 & BR-A4-09: Available only if status is 'Available' and qty > 0
        const isAvailable = item.status === "Available" && item.available_quantity > 0;
        return matchesSearch && matchesCategory && isAvailable;
    });

    gridContainer.innerHTML = "";

    if (availableItems.length === 0) {
        gridContainer.innerHTML = `<div class="empty-card"><p>No available equipment found matching your criteria.</p></div>`;
        return;
    }

    availableItems.forEach(item => {
        const card = document.createElement("div");
        card.className = "equipment-card";

        card.innerHTML = `
            <div class="equipment-card-badge">${escapeHTML(item.category)}</div>
            <div class="equipment-card-icon">${getCategoryIcon(item.category)}</div>
            <h3 class="equipment-card-title">${escapeHTML(item.name)}</h3>
            <p class="equipment-card-code">Code: <code>${escapeHTML(item.equipment_code)}</code></p>
            <p class="equipment-card-desc">${escapeHTML(item.description || "High quality laboratory item.")}</p>
            <div class="equipment-card-meta">
                <span>Location: ${escapeHTML(item.location || "Lab 101")}</span>
                <span class="stock-badge">Available: ${item.available_quantity}</span>
            </div>
            <button class="btn btn-primary btn-block" onclick="openBorrowModalForItem(${item.id})">
                Request to Borrow
            </button>
        `;

        gridContainer.appendChild(card);
    });
}

/**
 * Populate Equipment select dropdowns for Forms
 */
function populateEquipmentDropdowns() {
    const borrowSelect = document.getElementById("requestEquipmentSelect");
    const maintSelect = document.getElementById("maintEquipmentSelect");

    if (borrowSelect) {
        borrowSelect.innerHTML = `<option value="">-- Select Available Equipment --</option>`;
        equipmentRecords
            .filter(item => item.status === "Available" && item.available_quantity > 0)
            .forEach(item => {
                const opt = document.createElement("option");
                opt.value = item.id;
                opt.textContent = `${item.equipment_code} - ${item.name} (Avail: ${item.available_quantity})`;
                borrowSelect.appendChild(opt);
            });
    }

    if (maintSelect) {
        maintSelect.innerHTML = `<option value="">-- Select Equipment for Maintenance --</option>`;
        equipmentRecords.forEach(item => {
            const opt = document.createElement("option");
            opt.value = item.id;
            opt.textContent = `${item.equipment_code} - ${item.name} (${item.status})`;
            maintSelect.appendChild(opt);
        });
    }
}

/**
 * SAVE or UPDATE EQUIPMENT (Admin & Staff)
 */
async function saveEquipment(event) {
    event.preventDefault();

    if (!currentProfile || (currentProfile.role !== "admin" && currentProfile.role !== "staff")) {
        alert("Unauthorized: You do not have permission to manage equipment.");
        return;
    }

    const id = document.getElementById("equipmentId").value;
    const name = document.getElementById("equipmentName").value.trim();
    const equipmentCode = document.getElementById("equipmentCode").value.trim();
    const category = document.getElementById("equipmentCategory").value;
    const description = document.getElementById("equipmentDescription").value.trim();
    const quantity = parseInt(document.getElementById("equipmentQuantity").value, 10) || 1;
    const location = document.getElementById("equipmentLocation").value.trim();
    const condition = document.getElementById("equipmentCondition").value;

    if (!name || !equipmentCode || !category) {
        alert("Equipment Name, Asset Code, and Category are required.");
        return;
    }

    // Check code uniqueness
    const duplicate = equipmentRecords.find(e => e.equipment_code.toLowerCase() === equipmentCode.toLowerCase() && String(e.id) !== String(id));
    if (duplicate) {
        alert("Asset Code must be unique.");
        return;
    }

    if (id) {
        // UPDATE EXISTING EQUIPMENT
        const { error } = await supabaseClient
            .from("equipment")
            .update({
                name,
                equipment_code: equipmentCode,
                category,
                description,
                quantity,
                available_quantity: quantity,
                location,
                condition
            })
            .eq("id", id);

        if (error) {
            alert("Update failed: " + error.message);
            return;
        }

        await createAuditLog("UPDATED", "Equipment", id, `Updated equipment ${name} (${equipmentCode})`);
        alert("Equipment updated successfully!");
    } else {
        // CREATE NEW EQUIPMENT
        const { data: newEquip, error } = await supabaseClient
            .from("equipment")
            .insert([{
                name,
                equipment_code: equipmentCode,
                category,
                description,
                quantity,
                available_quantity: quantity,
                status: "Available",
                location,
                condition
            }])
            .select()
            .single();

        if (error) {
            alert("Insert failed: " + error.message);
            return;
        }

        await createAuditLog("CREATED", "Equipment", newEquip.id, `Created new equipment ${name} (${equipmentCode})`);
        alert("Equipment added successfully!");
    }

    clearEquipmentForm();
    await loadEquipment();
}

/**
 * EDIT EQUIPMENT
 */
function editEquipment(id) {
    const item = equipmentRecords.find(e => e.id === id);
    if (!item) return;

    document.getElementById("equipmentId").value = item.id;
    document.getElementById("equipmentName").value = item.name;
    document.getElementById("equipmentCode").value = item.equipment_code;
    document.getElementById("equipmentCategory").value = item.category;
    document.getElementById("equipmentDescription").value = item.description || "";
    document.getElementById("equipmentQuantity").value = item.quantity;
    document.getElementById("equipmentLocation").value = item.location || "Lab 101";
    document.getElementById("equipmentCondition").value = item.condition;

    document.getElementById("equipmentFormTitle").textContent = "Edit Equipment Record";
    window.scrollTo({ top: 0, behavior: "smooth" });
}

/**
 * DELETE EQUIPMENT (TC-A4-09: Blocked for Staff/Requester)
 */
async function deleteEquipment(id) {
    // BR / RLS Security Check: Admin ONLY
    if (!currentProfile || currentProfile.role !== "admin") {
        alert("Unauthorized: Only Administrator may delete equipment records.");
        return;
    }

    const item = equipmentRecords.find(e => e.id === id);
    if (!item) return;

    if (item.status === "Borrowed" || item.available_quantity < item.quantity) {
        alert("Borrowed equipment cannot be deleted while active transactions exist.");
        return;
    }

    if (!confirm(`Are you sure you want to delete "${item.name}" (${item.equipment_code})?`)) return;

    const { error } = await supabaseClient.from("equipment").delete().eq("id", id);

    if (error) {
        alert("Delete failed: " + error.message);
        return;
    }

    await createAuditLog("DELETED", "Equipment", id, `Deleted equipment ${item.name} (${item.equipment_code})`);

    alert("Equipment deleted successfully.");
    await loadEquipment();
}

function clearEquipmentForm() {
    document.getElementById("equipmentForm")?.reset();
    document.getElementById("equipmentId").value = "";
    document.getElementById("equipmentFormTitle").textContent = "Add New Equipment";
}

function openBorrowModalForItem(equipId) {
    const item = equipmentRecords.find(e => e.id === equipId);
    if (!item) return;

    showSection("myRequestsSection");
    const select = document.getElementById("requestEquipmentSelect");
    if (select) select.value = equipId;
}

function getEquipmentStatusBadge(status) {
    switch (status) {
        case "Available": return "badge-success";
        case "Borrowed": return "badge-warning";
        case "Maintenance": return "badge-danger";
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

function getCategoryIcon(cat) {
    switch (cat) {
        case "Laptop": return "💻";
        case "Projector": return "📽️";
        case "Camera": return "📷";
        case "Microphone": return "🎙️";
        case "Router": return "📡";
        default: return "📦";
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("equipmentForm");
    if (form) form.addEventListener("submit", saveEquipment);

    const search = document.getElementById("equipmentSearch");
    const filter = document.getElementById("equipmentStatusFilter");
    if (search) search.addEventListener("input", displayEquipmentTable);
    if (filter) filter.addEventListener("change", displayEquipmentTable);

    const availSearch = document.getElementById("availableSearch");
    const availCatFilter = document.getElementById("availableCategoryFilter");
    if (availSearch) availSearch.addEventListener("input", loadAvailableEquipmentGrid);
    if (availCatFilter) availCatFilter.addEventListener("change", loadAvailableEquipmentGrid);
});
