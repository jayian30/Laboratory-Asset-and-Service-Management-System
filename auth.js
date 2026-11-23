// ============================================================================
// AUTHENTICATION, ROLE-BASED ACCESS CONTROL (RBAC) & APP SHELL
// ============================================================================

let currentUser = null;
let currentProfile = null;

const SECTION_TITLES = {
    dashboardSection: "Dashboard",
    equipmentSection: "Equipment",
    availableEquipmentSection: "Browse Equipment",
    requestsSection: "Borrowing Requests",
    myRequestsSection: "My Requests",
    myHistorySection: "My History",
    maintenanceSection: "Maintenance",
    usersSection: "User Management",
    auditLogsSection: "Audit Logs"
};

/**
 * Fetch and ensure profile exists for the authenticated user
 */
async function fetchUserProfile(user) {
    if (!user) return null;

    try {
        let { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .maybeSingle();

        if (error || !profile) {
            console.warn("Profile not found in DB, auto-creating fallback profile...");
            const fullName = user.user_metadata?.full_name || user.email.split("@")[0];
            const role = user.user_metadata?.role || "requester";

            const { data: newProfile, error: createError } = await supabaseClient
                .from("profiles")
                .upsert([{ id: user.id, full_name: fullName, email: user.email, role }])
                .select()
                .single();

            if (createError) {
                console.error("Error creating user profile:", createError);
                return { id: user.id, full_name: fullName, email: user.email, role };
            }
            profile = newProfile;
        }

        return profile;
    } catch (err) {
        console.error("fetchUserProfile failed:", err);
        return {
            id: user.id,
            full_name: user.email ? user.email.split("@")[0] : "User",
            email: user.email,
            role: "requester"
        };
    }
}

/**
 * Checks login status, loads data, and opens the initial section
 */
async function checkAuthState() {
    if (!isSupabaseReady()) return;

    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        const isLoginPage = window.location.pathname.endsWith("login.html");

        if (session) {
            currentUser = session.user;
            currentProfile = await fetchUserProfile(currentUser);

            if (isLoginPage) {
                window.location.href = "index.html";
                return;
            }

            applyRoleAccessUI(currentProfile);

            const fromHash = (window.location.hash || "").replace(/^#\/?/, "");
            const initial = SECTION_TITLES[fromHash] && isSectionAllowed(fromHash, currentProfile.role) ? fromHash : "dashboardSection";
            showSection(initial, { skipLoad: true });

            await refreshAllData();
        } else {
            currentUser = null;
            currentProfile = null;
            if (!isLoginPage) window.location.href = "login.html";
        }
    } catch (error) {
        console.error("Auth check failed:", error);
        if (typeof toast === "function") toast("Unable to verify your session. Please refresh the page.", "error");
    }
}

/**
 * Load every dataset the current role can see, then render all views once.
 */
let refreshInFlight = null;
let refreshQueued = null;

function refreshAllData(showFeedback = false) {
    if (!currentProfile) return Promise.resolve();

    // A refresh is already running: queue exactly one more run so callers
    // that just changed data always receive fresh results.
    if (refreshInFlight) {
        if (!refreshQueued) {
            refreshQueued = refreshInFlight.then(() => {
                refreshQueued = null;
                return refreshAllData(showFeedback);
            });
        }
        return refreshQueued;
    }

    const btn = document.getElementById("refreshBtn");
    btn?.classList.add("spinning");

    const role = currentProfile.role;
    // Equipment + maintenance first so requests/dashboards see consistent data
    const tasks = [loadEquipment({ silent: true }), loadRequests({ silent: true })];
    if (role === "admin" || role === "staff") tasks.push(loadMaintenance({ silent: true }));
    if (role === "admin") {
        tasks.push(loadUsers({ silent: true }));
        tasks.push(loadAuditLogs({ silent: true }));
    }

    refreshInFlight = Promise.allSettled(tasks).then(() => {
        renderActiveSection();
        updateNavCounts();
        if (showFeedback) toast("Data refreshed.", "info", "Up to date");
    }).finally(() => {
        refreshInFlight = null;
        btn?.classList.remove("spinning");
    });

    return refreshInFlight;
}

/** Re-render whichever section is visible from cached data. */
function renderActiveSection() {
    const id = window.activeSectionId || "dashboardSection";
    switch (id) {
        case "dashboardSection": if (typeof renderDashboard === "function") renderDashboard(); break;
        case "equipmentSection": displayEquipmentTable(); break;
        case "availableEquipmentSection": loadAvailableEquipmentGrid(); break;
        case "requestsSection": displayRequests(); break;
        case "myRequestsSection": renderMyRequests(); break;
        case "myHistorySection": renderMyHistory(); break;
        case "maintenanceSection": displayMaintenance(); break;
        case "usersSection": displayUsers(); break;
        case "auditLogsSection": displayAuditLogs(); break;
    }
    refreshIcons();
}

/** Sidebar badge counts */
function updateNavCounts() {
    const setCount = (id, n) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = n;
        el.hidden = !n;
    };
    const reqs = typeof borrowingRequestRecords !== "undefined" ? borrowingRequestRecords : [];
    const role = currentProfile?.role;

    if (role === "admin") setCount("navPendingCount", reqs.filter(r => r.status === "Pending").length);
    if (role === "staff") setCount("navPendingCount", reqs.filter(r => r.status === "Approved").length);
    if (role === "admin" || role === "staff") {
        const maint = typeof maintenanceRecords !== "undefined" ? maintenanceRecords : [];
        setCount("navMaintCount", maint.filter(m => m.status === "Pending").length);
    }
    if (role === "requester") {
        setCount("navMyActiveCount", reqs.filter(r => r.requester_id === currentUser?.id && ["Pending", "Approved", "Released", "Overdue"].includes(effectiveStatus(r))).length);
    }
}

