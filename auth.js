// ============================================================================
// AUTHENTICATION & ROLE-BASED ACCESS CONTROL (RBAC)
// ============================================================================

let currentUser = null;
let currentProfile = null;

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
            .single();

        if (error || !profile) {
            console.warn("Profile not found in DB, auto-creating fallback profile...");
            const fullName = user.user_metadata?.full_name || user.email.split("@")[0];
            const role = user.user_metadata?.role || "requester";

            const { data: newProfile, error: createError } = await supabaseClient
                .from("profiles")
                .upsert([{
                    id: user.id,
                    full_name: fullName,
                    email: user.email,
                    role: role
                }])
                .select()
                .single();

            if (createError) {
                console.error("Error creating user profile:", createError);
                return { id: user.id, full_name: fullName, email: user.email, role: role };
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
 * Checks login status and enforces route/section access rules
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

            // Apply role-based navigation UI state
            applyRoleAccessUI(currentProfile);

            // Load core data (equipment records) for all authenticated roles
            if (typeof loadEquipment === "function") {
                await loadEquipment();
            }

        } else {
            currentUser = null;
            currentProfile = null;

            if (!isLoginPage) {
                window.location.href = "login.html";
            }
        }
    } catch (error) {
        console.error("Auth check failed:", error);
    }
}

/**
 * Update UI elements, sidebars, and access rules based on user role
 */
function applyRoleAccessUI(profile) {
    if (!profile) return;

    const role = profile.role || "requester";
    
    // Update user info display in header
    const userNameElem = document.getElementById("headerUserName");
    const userRoleElem = document.getElementById("headerUserRole");
    if (userNameElem) userNameElem.textContent = profile.full_name || profile.email;
    if (userRoleElem) userRoleElem.textContent = role.toUpperCase();

    // Toggle nav buttons visibility based on role
    document.querySelectorAll("[data-role-required]").forEach(elem => {
        const requiredRoles = elem.getAttribute("data-role-required").split(",");
        if (requiredRoles.includes(role)) {
            elem.classList.remove("role-hidden");
        } else {
            elem.classList.add("role-hidden");
        }
    });

    // Ensure default section load is valid for role
    const currentSection = window.activeSectionId || "dashboardSection";
    if (!isSectionAllowed(currentSection, role)) {
        showSection("dashboardSection");
    }
}

/**
 * Validates if the user role is authorized to view a specific UI section
 */
function isSectionAllowed(sectionId, role) {
    if (role === "admin") return true;

    if (role === "staff") {
        const staffForbidden = ["usersSection", "auditLogsSection"];
        return !staffForbidden.includes(sectionId);
    }

    if (role === "requester") {
        const requesterAllowed = ["dashboardSection", "availableEquipmentSection", "myRequestsSection", "myHistorySection"];
        return requesterAllowed.includes(sectionId);
    }

    return false;
}

/**
 * Global section switcher with RBAC Enforcement
 */
function showSection(sectionId) {
    const role = currentProfile ? currentProfile.role : "requester";

    // Guard checking
    if (!isSectionAllowed(sectionId, role)) {
        alert("Access Denied: You do not have permission to access this module.");
        window.location.hash = "#dashboardSection";
        return;
    }

    window.activeSectionId = sectionId;

    // Hide all sections
    document.querySelectorAll(".page-section").forEach(sec => sec.classList.add("hidden"));

    // Show target section
    const target = document.getElementById(sectionId);
    if (target) {
        target.classList.remove("hidden");
    }

    // Update nav tab active styling
    document.querySelectorAll(".nav-link").forEach(link => {
        if (link.getAttribute("onclick")?.includes(sectionId)) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });

    // Trigger section refresh hooks
    if (sectionId === "dashboardSection") {
        if (typeof loadEquipment === "function") loadEquipment();
        if (typeof renderDashboard === "function") renderDashboard();
    }
    if (sectionId === "equipmentSection" && typeof loadEquipment === "function") loadEquipment();
    if (sectionId === "availableEquipmentSection") {
        if (typeof loadEquipment === "function") loadEquipment();
        else if (typeof loadAvailableEquipmentGrid === "function") loadAvailableEquipmentGrid();
    }
    if (sectionId === "requestsSection" && typeof loadRequests === "function") loadRequests();
    if (sectionId === "myRequestsSection") {
        if (typeof loadEquipment === "function") loadEquipment();
        if (typeof loadMyRequests === "function") loadMyRequests();
    }
    if (sectionId === "myHistorySection" && typeof loadMyHistory === "function") loadMyHistory();
    if (sectionId === "maintenanceSection" && typeof loadMaintenance === "function") loadMaintenance();
    if (sectionId === "usersSection" && typeof loadUsers === "function") loadUsers();
    if (sectionId === "auditLogsSection" && typeof loadAuditLogs === "function") loadAuditLogs();
}

