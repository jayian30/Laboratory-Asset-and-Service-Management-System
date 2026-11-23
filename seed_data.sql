-- ============================================================================
-- LABTRACK · DATABASE UPGRADE + DEMO / TEST DATA
-- ----------------------------------------------------------------------------
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste this whole
-- file -> Run. Safe to run more than once (existing records are skipped).
--
-- It does NOT delete anything. It:
--   1. Upgrades the schema (Cancelled status, remarks column, requester cancel
--      policy, role-escalation guard).
--   2. Creates 12 ready-to-login test accounts (email already confirmed).
--   3. Adds 26 more equipment records.
--   4. Adds 34 borrowing requests across every status (dates are relative to
--      the day you run it, so Overdue / Due-soon always look realistic).
--   5. Adds maintenance tickets and matching audit-log history.
--   6. Re-syncs every equipment's available quantity with active loans.
--
-- TEST ACCOUNTS
--   Role        Email                        Password
--   Admin       admin@test.com               Admin@12345
--   Admin       admin2@test.com              Test@12345
--   Staff       staff@test.com               Staff@12345
--   Staff       staff2@test.com              Test@12345
--   Requester   requester@test.com           Request@12345
--   Requester   paolo.garcia@test.com        Test@12345
--   Requester   bea.villanueva@test.com      Test@12345
--   Requester   miguel.ramos@test.com        Test@12345
--   Requester   sofia.navarro@test.com       Test@12345
--   Requester   ramon.aquino@test.com        Test@12345  (Faculty)
--   Requester   kristine.lim@test.com        Test@12345  (Faculty)
--   Requester   leo.bautista@test.com        Test@12345  (no requests yet)
-- ============================================================================


-- ============================================================================
-- 1. SCHEMA UPGRADE
-- ============================================================================

-- Optional notes on a request (rejection reason, return remarks)
ALTER TABLE borrowing_requests ADD COLUMN IF NOT EXISTS remarks TEXT;

-- Allow the 'Cancelled' status for requests withdrawn by the requester
ALTER TABLE borrowing_requests DROP CONSTRAINT IF EXISTS borrowing_requests_status_check;
ALTER TABLE borrowing_requests ADD CONSTRAINT borrowing_requests_status_check
    CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Released', 'Returned', 'Overdue', 'Closed', 'Cancelled'));

-- Requesters may cancel ONLY their own requests, and ONLY while Pending
DROP POLICY IF EXISTS "Borrowing requests requester cancel policy" ON borrowing_requests;
CREATE POLICY "Borrowing requests requester cancel policy" ON borrowing_requests
    FOR UPDATE TO authenticated
    USING (requester_id = auth.uid() AND status = 'Pending')
    WITH CHECK (requester_id = auth.uid() AND status = 'Cancelled');

-- Security: only Administrators can change a user's role
-- (users could previously promote themselves by updating their own profile row)
CREATE OR REPLACE FUNCTION public.prevent_role_self_escalation()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role
       AND auth.uid() IS NOT NULL
       AND public.get_user_role() <> 'admin' THEN
        RAISE EXCEPTION 'Only administrators can change user roles';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS guard_profile_role_change ON profiles;
CREATE TRIGGER guard_profile_role_change
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_escalation();

