// ============================================================================
// ROLE-BASED DASHBOARDS (Admin · Laboratory Staff · Requester)
// Renders entirely from cached module data loaded by refreshAllData().
// ============================================================================

function renderDashboard() {
    const container = document.getElementById("dashboardContent");
    if (!container || !currentProfile) return;

    const role = currentProfile.role || "requester";
    let html = "";
    if (role === "admin") html = buildAdminDashboard();
    else if (role === "staff") html = buildStaffDashboard();
    else html = buildRequesterDashboard();

    container.innerHTML = html;
    refreshIcons();
}

/* ============================================================================
   SHARED METRICS
============================================================================ */

function inventoryUnits() {
    let available = 0, onLoan = 0, outOfService = 0, total = 0;
    equipmentRecords.forEach(e => {
        total += e.quantity;
        onLoan += Math.max(0, e.quantity - e.available_quantity);
        if (e.status === "Maintenance" || e.status === "Damaged") outOfService += e.available_quantity;
        else available += e.available_quantity;
    });
    return { available, onLoan, outOfService, total };
}

function requestsWith(status) {
    return borrowingRequestRecords.filter(r => effectiveStatus(r) === status);
}

function sortByDue(list) {
    return [...list].sort((a, b) => (a.expected_return_date || "").localeCompare(b.expected_return_date || ""));
}

/* ============================================================================
   BUILDING BLOCKS
============================================================================ */

function welcomeBanner({ subtitle, actions = "" }) {
    const name = (currentProfile.full_name || "").split(" ")[0] || "there";
    const dateText = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    return `
        <div class="welcome-banner">
            <div>
                <p class="welcome-eyebrow">${icon("calendar")} ${dateText} · ${escapeHTML(roleLabel(currentProfile.role))}</p>
                <h2>${greeting()}, ${escapeHTML(name)}</h2>
                <p class="welcome-sub">${subtitle}</p>
            </div>
            <div class="welcome-actions">${actions}</div>
        </div>`;
}

/**
 * Stat tile: label · value · supporting line. Tone is a status cue (always paired with icon + label).
 */
function kpiTile({ label, value, sub = "", iconName, tone = "neutral", onclick = "" }) {
    const tag = onclick ? "button" : "div";
    return `
        <${tag} class="kpi-tile kpi-${tone}" ${onclick ? `onclick="${onclick}" type="button"` : ""}>
            <div class="kpi-head">
                <span class="kpi-label">${escapeHTML(label)}</span>
                <span class="kpi-icon">${icon(iconName)}</span>
            </div>
            <div class="kpi-value">${typeof value === "number" ? value.toLocaleString() : value}</div>
            ${sub ? `<div class="kpi-sub">${sub}</div>` : ""}
        </${tag}>`;
}

function panel({ title, iconName = "", action = "", body, className = "" }) {
    return `
        <section class="dash-panel ${className}">
            <header class="dash-panel-header">
                <h3>${iconName ? icon(iconName) : ""}${title}</h3>
                ${action}
            </header>
            <div class="dash-panel-body">${body}</div>
        </section>`;
}

function linkBtn(text, onclick) {
    return `<button class="link-btn" onclick="${onclick}">${escapeHTML(text)} ${icon("arrow-right")}</button>`;
}

function emptyState(iconName, title, text = "") {
    return `<div class="empty-mini">${icon(iconName)}<strong>${escapeHTML(title)}</strong>${text ? `<span>${escapeHTML(text)}</span>` : ""}</div>`;
}

/** Tall segmented bar - one whole split into parts, with legend and accessible name */
function segmentedBar(parts, unit = "units") {
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (total === 0) return emptyState("package", "No inventory recorded yet");

    const aria = parts.map(p => `${p.label}: ${p.value} ${unit} (${Math.round(p.value / total * 100)}%)`).join(", ");
    const blocks = parts.filter(p => p.value > 0).map(p => {
        const pct = p.value / total * 100;
        const label = pct >= 12 ? `${Math.round(pct)}%` : "";
        return `<div class="seg-block" style="flex:${p.value};background:var(${p.color})" tabindex="0"
                    data-tip="${escapeHTML(p.label)}|${p.value} ${unit} · ${Math.round(pct)}%">${label}</div>`;
    }).join("");

    const legend = parts.map(p => `
        <li><span class="swatch" style="background:var(${p.color})"></span>${escapeHTML(p.label)}<strong>${p.value}</strong></li>`).join("");

    return `
        <div class="viz seg-bar" role="img" aria-label="${escapeHTML(aria)}">${blocks}</div>
        <ul class="viz-legend">${legend}</ul>`;
}

