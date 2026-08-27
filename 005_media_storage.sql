CREATE TABLE IF NOT EXISTS media_uploads(
 id BIGSERIAL PRIMARY KEY,
 uploader_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 original_name VARCHAR(255) NOT NULL,
 mime_type VARCHAR(120) NOT NULL,
 size_bytes BIGINT NOT NULL CHECK(size_bytes >= 0),
 storage_key TEXT UNIQUE NOT NULL,
 created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE message_attachments
  ADD COLUMN IF NOT EXISTS upload_id BIGINT REFERENCES media_uploads(id) ON DELETE SET NULL;