/**
 * Handle Sign Out
 */
async function logout() {
    if (!isSupabaseReady()) {
        window.location.href = "login.html";
        return;
    }

    try {
        if (typeof createAuditLog === "function" && currentUser) {
            await createAuditLog("LOGOUT", "Auth", currentUser.id, `User ${currentProfile?.full_name || currentUser.email} logged out.`);
        }

        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error("Logout failed:", error);

        currentUser = null;
        currentProfile = null;
        window.location.href = "login.html";
    } catch (error) {
        console.error("Logout error:", error);
        window.location.href = "login.html";
    }
}

window.logout = logout;
window.showSection = showSection;

// DOM Initialization for Login/Register Form
document.addEventListener("DOMContentLoaded", () => {
    checkAuthState();

    const loginForm = document.getElementById("loginForm");
    const loginMessage = document.getElementById("loginMessage");
    const authSubmitButton = document.getElementById("authSubmitButton");
    const authSwitchText = document.getElementById("authSwitchText");
    const authSwitchButton = document.getElementById("authSwitchButton");
    const fullNameGroup = document.getElementById("fullNameGroup");
    const roleSelectGroup = document.getElementById("roleSelectGroup");
    let isRegisterMode = false;

    if (!loginForm) return;

    if (authSwitchButton) {
        authSwitchButton.addEventListener("click", () => {
            isRegisterMode = !isRegisterMode;
            authSubmitButton.textContent = isRegisterMode ? "Create Account" : "Login";
            authSwitchText.textContent = isRegisterMode ? "Already have an account?" : "Don't have an account?";
            authSwitchButton.textContent = isRegisterMode ? "Login instead" : "Create one";
            loginMessage.textContent = "";

            if (fullNameGroup) fullNameGroup.style.display = isRegisterMode ? "block" : "none";
            if (roleSelectGroup) roleSelectGroup.style.display = isRegisterMode ? "block" : "none";
        });
    }

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        loginMessage.textContent = "";
        loginMessage.className = "login-message";

        if (!isSupabaseReady()) {
            loginMessage.textContent = "Supabase is not configured properly.";
            loginMessage.classList.add("error-message");
            return;
        }

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const fullName = isRegisterMode ? document.getElementById("fullName").value.trim() : "";
        const role = isRegisterMode ? document.getElementById("registerRole").value : "requester";

        loginMessage.textContent = isRegisterMode ? "Creating account..." : "Logging in...";

        try {
            if (isRegisterMode) {
                const { data, error } = await supabaseClient.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            full_name: fullName,
                            role: role
                        }
                    }
                });

                if (error) {
                    loginMessage.textContent = error.message;
                    loginMessage.classList.add("error-message");
                    return;
                }

                if (data.user) {
                    // Create explicit profile entry
                    await supabaseClient.from("profiles").upsert({
                        id: data.user.id,
                        full_name: fullName,
                        email: email,
                        role: role
                    });

                    loginMessage.textContent = "Account created successfully! Redirecting...";
                    loginMessage.classList.add("success-message");
                    setTimeout(() => { window.location.href = "index.html"; }, 1000);
                }
            } else {
                const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });

                if (error) {
                    loginMessage.textContent = error.message;
                    loginMessage.classList.add("error-message");
                    return;
                }

                const user = data.user;
                const profile = await fetchUserProfile(user);

                if (typeof createAuditLog === "function") {
                    await createAuditLog("LOGIN", "Auth", user.id, `User ${profile?.full_name || email} logged in.`);
                }

                loginMessage.textContent = "Login successful! Redirecting...";
                loginMessage.classList.add("success-message");
                setTimeout(() => { window.location.href = "index.html"; }, 800);
            }
        } catch (err) {
            console.error(err);
            loginMessage.textContent = "Authentication error occurred.";
            loginMessage.classList.add("error-message");
        }
    });
});