/** Horizontal bar list - single series, value at the tip */
function barList(items, { unit = "", max = null } = {}) {
    if (items.length === 0 || items.every(i => i.value === 0)) return emptyState("chart-no-axes-column", "No data yet");
    const top = max || Math.max(...items.map(i => i.value), 1);
    return `<ul class="viz bar-list">${items.map(i => `
        <li tabindex="0" data-tip="${escapeHTML(i.label)}|${i.value}${unit ? " " + unit : ""}${i.extra ? " · " + escapeHTML(i.extra) : ""}">
            <span class="bar-label">${i.icon ? icon(i.icon) : ""}${escapeHTML(i.label)}</span>
            <span class="bar-track"><span class="bar-fill" style="width:${Math.max(i.value > 0 ? 2 : 0, (i.value / top) * 100)}%"></span></span>
            <span class="bar-value">${i.value}${i.extra ? `<small> ${escapeHTML(i.extra)}</small>` : ""}</span>
        </li>`).join("")}</ul>`;
}

/** Column chart (SVG) - single series over days, with gridlines and hover tooltip */
function columnChart(points, { height = 200, width = 640, label = "" } = {}) {
    const max = Math.max(...points.map(p => p.value), 0);
    const niceMax = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
    const ticks = [0, niceMax / 4, niceMax / 2, (niceMax * 3) / 4, niceMax];

    const W = width, H = height, padL = 28, padR = 8, padT = 10, padB = 26;
    // Show as many x labels as fit (~70 units each), always including today
    const labelStep = Math.max(1, Math.ceil(points.length / Math.floor((W - padL) / 70)));
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const band = plotW / points.length;
    const barW = Math.min(24, band * 0.6);

    const grid = ticks.map(t => {
        const y = padT + plotH - (t / niceMax) * plotH;
        return `<line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" class="${t === 0 ? "axis-line" : "grid-line"}"/>
                <text x="${padL - 6}" y="${y + 3}" class="axis-text" text-anchor="end">${t}</text>`;
    }).join("");

    const bars = points.map((p, i) => {
        const h = niceMax ? (p.value / niceMax) * plotH : 0;
        const x = padL + band * i + (band - barW) / 2;
        const y = padT + plotH - h;
        const r = Math.min(4, h, barW / 2);
        const base = padT + plotH;
        // 4px rounded data-end, square at the baseline
        const path = h > 0
            ? `M${x},${base} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barW - r},${y} Q${x + barW},${y} ${x + barW},${y + r} L${x + barW},${base} Z`
            : "";
        const showLabel = (points.length - 1 - i) % labelStep === 0;
        return `
            <g class="col" tabindex="0" data-tip="${escapeHTML(p.fullLabel)}|${p.value} request${p.value === 1 ? "" : "s"}">
                <rect x="${padL + band * i}" y="${padT}" width="${band}" height="${plotH}" class="col-hit"/>
                ${path ? `<path d="${path}" class="col-bar ${p.highlight ? "col-bar-current" : ""}"/>` : ""}
                ${showLabel ? `<text x="${x + barW / 2}" y="${H - 8}" class="axis-text" text-anchor="middle">${escapeHTML(p.label)}</text>` : ""}
            </g>`;
    }).join("");

    return `<svg class="viz col-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHTML(label)}">${grid}${bars}</svg>`;
}

function requestTrend(days = 14, filterFn = () => true) {
    const pts = [];
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = localDateStr(d);
        pts.push({
            label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
            fullLabel: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
            value: borrowingRequestRecords.filter(r => r.request_date === key && filterFn(r)).length,
            highlight: i === 0
        });
    }
    return pts;
}

/** Compact request row used inside dashboard lists */
function requestRow(req, { showActions = true, showBorrower = true } = {}) {
    const status = effectiveStatus(req);
    const due = ["Released", "Overdue"].includes(status) ? dueLabel(req.expected_return_date) : `Return by ${formatDate(req.expected_return_date)}`;
    const dueClass = status === "Overdue" ? "text-danger" : (daysUntil(req.expected_return_date) <= 1 && status === "Released") ? "text-warning" : "text-muted";
    return `
        <li class="list-row">
            <span class="list-icon">${icon(getCategoryIcon(req.equipment?.category))}</span>
            <div class="list-main">
                <strong>${escapeHTML(req.equipment?.name || "Equipment")} <span class="text-muted">× ${req.quantity}</span></strong>
                <small>${showBorrower ? `${escapeHTML(req.borrower_name)} · ${escapeHTML(req.department)} · ` : ""}<span class="${dueClass}">${due}</span></small>
            </div>
            <div class="list-side">
                ${showActions ? requestActionButtons(req) : ""}
                ${requestStatusBadge(status)}
                <button class="btn-icon" title="View details" onclick="showRequestDetails(${req.id})">${icon("eye")}</button>
            </div>
        </li>`;
}