-- Helpful indexes for dashboards
CREATE INDEX IF NOT EXISTS idx_borrowing_requests_status ON borrowing_requests (status);
CREATE INDEX IF NOT EXISTS idx_borrowing_requests_requester ON borrowing_requests (requester_id);
CREATE INDEX IF NOT EXISTS idx_borrowing_requests_equipment ON borrowing_requests (equipment_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_equipment ON maintenance_requests (equipment_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at DESC);


-- ============================================================================
-- 2. TEST ACCOUNTS (auth.users + auth.identities + profiles)
-- ============================================================================
DO $$
DECLARE
    u RECORD;
    v_id UUID;
BEGIN
    FOR u IN
        SELECT * FROM (VALUES
            ('admin@test.com',          'Admin@12345',   'Maria Santos',        'admin',     120),
            ('admin2@test.com',         'Test@12345',    'Engr. Roberto Lim',   'admin',     110),
            ('staff@test.com',          'Staff@12345',   'Juan Dela Cruz',      'staff',     118),
            ('staff2@test.com',         'Test@12345',    'Carlo Mendoza',       'staff',      95),
            ('requester@test.com',      'Request@12345', 'Ana Reyes',           'requester',  90),
            ('paolo.garcia@test.com',   'Test@12345',    'Paolo Garcia',        'requester',  80),
            ('bea.villanueva@test.com', 'Test@12345',    'Bea Villanueva',      'requester',  76),
            ('miguel.ramos@test.com',   'Test@12345',    'Miguel Ramos',        'requester',  70),
            ('sofia.navarro@test.com',  'Test@12345',    'Sofia Navarro',       'requester',  45),
            ('ramon.aquino@test.com',   'Test@12345',    'Prof. Ramon Aquino',  'requester', 100),
            ('kristine.lim@test.com',   'Test@12345',    'Prof. Kristine Lim',  'requester',  85),
            ('leo.bautista@test.com',   'Test@12345',    'Leo Bautista',        'requester',   3)
        ) AS t(email, pw, full_name, role, joined_days_ago)
    LOOP
        SELECT id INTO v_id FROM auth.users WHERE email = u.email;

        IF v_id IS NULL THEN
            v_id := gen_random_uuid();

            INSERT INTO auth.users (
                instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                confirmation_token, email_change, email_change_token_new, recovery_token
            ) VALUES (
                '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', u.email,
                extensions.crypt(u.pw, extensions.gen_salt('bf')), NOW(),
                '{"provider":"email","providers":["email"]}'::jsonb,
                jsonb_build_object('full_name', u.full_name, 'role', u.role),
                NOW() - make_interval(days => u.joined_days_ago), NOW(),
                '', '', '', ''
            );

            INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
            VALUES (
                gen_random_uuid(), v_id, v_id::text,
                jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true),
                'email', NOW(), NOW(), NOW()
            );
        ELSE
            -- Make sure older sign-ups can log in without email confirmation
            UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = v_id;
        END IF;

        INSERT INTO public.profiles (id, full_name, email, role, created_at)
        VALUES (v_id, u.full_name, u.email, u.role, NOW() - make_interval(days => u.joined_days_ago))
        ON CONFLICT (id) DO UPDATE
            SET full_name = EXCLUDED.full_name,
                role = EXCLUDED.role,
                created_at = LEAST(profiles.created_at, EXCLUDED.created_at);
    END LOOP;
END $$;


