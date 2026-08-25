CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  test_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, usage_date),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