function activityFeed(logs) {
    if (!logs.length) return emptyState("activity", "No recent activity");
    const iconFor = a => ({
        APPROVED: "check", REJECTED: "x", RELEASED: "package-check", RETURNED: "undo-2", CREATED: "plus",
        UPDATED: "pencil", DELETED: "trash-2", LOGIN: "log-in", LOGOUT: "log-out", CANCELLED: "ban",
        MAINTENANCE_REQUESTED: "wrench", MAINTENANCE_UPDATED: "wrench"
    }[a] || "activity");
    return `<ul class="feed">${logs.map(l => `
        <li>
            <span class="feed-icon feed-${(l.action || "").toLowerCase()}">${icon(iconFor(l.action))}</span>
            <div><p>${escapeHTML(l.description)}</p><small>${escapeHTML(l.user_name)} · ${timeAgo(l.created_at)}</small></div>
        </li>`).join("")}</ul>`;
}

function openEquipmentFiltered(status) {
    const sel = document.getElementById("equipmentStatusFilter");
    if (sel) sel.value = status;
    showSection("equipmentSection");
}

function openMaintenanceFiltered(status) {
    const sel = document.getElementById("maintenanceStatusFilter");
    if (sel) sel.value = status;
    showSection("maintenanceSection");
}

/* ============================================================================
   ADMIN DASHBOARD
============================================================================ */

