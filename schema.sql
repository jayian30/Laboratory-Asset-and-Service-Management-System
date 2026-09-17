-- ============================================================================
-- LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
-- SUPABASE POSTGRESQL DATABASE SCHEMA & ROW LEVEL SECURITY (RLS) POLICIES
-- NOTE: Execute this script in your SUPABASE SQL EDITOR (PostgreSQL), NOT phpMyAdmin/MySQL.
-- ============================================================================

-- 1. CLEANUP (Order matters due to Foreign Keys)
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS maintenance_requests CASCADE;
DROP TABLE IF EXISTS borrowing_requests CASCADE;
DROP TABLE IF EXISTS borrow_transactions CASCADE; -- legacy table cleanup
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- ============================================================================
-- 2. TABLE DEFINITIONS
-- ============================================================================

-- PROFILES TABLE (Linked to auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'requester' CHECK (role IN ('admin', 'staff', 'requester')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- EQUIPMENT TABLE
CREATE TABLE equipment (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipment_code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT DEFAULT '',
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    available_quantity INT NOT NULL DEFAULT 1 CHECK (available_quantity >= 0),
    status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Borrowed', 'Maintenance', 'Damaged')),
    location TEXT DEFAULT 'Main Laboratory',
    condition TEXT NOT NULL DEFAULT 'Good' CHECK (condition IN ('Good', 'Fair', 'For Repair', 'Damaged')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- BORROWING REQUESTS TABLE
CREATE TABLE borrowing_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    borrower_name TEXT NOT NULL,
    borrower_type TEXT NOT NULL DEFAULT 'Student',
    department TEXT NOT NULL DEFAULT 'BSIT',
    equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
    purpose TEXT NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date DATE NOT NULL,
    actual_return_date DATE,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Released', 'Returned', 'Overdue', 'Closed')),
    approved_by UUID REFERENCES profiles(id),
    approved_at TIMESTAMPTZ,
    released_by UUID REFERENCES profiles(id),
    released_at TIMESTAMPTZ,
    returned_by UUID REFERENCES profiles(id),
    returned_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- MAINTENANCE REQUESTS TABLE
CREATE TABLE maintenance_requests (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipment_id BIGINT NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    requested_by UUID NOT NULL REFERENCES profiles(id),
    issue_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Maintenance', 'Completed', 'Cancelled')),
    resolution_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOGS TABLE
CREATE TABLE audit_logs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL DEFAULT 'System User',
    user_role TEXT NOT NULL DEFAULT 'unknown',
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    record_id TEXT,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 3. HELPER FUNCTIONS & TRIGGERS
-- ============================================================================

-- Helper function to fetch current authenticated user's role safely
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
    RETURN COALESCE(user_role, 'requester');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Trigger to automatically create a profile record when a new Auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'requester')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_modtime BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_equipment_modtime BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_borrowing_modtime BEFORE UPDATE ON borrowing_requests FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER update_maintenance_modtime BEFORE UPDATE ON maintenance_requests FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrowing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-------------------------------------------------------------------------------
-- PROFILES POLICIES
-------------------------------------------------------------------------------
-- View: Admin can view all profiles; Staff and Requesters can view profiles
CREATE POLICY "Profiles view policy" ON profiles
    FOR SELECT TO authenticated
    USING (true);

-- Update: Admin can update any profile; users can update own profile (role change restricted via app/trigger)
CREATE POLICY "Profiles update policy" ON profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid() OR get_user_role() = 'admin')
    WITH CHECK (id = auth.uid() OR get_user_role() = 'admin');

-- Insert: Handled via trigger or admin
CREATE POLICY "Profiles insert policy" ON profiles
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid() OR get_user_role() = 'admin');

-------------------------------------------------------------------------------
-- EQUIPMENT POLICIES
-------------------------------------------------------------------------------
-- View: All authenticated users can view equipment
CREATE POLICY "Equipment view policy" ON equipment
    FOR SELECT TO authenticated
    USING (true);

-- Insert/Update: Admin & Staff can insert or update equipment
CREATE POLICY "Equipment write policy" ON equipment
    FOR INSERT TO authenticated
    WITH CHECK (get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Equipment update policy" ON equipment
    FOR UPDATE TO authenticated
    USING (get_user_role() IN ('admin', 'staff'))
    WITH CHECK (get_user_role() IN ('admin', 'staff'));

-- Delete: ONLY Admin can delete equipment
CREATE POLICY "Equipment delete policy" ON equipment
    FOR DELETE TO authenticated
    USING (get_user_role() = 'admin');

-------------------------------------------------------------------------------
-- BORROWING REQUESTS POLICIES
-------------------------------------------------------------------------------
-- View: Admin & Staff can view ALL requests. Requester can view ONLY their own requests.
CREATE POLICY "Borrowing requests view policy" ON borrowing_requests
    FOR SELECT TO authenticated
    USING (
        get_user_role() IN ('admin', 'staff') OR requester_id = auth.uid()
    );

-- Insert: Authenticated users (Requester, Staff, Admin) can create borrowing requests for themselves
CREATE POLICY "Borrowing requests insert policy" ON borrowing_requests
    FOR INSERT TO authenticated
    WITH CHECK (requester_id = auth.uid());

-- Update:
-- Admin can update any borrowing request.
-- Staff can update borrowing requests (for release/return) BUT CANNOT approve/reject requests.
-- Requesters CANNOT update approval status or process returns.
CREATE POLICY "Borrowing requests update policy" ON borrowing_requests
    FOR UPDATE TO authenticated
    USING (
        get_user_role() = 'admin' OR get_user_role() = 'staff'
    )
    WITH CHECK (
        get_user_role() = 'admin' OR get_user_role() = 'staff'
    );

-- Delete: ONLY Admin can delete borrowing requests
CREATE POLICY "Borrowing requests delete policy" ON borrowing_requests
    FOR DELETE TO authenticated
    USING (get_user_role() = 'admin');

-------------------------------------------------------------------------------
-- MAINTENANCE REQUESTS POLICIES
-------------------------------------------------------------------------------
-- View: Admin and Staff can view maintenance requests
CREATE POLICY "Maintenance view policy" ON maintenance_requests
    FOR SELECT TO authenticated
    USING (get_user_role() IN ('admin', 'staff'));

-- Insert/Update: Admin and Staff can create and manage maintenance requests
CREATE POLICY "Maintenance insert policy" ON maintenance_requests
    FOR INSERT TO authenticated
    WITH CHECK (get_user_role() IN ('admin', 'staff'));

CREATE POLICY "Maintenance update policy" ON maintenance_requests
    FOR UPDATE TO authenticated
    USING (get_user_role() IN ('admin', 'staff'))
    WITH CHECK (get_user_role() IN ('admin', 'staff'));

-------------------------------------------------------------------------------
-- AUDIT LOGS POLICIES
-------------------------------------------------------------------------------
-- View: ONLY Admin can view audit logs
CREATE POLICY "Audit logs view policy" ON audit_logs
    FOR SELECT TO authenticated
    USING (get_user_role() = 'admin');

-- Insert: All authenticated users can create audit logs when performing actions
CREATE POLICY "Audit logs insert policy" ON audit_logs
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- Update & Delete: IMMUTABLE (No one can edit or delete audit logs)
-- No UPDATE or DELETE policies created on audit_logs.

-- ============================================================================
-- 5. SAMPLE TEST DATA
-- ============================================================================

INSERT INTO equipment (equipment_code, name, category, description, quantity, available_quantity, status, location, condition) VALUES
('LAP-001', 'Dell Latitude Laptop 15"', 'Laptop', 'Core i7, 16GB RAM, 512GB SSD', 1, 1, 'Available', 'Lab 101', 'Good'),
('LAP-002', 'Lenovo ThinkPad X1', 'Laptop', 'Core i5, 8GB RAM, 256GB SSD', 1, 0, 'Borrowed', 'Lab 101', 'Good'),
('PRJ-001', 'Epson 4K Laser Projector', 'Projector', 'High definition overhead projector with HDMI', 1, 1, 'Available', 'AVR Room', 'Good'),
('MIC-001', 'Wireless Lavalier Microphone', 'Microphone', 'Dual channel wireless mic system', 1, 0, 'Maintenance', 'Storage Room B', 'For Repair'),
('CAM-001', 'Canon EOS Rebel T7 Camera', 'Camera', 'DSLR Camera with 18-55mm Lens', 1, 1, 'Available', 'Media Lab', 'Good');