/**
 * Update UI elements and navigation visibility based on user role
 */
function applyRoleAccessUI(profile) {
    if (!profile) return;

    const role = profile.role || "requester";
    const name = profile.full_name || profile.email;

    const userNameElem = document.getElementById("headerUserName");
    const userRoleElem = document.getElementById("headerUserRole");
    if (userNameElem) userNameElem.textContent = name;
    if (userRoleElem) userRoleElem.textContent = roleLabel(role);

    ["sidebarAvatar", "topbarAvatar"].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.textContent = initials(name);
            el.className = `avatar ${id === "topbarAvatar" ? "avatar-sm" : ""} avatar-${role}`;
            el.title = `${name} · ${roleLabel(role)}`;
        }
    });

    const dateEl = document.getElementById("topbarDate");
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

    document.querySelectorAll("[data-role-required]").forEach(elem => {
        const requiredRoles = elem.getAttribute("data-role-required").split(",");
        elem.classList.toggle("role-hidden", !requiredRoles.includes(role));
    });

    // Default borrower name on the request form
    const borrowerName = document.getElementById("requestBorrowerName");
    if (borrowerName && !borrowerName.value) borrowerName.value = profile.full_name || "";

    refreshIcons();
}

/**
 * Validates if the user role is authorized to view a specific UI section
 */
function isSectionAllowed(sectionId, role) {
    if (role === "admin") {
        return !["availableEquipmentSection", "myRequestsSection", "myHistorySection"].includes(sectionId);
    }
    if (role === "staff") {
        return ["dashboardSection", "equipmentSection", "requestsSection", "maintenanceSection"].includes(sectionId);
    }
    if (role === "requester") {
        return ["dashboardSection", "availableEquipmentSection", "myRequestsSection", "myHistorySection"].includes(sectionId);
    }
    return false;
}

/**
 * Global section switcher with RBAC enforcement
 */
function showSection(sectionId, { skipLoad = false } = {}) {
    const role = currentProfile ? currentProfile.role : "requester";

    if (!isSectionAllowed(sectionId, role)) {
        toast("You do not have permission to access this module.", "error", "Access denied");
        sectionId = "dashboardSection";
    }

    window.activeSectionId = sectionId;

    document.querySelectorAll(".page-section").forEach(sec => sec.classList.add("hidden"));
    document.getElementById(sectionId)?.classList.remove("hidden");

    document.querySelectorAll(".nav-link[data-section]").forEach(link => {
        link.classList.toggle("active", link.dataset.section === sectionId);
    });

    const titleEl = document.getElementById("topbarSectionTitle");
    if (titleEl) titleEl.textContent = SECTION_TITLES[sectionId] || "Dashboard";
    document.title = `${SECTION_TITLES[sectionId] || "Dashboard"} · LabTrack`;

    // "#/section" (not "#section") so the browser doesn't jump to the element with that id
    if (history.replaceState) history.replaceState(null, "", `#/${sectionId}`);
    toggleSidebar(false);
    window.scrollTo({ top: 0 });

    if (skipLoad || !currentProfile) return;

    // Render immediately from cache, then refresh from the server.
    renderActiveSection();
    refreshAllData();
}

function toggleSidebar(force) {
    const open = typeof force === "boolean" ? force : !document.body.classList.contains("sidebar-open");
    document.body.classList.toggle("sidebar-open", open);
}

/**
 * Handle Sign Out
 */