function buildAdminDashboard() {
    const units = inventoryUnits();
    const pending = requestsWith("Pending");
    const overdue = requestsWith("Overdue");
    const released = requestsWith("Released");
    const openMaint = maintenanceRecords.filter(m => m.status === "Pending" || m.status === "In Maintenance");
    const utilization = units.total ? Math.round(units.onLoan / units.total * 100) : 0;
    const availability = units.total ? Math.round(units.available / units.total * 100) : 0;

    const thisMonth = todayStr().slice(0, 7);
    const monthRequests = borrowingRequestRecords.filter(r => (r.request_date || "").startsWith(thisMonth)).length;

    const subtitleParts = [];
    if (pending.length) subtitleParts.push(`<strong>${pending.length}</strong> request${pending.length === 1 ? "" : "s"} awaiting your approval`);
    if (overdue.length) subtitleParts.push(`<strong class="text-danger">${overdue.length}</strong> overdue loan${overdue.length === 1 ? "" : "s"}`);
    const subtitle = subtitleParts.length ? subtitleParts.join(" · ") : "Everything is up to date. No approvals are waiting.";

    const kpis = `
        <div class="kpi-grid">
            ${kpiTile({ label: "Total assets", value: equipmentRecords.length, sub: `${units.total} units across ${new Set(equipmentRecords.map(e => e.category)).size} categories`, iconName: "boxes", onclick: "openEquipmentFiltered('All')" })}
            ${kpiTile({ label: "Units available", value: units.available, sub: `${availability}% of inventory ready to lend`, iconName: "circle-check", tone: "good", onclick: "openEquipmentFiltered('Available')" })}
            ${kpiTile({ label: "Units on loan", value: units.onLoan, sub: `${utilization}% utilization · ${released.length + overdue.length} active loans`, iconName: "arrow-up-right", onclick: "openRequestsFiltered('Released')" })}
            ${kpiTile({ label: "Pending approval", value: pending.length, sub: pending.length ? `Oldest from ${timeAgo(pending[pending.length - 1].created_at)}` : "Queue is clear", iconName: "hourglass", tone: pending.length ? "warning" : "neutral", onclick: "openRequestsFiltered('Pending')" })}
            ${kpiTile({ label: "Overdue loans", value: overdue.length, sub: overdue.length ? "Follow up with borrowers" : "No overdue items", iconName: "alarm-clock", tone: overdue.length ? "critical" : "neutral", onclick: "openRequestsFiltered('Overdue')" })}
            ${kpiTile({ label: "Open maintenance", value: openMaint.length, sub: `${maintenanceRecords.filter(m => m.status === "In Maintenance").length} in repair now`, iconName: "wrench", tone: openMaint.length ? "serious" : "neutral", onclick: "openMaintenanceFiltered('All')" })}
        </div>`;

    const trend = requestTrend(14);
    const trendTotal = trend.reduce((a, p) => a + p.value, 0);
    const trendPanel = panel({
        title: "Borrowing requests · last 14 days",
        iconName: "chart-column",
        action: `<span class="panel-meta">${trendTotal} in 14 days · ${monthRequests} this month</span>`,
        body: columnChart(trend, { label: `Requests per day over the last 14 days, ${trendTotal} total` }),
        className: "span-2"
    });

    const inventoryPanel = panel({
        title: "Inventory units",
        iconName: "package",
        body: segmentedBar([
            { label: "Available", value: units.available, color: "--series-1" },
            { label: "On loan", value: units.onLoan, color: "--series-2" },
            { label: "Out of service", value: units.outOfService, color: "--series-3" }
        ]) + `
            <div class="mini-stats">
                <div><span>Utilization</span><strong>${utilization}%</strong></div>
                <div><span>Availability</span><strong>${availability}%</strong></div>
                <div><span>Users</span><strong>${userProfileRecords.length}</strong></div>
            </div>`
    });

    const pendingList = pending.slice(0, 6);
    const approvalsPanel = panel({
        title: `Approval queue${pending.length ? ` <span class="count-pill">${pending.length}</span>` : ""}`,
        iconName: "inbox",
        action: linkBtn("View all", "openRequestsFiltered('Pending')"),
        body: pendingList.length
            ? `<ul class="list">${pendingList.map(r => requestRow(r)).join("")}</ul>`
            : emptyState("check-check", "No pending approvals", "New requests from borrowers will appear here."),
        className: "span-2"
    });

    const statuses = ["Pending", "Approved", "Released", "Overdue", "Returned", "Rejected", "Cancelled"];
    const statusPanel = panel({
        title: "Requests by status",
        iconName: "list-checks",
        action: `<span class="panel-meta">${borrowingRequestRecords.length} total</span>`,
        body: barList(statuses.map(s => ({ label: s, value: requestsWith(s).length })))
    });

    const attention = sortByDue([...overdue, ...released.filter(r => daysUntil(r.expected_return_date) <= 2)]);
    const attentionPanel = panel({
        title: "Overdue & due soon",
        iconName: "alarm-clock",
        action: linkBtn("All loans", "openRequestsFiltered('Released')"),
        body: attention.length
            ? `<ul class="list">${attention.slice(0, 6).map(r => requestRow(r, { showActions: false })).join("")}</ul>`
            : emptyState("calendar-check", "No loans due in the next 2 days")
    });

    const byCat = {};
    equipmentRecords.forEach(e => {
        byCat[e.category] = byCat[e.category] || { units: 0, avail: 0 };
        byCat[e.category].units += e.quantity;
        byCat[e.category].avail += isBorrowable(e) ? e.available_quantity : 0;
    });
    const catPanel = panel({
        title: "Units by category",
        iconName: "layers",
        action: linkBtn("Inventory", "openEquipmentFiltered('All')"),
        body: barList(Object.entries(byCat).sort((a, b) => b[1].units - a[1].units).map(([cat, v]) => ({
            label: cat, value: v.units, extra: `${v.avail} free`, icon: getCategoryIcon(cat)
        })), { unit: "units" })
    });

    const since = addDaysStr(-90);
    const popularity = {};
    borrowingRequestRecords.filter(r => r.request_date >= since && !["Rejected", "Cancelled"].includes(r.status)).forEach(r => {
        const k = r.equipment?.name || `#${r.equipment_id}`;
        popularity[k] = (popularity[k] || 0) + 1;
    });
    const popularPanel = panel({
        title: "Most requested · 90 days",
        iconName: "trending-up",
        body: barList(Object.entries(popularity).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, n]) => ({ label: name, value: n })), { unit: "requests" })
    });

    const feedPanel = panel({
        title: "Recent activity",
        iconName: "activity",
        action: linkBtn("Audit log", "showSection('auditLogsSection')"),
        body: activityFeed(auditLogRecords.filter(l => l.action !== "LOGIN" && l.action !== "LOGOUT").slice(0, 7))
    });

    const maintList = openMaint.slice(0, 5);
    const maintPanel = panel({
        title: "Maintenance tickets",
        iconName: "wrench",
        action: linkBtn("Manage", "openMaintenanceFiltered('All')"),
        body: maintList.length ? `<ul class="list">${maintList.map(maintRow).join("")}</ul>` : emptyState("shield-check", "No open maintenance tickets")
    });

    const actions = `
        <button class="btn btn-primary" onclick="openRequestsFiltered('Pending')">${icon("inbox")} Review requests</button>
        <button class="btn btn-ghost" onclick="showSection('equipmentSection'); openEquipmentForm();">${icon("plus")} Add equipment</button>`;

    return `
        ${welcomeBanner({ subtitle, actions })}
        ${overdue.length ? alertStrip("critical", "alarm-clock", `${overdue.length} loan${overdue.length === 1 ? " is" : "s are"} overdue.`, "Review overdue", "openRequestsFiltered('Overdue')") : ""}
        ${kpis}
        <div class="dash-grid">
            ${trendPanel}
            ${inventoryPanel}
            ${approvalsPanel}
            ${statusPanel}
            ${attentionPanel}
            ${catPanel}
            ${popularPanel}
            ${maintPanel}
            ${feedPanel}
        </div>`;
}

function maintRow(m) {
    return `
        <li class="list-row">
            <span class="list-icon">${icon(getCategoryIcon(m.equipment?.category))}</span>
            <div class="list-main">
                <strong>${escapeHTML(m.equipment?.name || "Equipment")} <span class="text-muted">#${m.id}</span></strong>
                <small>${escapeHTML(m.issue_description)}</small>
            </div>
            <div class="list-side">${maintenanceStatusBadge(m.status)}</div>
        </li>`;
}