-- ============================================================================
-- 3. EQUIPMENT (existing asset codes are left untouched)
-- ============================================================================
INSERT INTO equipment (equipment_code, name, category, description, quantity, available_quantity, status, location, condition, created_at) VALUES
('LAP-003', 'Acer Aspire 5 Laptop',            'Laptop',          'Core i5-1235U, 8GB RAM, 512GB SSD, Windows 11',          10, 10, 'Available',   'Lab 101',        'Good', NOW() - INTERVAL '100 days'),
('LAP-004', 'HP ProBook 440 G9',               'Laptop',          'Core i7-1255U, 16GB RAM, 512GB SSD',                      8,  8, 'Available',   'Lab 102',        'Good', NOW() - INTERVAL '98 days'),
('LAP-005', 'Apple MacBook Air M2',            'Laptop',          '13.6", 8GB unified memory, 256GB SSD, for iOS dev',       3,  3, 'Available',   'Media Lab',      'Good', NOW() - INTERVAL '90 days'),
('LAP-006', 'ASUS VivoBook 15',                'Laptop',          'Ryzen 5 5500U, 8GB RAM, 512GB SSD',                       5,  5, 'Available',   'Lab 102',        'Fair', NOW() - INTERVAL '96 days'),
('TAB-001', 'Apple iPad 9th Gen',              'Tablet',          '10.2", 64GB Wi-Fi, with Apple Pencil',                    6,  6, 'Available',   'Media Lab',      'Good', NOW() - INTERVAL '88 days'),
('TAB-002', 'Samsung Galaxy Tab A8',           'Tablet',          '10.5", 64GB, Android 13',                                 4,  4, 'Available',   'Lab 101',        'Good', NOW() - INTERVAL '85 days'),
('PRJ-002', 'BenQ MW560 Projector',            'Projector',       '4000 lumens WXGA, HDMI/VGA, with carrying bag',           3,  3, 'Available',   'AVR Room',       'Good', NOW() - INTERVAL '92 days'),
('PRJ-003', 'ViewSonic M1 Portable Projector', 'Projector',       'Battery-powered mini LED projector, USB-C',               2,  2, 'Available',   'AVR Room',       'Good', NOW() - INTERVAL '60 days'),
('CAM-002', 'Sony ZV-E10 Vlog Camera',         'Camera',          'Mirrorless APS-C with 16-50mm lens and tripod',           2,  2, 'Available',   'Media Lab',      'Good', NOW() - INTERVAL '70 days'),
('CAM-003', 'Logitech C920 HD Webcam',         'Camera',          '1080p USB webcam with dual microphones',                  8,  8, 'Available',   'Lab 103',        'Good', NOW() - INTERVAL '99 days'),
('MIC-002', 'Rode NT-USB Mini Microphone',     'Microphone',      'USB studio condenser microphone with stand',              4,  4, 'Available',   'Media Lab',      'Good', NOW() - INTERVAL '75 days'),
('SPK-001', 'JBL Charge 5 Portable Speaker',   'Speaker',         'Bluetooth speaker, 20-hour battery',                      3,  3, 'Available',   'AVR Room',       'Good', NOW() - INTERVAL '65 days'),
('SPK-002', 'Portable PA System with Mic',     'Speaker',         '150W trolley speaker with 2 wireless microphones',        1,  1, 'Maintenance', 'Storage Room B', 'For Repair', NOW() - INTERVAL '110 days'),
('RTR-001', 'TP-Link Archer C6 Router',        'Router',          'AC1200 dual-band Wi-Fi router for networking labs',       5,  5, 'Available',   'Networking Lab', 'Good', NOW() - INTERVAL '97 days'),
('RTR-002', 'Cisco Catalyst 2960 Switch',      'Router',          '24-port managed switch, console cable included',          4,  4, 'Available',   'Networking Lab', 'Good', NOW() - INTERVAL '97 days'),
('RTR-003', 'Cisco ISR 4321 Router',           'Router',          'Integrated services router for CCNA routing labs',        2,  2, 'Available',   'Networking Lab', 'Good', NOW() - INTERVAL '97 days'),
('MCU-001', 'Arduino Uno Starter Kit',         'Microcontroller', 'Uno R3, breadboard, sensors, LEDs, jumper wires',        15, 15, 'Available',   'IoT Lab',        'Good', NOW() - INTERVAL '94 days'),
('MCU-002', 'Raspberry Pi 4 Kit',              'Microcontroller', '4GB RAM, 32GB microSD, case, power supply',              10, 10, 'Available',   'IoT Lab',        'Good', NOW() - INTERVAL '94 days'),
('MCU-003', 'ESP32 IoT Development Kit',       'Microcontroller', 'ESP32 DevKit V1 with sensor shield',                     12, 12, 'Available',   'IoT Lab',        'Good', NOW() - INTERVAL '80 days'),
('TLK-001', 'Computer Repair Toolkit',         'Toolkit',         '45-piece precision screwdriver and anti-static set',      6,  6, 'Available',   'Lab 103',        'Good', NOW() - INTERVAL '105 days'),
('TLK-002', 'RJ45 Crimping Tool Set',          'Toolkit',         'Crimper, stripper, RJ45 connectors (pack of 50)',        10, 10, 'Available',   'Networking Lab', 'Good', NOW() - INTERVAL '105 days'),
('OTH-001', 'Network Cable Tester',            'Other',           'RJ45/RJ11 LAN cable continuity tester',                   4,  4, 'Available',   'Networking Lab', 'Good', NOW() - INTERVAL '102 days'),
('OTH-002', 'HDMI to VGA Adapter',             'Other',           'HDMI male to VGA female with audio',                     12, 12, 'Available',   'AVR Room',       'Good', NOW() - INTERVAL '87 days'),
('OTH-003', 'Heavy-duty Extension Cord 5m',    'Other',           '4-gang outlet with surge protection',                     8,  8, 'Available',   'Storage Room B', 'Good', NOW() - INTERVAL '87 days'),
('OTH-004', 'Document Camera / Visualizer',    'Other',           '8MP USB document camera with LED light',                  1,  1, 'Damaged',     'AVR Room',       'Damaged', NOW() - INTERVAL '115 days'),
('OTH-005', 'Digital Multimeter',              'Other',           'Auto-ranging multimeter with test leads',                 6,  6, 'Available',   'IoT Lab',        'Good', NOW() - INTERVAL '78 days')
ON CONFLICT (equipment_code) DO NOTHING;

