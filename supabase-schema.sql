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

-- Friend requests table
CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  to_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz DEFAULT now()
);

-- Friends table
CREATE TABLE friends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  friend_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, friend_id)
);

-- Blocked users table
CREATE TABLE blocked_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, blocked_user_id)
);

-- RLS policies for new tables
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations" ON friend_requests FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON friends FOR ALL USING (true);
CREATE POLICY "Allow all operations" ON blocked_users FOR ALL USING (true);