function alertStrip(tone, iconName, text, actionText, onclick) {
    return `
        <div class="alert-strip alert-${tone}" role="status">
            ${icon(iconName)}<span>${text}</span>
            ${actionText ? `<button class="link-btn" onclick="${onclick}">${escapeHTML(actionText)} ${icon("arrow-right")}</button>` : ""}
        </div>`;
}

/* ============================================================================
   STAFF DASHBOARD
============================================================================ */

function buildStaffDashboard() {
    const units = inventoryUnits();
    const approved = sortByDue(requestsWith("Approved"));
    const released = requestsWith("Released");
    const overdue = sortByDue(requestsWith("Overdue"));
    const pending = requestsWith("Pending");
    const dueSoon = released.filter(r => daysUntil(r.expected_return_date) <= 1);
    const activeLoans = sortByDue([...overdue, ...released]);
    const openMaint = maintenanceRecords.filter(m => m.status === "Pending" || m.status === "In Maintenance");
    const todayReturns = borrowingRequestRecords.filter(r => r.status === "Returned" && r.actual_return_date === todayStr()).length;
    const todayReleases = borrowingRequestRecords.filter(r => r.released_at && localDateStr(new Date(r.released_at)) === todayStr()).length;

    const parts = [];
    if (approved.length) parts.push(`<strong>${approved.length}</strong> ready for release`);
    if (dueSoon.length) parts.push(`<strong>${dueSoon.length}</strong> due back by tomorrow`);
    if (overdue.length) parts.push(`<strong class="text-danger">${overdue.length}</strong> overdue`);
    const subtitle = parts.length ? `Today's desk: ${parts.join(" · ")}` : "No hand-overs or returns waiting right now.";

    const kpis = `
        <div class="kpi-grid">
            ${kpiTile({ label: "Ready for release", value: approved.length, sub: "Approved by admin", iconName: "package-check", tone: approved.length ? "warning" : "neutral", onclick: "openRequestsFiltered('Approved')" })}
            ${kpiTile({ label: "Active loans", value: released.length + overdue.length, sub: `${units.onLoan} units out`, iconName: "arrow-up-right", onclick: "openRequestsFiltered('Released')" })}
            ${kpiTile({ label: "Due by tomorrow", value: dueSoon.length, sub: "Expect these returns", iconName: "calendar-clock", tone: dueSoon.length ? "serious" : "neutral", onclick: "openRequestsFiltered('Released')" })}
            ${kpiTile({ label: "Overdue", value: overdue.length, sub: overdue.length ? "Contact borrowers" : "None overdue", iconName: "alarm-clock", tone: overdue.length ? "critical" : "neutral", onclick: "openRequestsFiltered('Overdue')" })}
            ${kpiTile({ label: "Open maintenance", value: openMaint.length, sub: `${maintenanceRecords.filter(m => m.status === "Pending").length} not started`, iconName: "wrench", tone: openMaint.length ? "serious" : "neutral", onclick: "openMaintenanceFiltered('All')" })}
            ${kpiTile({ label: "Units available", value: units.available, sub: `${todayReleases} released · ${todayReturns} returned today`, iconName: "circle-check", tone: "good", onclick: "openEquipmentFiltered('Available')" })}
        </div>`;

    const releasePanel = panel({
        title: `Release queue${approved.length ? ` <span class="count-pill">${approved.length}</span>` : ""}`,
        iconName: "package-check",
        action: linkBtn("View all", "openRequestsFiltered('Approved')"),
        body: approved.length
            ? `<ul class="list">${approved.slice(0, 6).map(r => requestRow(r)).join("")}</ul>`
            : emptyState("check-check", "Nothing to release", pending.length ? `${pending.length} request(s) are still awaiting admin approval.` : ""),
        className: "span-2"
    });

    const inventoryPanel = panel({
        title: "Inventory units",
        iconName: "package",
        body: segmentedBar([
            { label: "Available", value: units.available, color: "--series-1" },
            { label: "On loan", value: units.onLoan, color: "--series-2" },
            { label: "Out of service", value: units.outOfService, color: "--series-3" }
        ])
    });

    const returnsPanel = panel({
        title: `Returns desk${activeLoans.length ? ` <span class="count-pill">${activeLoans.length}</span>` : ""}`,
        iconName: "undo-2",
        action: linkBtn("All loans", "openRequestsFiltered('Released')"),
        body: activeLoans.length
            ? `<ul class="list">${activeLoans.slice(0, 7).map(r => requestRow(r)).join("")}</ul>`
            : emptyState("calendar-check", "No equipment is out on loan"),
        className: "span-2"
    });

    const lowStock = equipmentRecords
        .filter(e => e.status !== "Maintenance" && e.status !== "Damaged" && e.quantity > 0 && e.available_quantity / e.quantity <= 0.34)
        .sort((a, b) => a.available_quantity / a.quantity - b.available_quantity / b.quantity);
    const stockPanel = panel({
        title: "Low stock",
        iconName: "battery-low",
        action: linkBtn("Inventory", "openEquipmentFiltered('All')"),
        body: lowStock.length
            ? `<ul class="list">${lowStock.slice(0, 6).map(e => `
                <li class="list-row">
                    <span class="list-icon">${icon(getCategoryIcon(e.category))}</span>
                    <div class="list-main"><strong>${escapeHTML(e.name)}</strong><small><code>${escapeHTML(e.equipment_code)}</code> · ${escapeHTML(e.location || "")}</small></div>
                    <div class="list-side"><span class="stock-pill ${e.available_quantity === 0 ? "stock-out" : ""}">${e.available_quantity}/${e.quantity} left</span></div>
                </li>`).join("")}</ul>`
            : emptyState("battery-full", "All items are well stocked")
    });

    const maintPanel = panel({
        title: "Maintenance queue",
        iconName: "wrench",
        action: linkBtn("Manage", "openMaintenanceFiltered('All')"),
        body: openMaint.length
            ? `<ul class="list">${openMaint.slice(0, 6).map(m => `
                <li class="list-row">
                    <span class="list-icon">${icon(getCategoryIcon(m.equipment?.category))}</span>
                    <div class="list-main"><strong>${escapeHTML(m.equipment?.name || "Equipment")} <span class="text-muted">#${m.id}</span></strong><small>${escapeHTML(m.issue_description)}</small></div>
                    <div class="list-side">
                        ${m.status === "Pending"
                            ? `<button class="btn-action btn-info" onclick="updateMaintenanceStatus(${m.id}, 'In Maintenance', this)">${icon("play")}Start</button>`
                            : `<button class="btn-action btn-success" onclick="updateMaintenanceStatus(${m.id}, 'Completed', this)">${icon("check")}Complete</button>`}
                        ${maintenanceStatusBadge(m.status)}
                    </div>
                </li>`).join("")}</ul>`
            : emptyState("shield-check", "No open maintenance tickets"),
        className: "span-2"
    });

    const trend = requestTrend(14);
    const trendPanel = panel({
        title: "Request volume · 14 days",
        iconName: "chart-column",
        body: columnChart(trend, { height: 220, width: 360, label: "Requests per day over the last 14 days" })
    });

    const actions = `
        <button class="btn btn-primary" onclick="openRequestsFiltered('Approved')">${icon("package-check")} Release equipment</button>
        <button class="btn btn-ghost" onclick="showSection('maintenanceSection')">${icon("wrench")} Log issue</button>`;

    return `
        ${welcomeBanner({ subtitle, actions })}
        ${overdue.length ? alertStrip("critical", "alarm-clock", `${overdue.length} borrowed item${overdue.length === 1 ? " is" : "s are"} overdue.`, "Process returns", "openRequestsFiltered('Overdue')") : ""}
        ${kpis}
        <div class="dash-grid">
            ${releasePanel}
            ${inventoryPanel}
            ${returnsPanel}
            ${stockPanel}
            ${maintPanel}
            ${trendPanel}
        </div>`;
}