async function logout() {
    if (!isSupabaseReady()) {
        window.location.href = "login.html";
        return;
    }

    const ok = await confirmDialog("Sign out?", "You will need to log in again to access the system.", { confirmText: "Sign out", variant: "danger", iconName: "log-out" });
    if (!ok) return;

    try {
        if (typeof createAuditLog === "function" && currentUser) {
            await createAuditLog("LOGOUT", "Auth", currentUser.id, `User ${currentProfile?.full_name || currentUser.email} logged out.`);
        }
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error("Logout failed:", error);
    } catch (error) {
        console.error("Logout error:", error);
    }
    currentUser = null;
    currentProfile = null;
    window.location.href = "login.html";
}

window.logout = logout;
window.showSection = showSection;
window.toggleSidebar = toggleSidebar;
window.refreshAllData = refreshAllData;

// ============================================================================
// LOGIN / REGISTER PAGE
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
    checkAuthState();

    const loginForm = document.getElementById("loginForm");
    if (!loginForm) return;

    const loginMessage = document.getElementById("loginMessage");
    const authSubmitButton = document.getElementById("authSubmitButton");
    const authSwitchText = document.getElementById("authSwitchText");
    const authSwitchButton = document.getElementById("authSwitchButton");
    const fullNameGroup = document.getElementById("fullNameGroup");
    const roleSelectGroup = document.getElementById("roleSelectGroup");
    const authTitle = document.getElementById("authTitle");
    const authSubtitle = document.getElementById("authSubtitle");
    let isRegisterMode = false;

    const setMessage = (text, type = "") => {
        loginMessage.textContent = text;
        loginMessage.className = `login-message ${type ? type + "-message" : ""}`;
    };

    authSwitchButton?.addEventListener("click", () => {
        isRegisterMode = !isRegisterMode;
        authSubmitButton.textContent = isRegisterMode ? "Create Account" : "Sign In";
        authSwitchText.textContent = isRegisterMode ? "Already have an account?" : "Don't have an account?";
        authSwitchButton.textContent = isRegisterMode ? "Sign in instead" : "Create one";
        if (authTitle) authTitle.textContent = isRegisterMode ? "Create your account" : "Welcome back";
        if (authSubtitle) authSubtitle.textContent = isRegisterMode ? "Register to start borrowing laboratory equipment" : "Sign in to continue to LabTrack";
        setMessage("");
        if (fullNameGroup) fullNameGroup.style.display = isRegisterMode ? "block" : "none";
        if (roleSelectGroup) roleSelectGroup.style.display = isRegisterMode ? "block" : "none";
        document.getElementById("fullName").required = isRegisterMode;
    });

    // Demo account quick-fill buttons
    document.querySelectorAll("[data-demo-email]").forEach(btn => {
        btn.addEventListener("click", () => {
            document.getElementById("email").value = btn.dataset.demoEmail;
            document.getElementById("password").value = btn.dataset.demoPassword;
            if (isRegisterMode) authSwitchButton.click();
            setMessage(`Demo credentials filled for ${btn.dataset.demoLabel}. Click Sign In.`, "info");
        });
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        setMessage("");

        if (!isSupabaseReady()) {
            setMessage("Supabase is not configured properly.", "error");
            return;
        }

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const fullName = isRegisterMode ? document.getElementById("fullName").value.trim() : "";
        const role = isRegisterMode ? document.getElementById("registerRole").value : "requester";

        if (isRegisterMode && !fullName) {
            setMessage("Please enter your full name.", "error");
            return;
        }
        if (isRegisterMode && password.length < 8) {
            setMessage("Password must be at least 8 characters.", "error");
            return;
        }

        authSubmitButton.disabled = true;
        setMessage(isRegisterMode ? "Creating account..." : "Signing in...", "info");

        try {
            if (isRegisterMode) {
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name: fullName, role } }
                });

                if (error) {
                    setMessage(error.message, "error");
                    return;
                }

                if (data.user && data.session) {
                    await supabaseClient.from("profiles").upsert({ id: data.user.id, full_name: fullName, email, role });
                    setMessage("Account created successfully! Redirecting...", "success");
                    setTimeout(() => { window.location.href = "index.html"; }, 900);
                } else {
                    setMessage("Account created. Please check your email to confirm your account, then sign in.", "success");
                }
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

                if (error) {
                    setMessage(error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message, "error");
                    return;
                }

                const profile = await fetchUserProfile(data.user);
                currentUser = data.user;
                currentProfile = profile;
                await createAuditLog("LOGIN", "Auth", data.user.id, `User ${profile?.full_name || email} logged in.`);

                setMessage("Login successful! Redirecting...", "success");
                setTimeout(() => { window.location.href = "index.html"; }, 600);
            }
        } catch (err) {
            console.error(err);
            setMessage("Authentication error occurred. Please try again.", "error");
        } finally {
            authSubmitButton.disabled = false;
        }
    });
});
