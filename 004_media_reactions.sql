CREATE TABLE IF NOT EXISTS message_attachments(
 id BIGSERIAL PRIMARY KEY,
 message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
 kind VARCHAR(16) NOT NULL CHECK(kind IN('image','file','audio')),
 original_name VARCHAR(255) NOT NULL,
 mime_type VARCHAR(120) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0),
 storage_key TEXT NOT NULL,
 created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS message_attachments_message_idx ON message_attachments(message_id);

CREATE TABLE IF NOT EXISTS message_reactions(
 message_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 emoji VARCHAR(32) NOT NULL,
 created_at TIMESTAMPTZ DEFAULT now(),
 PRIMARY KEY(message_id,user_id,emoji)
);
CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON message_reactions(message_id);

CREATE TABLE IF NOT EXISTS message_replies(
 message_id BIGINT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
 replied_to_message_id BIGINT REFERENCES messages(id) ON DELETE SET NULL
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;