/* ============================================================================
   REQUESTER DASHBOARD
============================================================================ */

function buildRequesterDashboard() {
    const mine = myRequests();
    const status = r => effectiveStatus(r);
    const pending = mine.filter(r => status(r) === "Pending");
    const approved = mine.filter(r => status(r) === "Approved");
    const active = sortByDue(mine.filter(r => ["Released", "Overdue"].includes(status(r))));
    const overdue = active.filter(r => status(r) === "Overdue");
    const returned = mine.filter(r => r.status === "Returned" || r.status === "Closed");
    const onTime = returned.filter(r => r.actual_return_date && r.actual_return_date <= r.expected_return_date).length;
    const onTimeRate = returned.length ? Math.round(onTime / returned.length * 100) : null;
    const availableItems = equipmentRecords.filter(isBorrowable);

    let subtitle = "Browse available laboratory equipment and submit a borrowing request in minutes.";
    if (overdue.length) subtitle = `<strong class="text-danger">You have ${overdue.length} overdue item${overdue.length === 1 ? "" : "s"}.</strong> Please return ${overdue.length === 1 ? "it" : "them"} to the laboratory as soon as possible.`;
    else if (approved.length) subtitle = `<strong>${approved.length}</strong> request${approved.length === 1 ? " is" : "s are"} approved and ready for pick-up at the laboratory.`;
    else if (active.length) subtitle = `You have <strong>${active.length}</strong> item${active.length === 1 ? "" : "s"} on loan. Next return: ${dueLabel(active[0].expected_return_date).toLowerCase()}.`;
    else if (pending.length) subtitle = `<strong>${pending.length}</strong> request${pending.length === 1 ? " is" : "s are"} waiting for administrator approval.`;

    const kpis = `
        <div class="kpi-grid">
            ${kpiTile({ label: "Available equipment", value: availableItems.length, sub: `${availableItems.reduce((a, e) => a + e.available_quantity, 0)} units ready to borrow`, iconName: "search", tone: "good", onclick: "showSection('availableEquipmentSection')" })}
            ${kpiTile({ label: "Pending approval", value: pending.length, sub: pending.length ? "Awaiting admin review" : "No pending requests", iconName: "hourglass", tone: pending.length ? "warning" : "neutral", onclick: "showSection('myRequestsSection')" })}
            ${kpiTile({ label: "Ready for pick-up", value: approved.length, sub: approved.length ? "Claim at the laboratory" : "Nothing to pick up", iconName: "thumbs-up", tone: approved.length ? "good" : "neutral", onclick: "showSection('myRequestsSection')" })}
            ${kpiTile({ label: "Currently borrowed", value: active.length, sub: overdue.length ? `<span class="text-danger">${overdue.length} overdue</span>` : active.length ? dueLabel(active[0].expected_return_date) : "No items on loan", iconName: "package-open", tone: overdue.length ? "critical" : "neutral", onclick: "showSection('myRequestsSection')" })}
            ${kpiTile({ label: "Completed", value: returned.length, sub: onTimeRate === null ? "No returns yet" : `${onTimeRate}% returned on time`, iconName: "circle-check", onclick: "showSection('myHistorySection')" })}
        </div>`;

    const loansPanel = panel({
        title: "My borrowed items",
        iconName: "package-open",
        action: linkBtn("My requests", "showSection('myRequestsSection')"),
        body: active.length ? `<div class="loan-cards">${active.map(loanCard).join("")}</div>`
            : emptyState("package-open", "You have no items on loan", "Approved requests appear here once staff release the equipment."),
        className: "span-2"
    });

    const statsPanel = panel({
        title: "My borrowing record",
        iconName: "user-check",
        body: `
            <div class="mini-stats mini-stats-col">
                <div><span>Total requests</span><strong>${mine.length}</strong></div>
                <div><span>On-time return rate</span><strong>${onTimeRate === null ? "-" : onTimeRate + "%"}</strong></div>
                <div><span>Rejected / cancelled</span><strong>${mine.filter(r => ["Rejected", "Cancelled"].includes(r.status)).length}</strong></div>
            </div>
            <div class="note-box">${icon("info")}<span>Borrowing period is up to 30 days. Return items on time to keep a good record.</span></div>`
    });

    // Active requests first, then the most recent closed ones
    const recent = [...mine].sort((a, b) => {
        const act = r => ACTIVE_STATUSES.includes(effectiveStatus(r)) ? 0 : 1;
        return act(a) - act(b) || String(b.created_at).localeCompare(String(a.created_at));
    }).slice(0, 5);
    const trackerPanel = panel({
        title: "Request tracker",
        iconName: "route",
        action: linkBtn("History", "showSection('myHistorySection')"),
        body: recent.length ? `<ul class="tracker-list">${recent.map(trackerRow).join("")}</ul>`
            : emptyState("file-plus-2", "No requests yet", "Submit your first borrowing request to see its progress here."),
        className: "span-2"
    });

    const picks = availableItems.slice().sort((a, b) => b.available_quantity - a.available_quantity).slice(0, 4);
    const picksPanel = panel({
        title: "Available now",
        iconName: "sparkles",
        action: linkBtn("Browse all", "showSection('availableEquipmentSection')"),
        body: picks.length ? `<ul class="list">${picks.map(e => `
            <li class="list-row">
                <span class="list-icon">${icon(getCategoryIcon(e.category))}</span>
                <div class="list-main"><strong>${escapeHTML(e.name)}</strong><small>${e.available_quantity} available · ${escapeHTML(e.location || "")}</small></div>
                <div class="list-side"><button class="btn-action btn-release" onclick="openBorrowModalForItem(${e.id})">${icon("hand")}Request</button></div>
            </li>`).join("")}</ul>` : emptyState("package-x", "No equipment is available right now")
    });

    const actions = `
        <button class="btn btn-primary" onclick="showSection('availableEquipmentSection')">${icon("search")} Browse equipment</button>
        <button class="btn btn-ghost" onclick="showSection('myRequestsSection')">${icon("file-plus-2")} New request</button>`;

    let alerts = "";
    if (overdue.length) alerts += alertStrip("critical", "alarm-clock", `${overdue.map(r => escapeHTML(r.equipment?.name)).join(", ")} ${overdue.length === 1 ? "is" : "are"} overdue. Return to the laboratory immediately.`, "", "");
    if (approved.length) alerts += alertStrip("good", "thumbs-up", `Request${approved.length === 1 ? "" : "s"} ${approved.map(r => "#" + r.id).join(", ")} approved. Visit the laboratory to pick up your equipment.`, "", "");

    return `
        ${welcomeBanner({ subtitle, actions })}
        ${alerts}
        ${kpis}
        <div class="dash-grid">
            ${loansPanel}
            ${statsPanel}
            ${trackerPanel}
            ${picksPanel}
        </div>`;
}

