// ============================================================================
// SUPABASE CLIENT INITIALIZATION & HELPERS
// ============================================================================

const SUPABASE_URL = "https://opghvmrmszqgjrkmkwrr.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kR7V72BNOZvQqLhVOuJJ3w_tdG_7cY0";

let supabaseClient = null;

if (typeof window.supabase !== "undefined") {
    supabaseClient = window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );
} else {
    console.error("Supabase CDN library not loaded.");
}

function isSupabaseReady() {
    return typeof supabaseClient !== "undefined" && supabaseClient !== null && supabaseClient.auth;
}

// Utility function to escape HTML rendering in tables/UI
function escapeHTML(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