-- Original sample equipment from schema.sql (only inserted if missing)
INSERT INTO equipment (equipment_code, name, category, description, quantity, available_quantity, status, location, condition) VALUES
('LAP-001', 'Dell Latitude Laptop 15"',     'Laptop',     'Core i7, 16GB RAM, 512GB SSD',                  1, 1, 'Available',   'Lab 101',        'Good'),
('LAP-002', 'Lenovo ThinkPad X1',           'Laptop',     'Core i5, 8GB RAM, 256GB SSD',                   1, 1, 'Available',   'Lab 101',        'Good'),
('PRJ-001', 'Epson 4K Laser Projector',     'Projector',  'High definition overhead projector with HDMI',  1, 1, 'Available',   'AVR Room',       'Good'),
('MIC-001', 'Wireless Lavalier Microphone', 'Microphone', 'Dual channel wireless mic system',              1, 1, 'Maintenance', 'Storage Room B', 'For Repair'),
('CAM-001', 'Canon EOS Rebel T7 Camera',    'Camera',     'DSLR Camera with 18-55mm Lens',                 1, 1, 'Available',   'Media Lab',      'Good')
ON CONFLICT (equipment_code) DO NOTHING;


-- ============================================================================
-- 4-5. BORROWING REQUESTS, MAINTENANCE TICKETS, AUDIT HISTORY
--      (skipped automatically if the demo requests were already loaded)
-- ============================================================================
DO $$
DECLARE
    v_admin  UUID;
    v_admin2 UUID;
    v_staff  UUID;
    v_staff2 UUID;
    v_max_req BIGINT;
    v_max_maint BIGINT;