function loanCard(r) {
    const status = effectiveStatus(r);
    const start = new Date((r.released_at || r.request_date + "T00:00:00"));
    const end = new Date(r.expected_return_date + "T23:59:59");
    const pct = Math.min(100, Math.max(0, ((Date.now() - start) / Math.max(1, end - start)) * 100));
    const left = daysUntil(r.expected_return_date);
    const tone = status === "Overdue" ? "critical" : left <= 1 ? "serious" : "normal";
    return `
        <div class="loan-card loan-${tone}">
            <div class="loan-top">
                <span class="list-icon">${icon(getCategoryIcon(r.equipment?.category))}</span>
                <div><strong>${escapeHTML(r.equipment?.name || "Equipment")}</strong><small><code>${escapeHTML(r.equipment?.equipment_code || "")}</code> · Qty ${r.quantity}</small></div>
            </div>
            <div class="loan-due">
                <span>${icon(status === "Overdue" ? "alarm-clock" : "calendar")}${dueLabel(r.expected_return_date)}</span>
                <small>Return by ${formatDate(r.expected_return_date)}</small>
            </div>
            <div class="meter"><div class="meter-fill ${tone === "critical" ? "meter-empty" : tone === "serious" ? "meter-low" : ""}" style="width:${pct}%"></div></div>
        </div>`;
}

