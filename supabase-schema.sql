-- Create users table with exact schema
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  gender text,
  country text,
  pfp text,
  is_reported boolean DEFAULT false,
  friends jsonb DEFAULT '[]'::jsonb,
  blocked_users jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Temporary RLS policy (lock down later)
CREATE POLICY "Allow all inserts" ON users FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all selects" ON users FOR SELECT USING (true);
CREATE POLICY "Allow all updates" ON users FOR UPDATE USING (true);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;