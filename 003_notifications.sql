CREATE TABLE IF NOT EXISTS notifications(
 id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 type VARCHAR(32) NOT NULL, title VARCHAR(160) NOT NULL, body VARCHAR(500) NOT NULL,
 conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
 message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
 read_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,id DESC);
CREATE TABLE IF NOT EXISTS notification_preferences(
 user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 direct_messages BOOLEAN DEFAULT true, group_messages BOOLEAN DEFAULT true,
 mentions BOOLEAN DEFAULT true, sounds BOOLEAN DEFAULT true
);
CREATE TABLE IF NOT EXISTS conversation_reads(
 conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 last_read_message_id BIGINT DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT now(),
 PRIMARY KEY(conversation_id,user_id)
);