function trackerRow(r) {
    const status = effectiveStatus(r);
    const steps = ["Submitted", "Approved", "Released", "Returned"];
    let reached = 0;
    if (r.approved_at && r.status !== "Rejected") reached = 1;
    if (r.released_at) reached = 2;
    if (r.status === "Returned" || r.status === "Closed") reached = 3;
    const stopped = ["Rejected", "Cancelled"].includes(r.status);

    const stepper = stopped
        ? `<div class="stepper stepper-stopped">${icon(r.status === "Rejected" ? "circle-x" : "ban")}${r.status === "Rejected" ? "Rejected by administrator" : "Cancelled"}${r.remarks ? ` · <span class="text-muted">${escapeHTML(r.remarks)}</span>` : ""}</div>`
        : `<ol class="stepper">${steps.map((s, i) => `<li class="${i <= reached ? "done" : ""} ${i === reached + 1 && status !== "Overdue" ? "next" : ""} ${status === "Overdue" && i === 3 ? "late" : ""}"><span></span>${s}</li>`).join("")}</ol>`;

    return `
        <li class="tracker-row">
            <div class="tracker-head">
                <div><strong>${escapeHTML(r.equipment?.name || "Equipment")}</strong> <span class="text-muted">#${r.id} · ${formatDate(r.request_date)}</span></div>
                <div class="list-side">
                    ${r.status === "Pending" ? `<button class="btn-action btn-outline-danger" onclick="cancelRequest(${r.id}, this)">${icon("x")}Cancel</button>` : ""}
                    ${requestStatusBadge(status)}
                </div>
            </div>
            ${stepper}
        </li>`;
}

/* ============================================================================
   CHART TOOLTIP (hover + keyboard focus on any [data-tip] inside .viz)
============================================================================ */

(function setupChartTooltip() {
    let tip = null;
    const ensure = () => {
        if (!tip) {
            tip = document.createElement("div");
            tip.className = "chart-tooltip";
            tip.setAttribute("role", "tooltip");
            document.body.appendChild(tip);
        }
        return tip;
    };
    const show = (target, x, y) => {
        const [title, value] = (target.getAttribute("data-tip") || "").split("|");
        const t = ensure();
        t.innerHTML = `<strong>${escapeHTML(title)}</strong><span>${escapeHTML(value || "")}</span>`;
        t.style.display = "block";
        const w = t.offsetWidth, h = t.offsetHeight;
        t.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
        t.style.top = Math.max(8, y - h - 12) + "px";
    };
    const hide = () => { if (tip) tip.style.display = "none"; };

    document.addEventListener("mousemove", (e) => {
        const target = e.target.closest?.(".viz [data-tip]");
        if (target) show(target, e.clientX, e.clientY);
        else hide();
    });
    document.addEventListener("focusin", (e) => {
        const target = e.target.closest?.(".viz [data-tip]");
        if (target) {
            const r = target.getBoundingClientRect();
            show(target, r.left + r.width / 2, r.top);
        }
    });
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
})();

window.renderDashboard = renderDashboard;
window.openEquipmentFiltered = openEquipmentFiltered;
window.openMaintenanceFiltered = openMaintenanceFiltered;