BEGIN
    IF EXISTS (
        SELECT 1 FROM borrowing_requests br
        JOIN profiles p ON p.id = br.requester_id
        WHERE p.email = 'ramon.aquino@test.com'
    ) THEN
        RAISE NOTICE 'Demo borrowing data already present - skipping requests, maintenance, and audit seed.';
        RETURN;
    END IF;

    SELECT id INTO v_admin  FROM profiles WHERE email = 'admin@test.com';
    SELECT id INTO v_admin2 FROM profiles WHERE email = 'admin2@test.com';
    SELECT id INTO v_staff  FROM profiles WHERE email = 'staff@test.com';
    SELECT id INTO v_staff2 FROM profiles WHERE email = 'staff2@test.com';

    SELECT COALESCE(MAX(id), 0) INTO v_max_req FROM borrowing_requests;
    SELECT COALESCE(MAX(id), 0) INTO v_max_maint FROM maintenance_requests;

    -- ---- Request specifications (offsets are days relative to today) ----
    DROP TABLE IF EXISTS seed_req;
    CREATE TEMP TABLE seed_req (
        ord INT, email TEXT, code TEXT, qty INT, btype TEXT, dept TEXT, purpose TEXT,
        req_off INT, due_off INT, status TEXT, ret_off INT, remarks TEXT
    );

    INSERT INTO seed_req VALUES
    -- Ana Reyes (requester@test.com): every status for the demo requester account
    ( 1, 'requester@test.com',      'LAP-003', 1, 'Student', 'BSIT 3-A', 'Capstone system development sprint',                 -2,   5, 'Pending',   NULL, NULL),
    ( 2, 'requester@test.com',      'PRJ-002', 1, 'Student', 'BSIT 3-A', 'Group report presentation in Room 302',              -1,   2, 'Approved',  NULL, NULL),
    ( 3, 'requester@test.com',      'MCU-001', 2, 'Student', 'BSIT 3-A', 'IoT laboratory activity: smart door lock prototype', -5,   2, 'Released',  NULL, NULL),
    ( 4, 'requester@test.com',      'CAM-003', 1, 'Student', 'BSIT 3-A', 'Recording thesis demo video',                        -10, -3, 'Overdue',   NULL, NULL),
    ( 5, 'requester@test.com',      'TAB-001', 1, 'Student', 'BSIT 3-A', 'UI/UX usability testing session',                    -25, -20, 'Returned', -20,  NULL),
    ( 6, 'requester@test.com',      'LAP-004', 1, 'Student', 'BSIT 3-A', 'Programming competition practice',                   -40, -35, 'Returned', -33,  'Returned 2 day(s) late'),
    ( 7, 'requester@test.com',      'RTR-001', 1, 'Student', 'BSIT 3-A', 'Networking lab configuration exercise',              -18, -15, 'Returned', -15,  NULL),
    ( 8, 'requester@test.com',      'CAM-002', 1, 'Student', 'BSIT 3-A', 'Personal vlog project',                              -12,  -9, 'Rejected', NULL, 'Equipment reserved for the Media Arts class schedule.'),
    ( 9, 'requester@test.com',      'SPK-001', 1, 'Student', 'BSIT 3-A', 'Org event sound check',                              -8,   -6, 'Cancelled', NULL, NULL),
    -- Paolo Garcia
    (10, 'paolo.garcia@test.com',   'LAP-003', 2, 'Student', 'BSCS 2-B', 'Data structures laboratory exam',                    0,    1, 'Pending',   NULL, NULL),
    (11, 'paolo.garcia@test.com',   'MCU-002', 1, 'Student', 'BSCS 2-B', 'Raspberry Pi cluster experiment',                    -6,   1, 'Released',  NULL, NULL),
    (12, 'paolo.garcia@test.com',   'RTR-002', 1, 'Student', 'BSCS 2-B', 'CCNA switching practice',                            -14, -11, 'Returned', -11,  NULL),
    (13, 'paolo.garcia@test.com',   'LAP-005', 1, 'Student', 'BSCS 2-B', 'iOS app build for mobile development class',         -3,  -1, 'Overdue',   NULL, NULL),
    -- Bea Villanueva
    (14, 'bea.villanueva@test.com', 'PRJ-001', 1, 'Student', 'BSIT 4-A', 'Capstone final defense',                             -1,   0, 'Approved',  NULL, NULL),
    (15, 'bea.villanueva@test.com', 'LAP-002', 1, 'Student', 'BSIT 4-A', 'Thesis documentation and formatting',                -4,   3, 'Released',  NULL, NULL),
    (16, 'bea.villanueva@test.com', 'MIC-002', 1, 'Student', 'BSIT 4-A', 'Podcast episode recording for Media Lab',            -20, -17, 'Returned', -17,  NULL),
    (17, 'bea.villanueva@test.com', 'TAB-002', 1, 'Student', 'BSIT 4-A', 'Field survey data collection',                       -30, -25, 'Returned', -26,  NULL),
    -- Miguel Ramos
    (18, 'miguel.ramos@test.com',   'CAM-002', 1, 'Student', 'BSEMC 3-A', 'Short film production for Digital Arts',            -3,   1, 'Released',  NULL, NULL),
    (19, 'miguel.ramos@test.com',   'SPK-001', 1, 'Student', 'BSEMC 3-A', 'Department general assembly',                       0,    2, 'Pending',   NULL, NULL),
    (20, 'miguel.ramos@test.com',   'OTH-005', 2, 'Student', 'BSEMC 3-A', 'Electronics circuit troubleshooting lab',           -22, -20, 'Returned', -19,  'Returned 1 day(s) late'),
    (21, 'miguel.ramos@test.com',   'LAP-006', 1, 'Student', 'BSEMC 3-A', 'Game engine rendering test',                        -9,  -7, 'Rejected',  NULL, 'Requested unit is assigned to the Game Development lab this week.'),
    -- Sofia Navarro
    (22, 'sofia.navarro@test.com',  'TAB-001', 2, 'Student', 'BSIS 1-A', 'Inventory system field demonstration',               -1,   4, 'Pending',   NULL, NULL),
    (23, 'sofia.navarro@test.com',  'OTH-002', 1, 'Student', 'BSIS 1-A', 'Classroom presentation adapter',                     -7,  -2, 'Overdue',   NULL, NULL),
    (24, 'sofia.navarro@test.com',  'LAP-004', 1, 'Student', 'BSIS 1-A', 'Online certification exam',                          -16, -15, 'Returned', -15,  NULL),
    -- Prof. Ramon Aquino (Faculty)
    (25, 'ramon.aquino@test.com',   'PRJ-003', 1, 'Faculty', 'IT Department', 'Off-campus seminar on cybersecurity awareness', -2,   3, 'Approved',  NULL, NULL),
    (26, 'ramon.aquino@test.com',   'LAP-003', 4, 'Faculty', 'IT Department', 'Hands-on workshop for senior high school visitors', -4, 1, 'Released', NULL, NULL),
    (27, 'ramon.aquino@test.com',   'TLK-001', 2, 'Faculty', 'IT Department', 'PC assembly laboratory class',                  -11,  -9, 'Returned', -9,   NULL),
    (28, 'ramon.aquino@test.com',   'RTR-003', 1, 'Faculty', 'IT Department', 'Routing protocols demonstration',               -26, -24, 'Returned', -24,  NULL),
    (29, 'ramon.aquino@test.com',   'CAM-001', 1, 'Faculty', 'IT Department', 'Faculty development program documentation',     -45, -42, 'Returned', -42,  NULL),
    -- Prof. Kristine Lim (Faculty)
    (30, 'kristine.lim@test.com',   'MCU-003', 5, 'Faculty', 'Computer Science Department', 'Embedded systems class activity',  -2,   5, 'Released', NULL, NULL),
    (31, 'kristine.lim@test.com',   'LAP-004', 3, 'Faculty', 'Computer Science Department', 'Research data analysis',           0,    7, 'Pending',  NULL, NULL),
    (32, 'kristine.lim@test.com',   'OTH-001', 2, 'Faculty', 'Computer Science Department', 'Structured cabling practical exam', -13, -12, 'Returned', -12, NULL),
    (33, 'kristine.lim@test.com',   'TLK-002', 4, 'Faculty', 'Computer Science Department', 'Cable crimping practical exam',    -1,   1, 'Approved', NULL, NULL),
    (34, 'kristine.lim@test.com',   'LAP-005', 1, 'Faculty', 'Computer Science Department', 'Conference paper writing',         -35, -28, 'Returned', -27, 'Returned 1 day(s) late');

    -- ---- Insert requests with consistent timestamps and handlers ----
    INSERT INTO borrowing_requests (
        requester_id, borrower_name, borrower_type, department, equipment_id, quantity, purpose,
        request_date, expected_return_date, actual_return_date, status,
        approved_by, approved_at, released_by, released_at, returned_by, returned_at, remarks, created_at
    )
    SELECT
        p.id, p.full_name, s.btype, s.dept, e.id, s.qty, s.purpose,
        CURRENT_DATE + s.req_off,
        CURRENT_DATE + s.due_off,
        CASE WHEN s.status = 'Returned' THEN CURRENT_DATE + s.ret_off END,
        s.status,
        CASE WHEN s.status IN ('Approved', 'Rejected', 'Released', 'Returned', 'Overdue')
             THEN CASE WHEN s.ord % 3 = 0 THEN v_admin2 ELSE v_admin END END,
        CASE WHEN s.status IN ('Approved', 'Rejected', 'Released', 'Returned', 'Overdue')
             THEN LEAST(NOW() - INTERVAL '5 minutes', t.created + INTERVAL '3 hours') END,
        CASE WHEN s.status IN ('Released', 'Returned', 'Overdue')
             THEN CASE WHEN s.ord % 2 = 0 THEN v_staff2 ELSE v_staff END END,
        CASE WHEN s.status IN ('Released', 'Returned', 'Overdue')
             THEN LEAST(NOW() - INTERVAL '2 minutes', t.created + INTERVAL '20 hours') END,
        CASE WHEN s.status = 'Returned' THEN CASE WHEN s.ord % 2 = 0 THEN v_staff ELSE v_staff2 END END,
        CASE WHEN s.status = 'Returned'
             THEN LEAST(NOW() - INTERVAL '1 minute', (CURRENT_DATE + s.ret_off) + TIME '14:00' + (s.ord * INTERVAL '7 minutes')) END,
        s.remarks,
        t.created
    FROM seed_req s
    JOIN profiles p ON p.email = s.email
    JOIN equipment e ON e.equipment_code = s.code
    CROSS JOIN LATERAL (
        SELECT LEAST(NOW() - INTERVAL '10 minutes',
                     (CURRENT_DATE + s.req_off) + TIME '08:00' + ((s.ord * 37) % 420) * INTERVAL '1 minute') AS created
    ) t
    ORDER BY s.req_off, s.ord;

    -- ---- Maintenance tickets ----
    INSERT INTO maintenance_requests (equipment_id, requested_by, issue_description, status, resolution_notes, created_at, updated_at)
    SELECT e.id, CASE WHEN m.by_staff2 THEN v_staff2 ELSE v_staff END, m.issue, m.status, m.notes,
           NOW() - make_interval(days => m.created_days_ago, hours => 3),
           NOW() - make_interval(days => m.updated_days_ago, hours => 1)
    FROM (VALUES
        ('MIC-001', 'Receiver produces static noise and intermittent signal dropouts',     'In Maintenance', '',                                                       6,  4, false),
        ('SPK-002', 'Amplifier does not power on; suspected blown fuse',                    'Pending',        '',                                                       2,  2, true),
        ('OTH-004', 'Camera arm hinge broken and lens cracked after being dropped',         'Pending',        '',                                                       1,  1, false),
        ('LAP-006', 'Several keyboard keys unresponsive on unit #3',                        'Completed',      'Replaced keyboard module and tested all keys.',          20, 17, true),
        ('PRJ-001', 'Projector lamp flickering during presentations',                       'Completed',      'Replaced projector lamp; brightness back to normal.',    33, 30, false),
        ('RTR-001', 'No internet connection on LAN port 2',                                 'Cancelled',      'Issue was a faulty patch cable, not the router.',        15, 15, true),
        ('CAM-003', 'USB cable frayed near connector on one webcam',                        'Completed',      'Replaced USB cable and secured with strain relief.',     50, 48, false)
    ) AS m(code, issue, status, notes, created_days_ago, updated_days_ago, by_staff2)
    JOIN equipment e ON e.equipment_code = m.code;

    -- ---- Audit history matching the seeded records ----
    -- Equipment registration
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT v_admin, 'Maria Santos', 'admin', 'CREATED', 'Equipment', e.id::text,
           'Created new equipment ' || e.name || ' (' || e.equipment_code || ')', e.created_at
    FROM equipment e
    WHERE e.equipment_code IN (SELECT code FROM seed_req) OR e.equipment_code IN ('SPK-002','OTH-003','OTH-004','RTR-003');

    -- Request submitted
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT br.requester_id, br.borrower_name, 'requester', 'CREATED', 'Borrowing', br.id::text,
           'Submitted borrowing request for ' || br.quantity || ' x ' || e.name || ' (' || e.equipment_code || ')', br.created_at
    FROM borrowing_requests br JOIN equipment e ON e.id = br.equipment_id
    WHERE br.id > v_max_req;

    -- Approved / Rejected
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT br.approved_by, a.full_name, 'admin',
           CASE WHEN br.status = 'Rejected' THEN 'REJECTED' ELSE 'APPROVED' END, 'Borrowing', br.id::text,
           CASE WHEN br.status = 'Rejected'
                THEN 'Rejected borrowing request of ' || br.borrower_name || ' for ' || e.name || '. Reason: ' || COALESCE(br.remarks, '-')
                ELSE 'Approved borrowing request of ' || br.borrower_name || ' for ' || e.name END,
           br.approved_at
    FROM borrowing_requests br
    JOIN equipment e ON e.id = br.equipment_id
    JOIN profiles a ON a.id = br.approved_by
    WHERE br.id > v_max_req AND br.approved_at IS NOT NULL;

    -- Released
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT br.released_by, s.full_name, 'staff', 'RELEASED', 'Borrowing', br.id::text,
           'Released ' || br.quantity || ' x ' || e.name || ' to ' || br.borrower_name, br.released_at
    FROM borrowing_requests br
    JOIN equipment e ON e.id = br.equipment_id
    JOIN profiles s ON s.id = br.released_by
    WHERE br.id > v_max_req AND br.released_at IS NOT NULL;

    -- Returned
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT br.returned_by, s.full_name, 'staff', 'RETURNED', 'Borrowing', br.id::text,
           'Processed return of ' || e.name || ' from ' || br.borrower_name || '. Condition: Good'
               || CASE WHEN br.actual_return_date > br.expected_return_date
                       THEN '. ' || (br.actual_return_date - br.expected_return_date) || ' day(s) late' ELSE '' END,
           br.returned_at
    FROM borrowing_requests br
    JOIN equipment e ON e.id = br.equipment_id
    JOIN profiles s ON s.id = br.returned_by
    WHERE br.id > v_max_req AND br.returned_at IS NOT NULL;

    -- Cancelled by requester
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT br.requester_id, br.borrower_name, 'requester', 'CANCELLED', 'Borrowing', br.id::text,
           'Requester cancelled borrowing request for ' || e.name, br.created_at + INTERVAL '2 hours'
    FROM borrowing_requests br JOIN equipment e ON e.id = br.equipment_id
    WHERE br.id > v_max_req AND br.status = 'Cancelled';

    -- Maintenance
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT m.requested_by, p.full_name, 'staff', 'MAINTENANCE_REQUESTED', 'Maintenance', m.id::text,
           'Reported issue on ' || e.name || ': ' || m.issue_description, m.created_at
    FROM maintenance_requests m
    JOIN equipment e ON e.id = m.equipment_id
    JOIN profiles p ON p.id = m.requested_by
    WHERE m.id > v_max_maint;

    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT m.requested_by, p.full_name, 'staff', 'MAINTENANCE_UPDATED', 'Maintenance', m.id::text,
           'Updated maintenance #' || m.id || ' (' || e.name || ') to ' || m.status, m.updated_at
    FROM maintenance_requests m
    JOIN equipment e ON e.id = m.equipment_id
    JOIN profiles p ON p.id = m.requested_by
    WHERE m.id > v_max_maint AND m.status <> 'Pending';

    -- A few sign-ins so the Auth filter has data
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT p.id, p.full_name, p.role, 'LOGIN', 'Auth', p.id::text, 'User ' || p.full_name || ' logged in.',
           NOW() - make_interval(hours => x.h)
    FROM profiles p
    JOIN (VALUES ('admin@test.com', 2), ('staff@test.com', 3), ('staff2@test.com', 26), ('requester@test.com', 5),
                 ('ramon.aquino@test.com', 30), ('kristine.lim@test.com', 50)) AS x(email, h)
      ON x.email = p.email;

    -- Role assignment history
    INSERT INTO audit_logs (user_id, user_name, user_role, action, module, record_id, description, created_at)
    SELECT v_admin, 'Maria Santos', 'admin', 'UPDATED', 'Users', p.id::text,
           'Changed role of ' || p.full_name || ' (' || p.email || ') from requester to ' || p.role, p.created_at + INTERVAL '1 hour'
    FROM profiles p WHERE p.email IN ('staff2@test.com', 'admin2@test.com');

    DROP TABLE seed_req;
    RAISE NOTICE 'Demo requests, maintenance tickets, and audit history created.';
