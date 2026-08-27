CREATE TABLE IF NOT EXISTS users(
 id BIGSERIAL PRIMARY KEY, username VARCHAR(32) UNIQUE NOT NULL,
 display_name VARCHAR(80) NOT NULL, email VARCHAR(320) UNIQUE,
 password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token_hash TEXT UNIQUE NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversations(
 id BIGSERIAL PRIMARY KEY, kind VARCHAR(12) NOT NULL CHECK(kind IN('direct','group')),
 title VARCHAR(100), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS conversation_members(
 conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL DEFAULT 'member', last_read_message_id BIGINT DEFAULT 0,
 PRIMARY KEY(conversation_id,user_id)
);
CREATE TABLE IF NOT EXISTS messages(
 id BIGSERIAL PRIMARY KEY, conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
 sender_id BIGINT REFERENCES users(id) ON DELETE RESTRICT, body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), edited_at TIMESTAMPTZ, deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages(conversation_id,id);
CREATE TABLE IF NOT EXISTS blocks(
 blocker_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 blocked_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(blocker_id,blocked_id)
);
CREATE TABLE IF NOT EXISTS reports(
 id BIGSERIAL PRIMARY KEY, reporter_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 reported_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
 conversation_id BIGINT REFERENCES conversations(id) ON DELETE SET NULL,
 reason VARCHAR(500) NOT NULL, status VARCHAR(16) DEFAULT 'open', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
