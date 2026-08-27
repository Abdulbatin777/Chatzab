CREATE TABLE IF NOT EXISTS conversation_settings(
 conversation_id BIGINT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 photo_key TEXT, description VARCHAR(500) DEFAULT '', invite_code VARCHAR(32) UNIQUE,
 slow_mode_seconds INT NOT NULL DEFAULT 0 CHECK(slow_mode_seconds BETWEEN 0 AND 3600)
);

CREATE TABLE IF NOT EXISTS group_roles(
 conversation_id BIGINT REFERENCES conversations(id) ON DELETE CASCADE,
 user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
 role VARCHAR(16) NOT NULL CHECK(role IN('owner','admin','member')),
 PRIMARY KEY(conversation_id,user_id)
);

CREATE TABLE IF NOT EXISTS community_invites(
 id BIGSERIAL PRIMARY KEY,
 community_id BIGINT REFERENCES communities(id) ON DELETE CASCADE,
 created_by BIGINT REFERENCES users(id) ON DELETE CASCADE,
 code VARCHAR(32) UNIQUE NOT NULL,
 expires_at TIMESTAMPTZ,
 max_uses INT DEFAULT 0 CHECK(max_uses >= 0),
 uses INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS community_members_user_idx ON community_members(user_id);
CREATE INDEX IF NOT EXISTS channels_community_idx ON channels(community_id);