END $$;


-- ============================================================================
-- 6. RE-SYNC EQUIPMENT STOCK WITH ACTIVE LOANS (safe to run any time)
--    available = quantity - units currently Released/Overdue
-- ============================================================================
UPDATE equipment e
SET available_quantity = GREATEST(0, e.quantity - x.out_qty),
    status = CASE
        WHEN e.status IN ('Maintenance', 'Damaged') THEN e.status
        WHEN e.quantity - x.out_qty <= 0 THEN 'Borrowed'
        ELSE 'Available'
    END
FROM (
    SELECT eq.id,
           COALESCE(SUM(br.quantity) FILTER (WHERE br.status IN ('Released', 'Overdue')), 0) AS out_qty
    FROM equipment eq
    LEFT JOIN borrowing_requests br ON br.equipment_id = eq.id
    GROUP BY eq.id
) x
WHERE x.id = e.id;


-- ============================================================================
-- QUICK CHECK (results appear below after running)
-- ============================================================================
SELECT 'profiles' AS table_name, COUNT(*) AS rows FROM profiles
UNION ALL SELECT 'equipment', COUNT(*) FROM equipment
UNION ALL SELECT 'borrowing_requests', COUNT(*) FROM borrowing_requests
UNION ALL SELECT 'maintenance_requests', COUNT(*) FROM maintenance_requests
UNION ALL SELECT 'audit_logs', COUNT(*) FROM audit_logs;
