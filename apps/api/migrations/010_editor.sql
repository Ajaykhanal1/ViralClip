CREATE TABLE clip_edits (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  draft_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  source_video_id BIGINT UNSIGNED NOT NULL,
  timeline_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_clip_edits_draft (draft_id),
  KEY idx_clip_edits_user (user_id, updated_at),
  CONSTRAINT fk_clip_edits_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_clip_edits_draft FOREIGN KEY (draft_id) REFERENCES shorts_drafts (id) ON DELETE CASCADE,
  CONSTRAINT fk_clip_edits_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_clip_edits_source FOREIGN KEY (source_video_id) REFERENCES source_videos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE edit_versions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  edit_id BIGINT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  label VARCHAR(120) NOT NULL,
  timeline_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_edit_versions (edit_id, version),
  CONSTRAINT fk_edit_versions_edit FOREIGN KEY (edit_id) REFERENCES clip_edits (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE editor_assets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  edit_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('video','audio','text','image') NOT NULL,
  label VARCHAR(200) NOT NULL,
  storage_key VARCHAR(255) NULL,
  rights_id BIGINT UNSIGNED NULL,
  config_json JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_editor_assets_edit (edit_id),
  CONSTRAINT fk_editor_assets_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_editor_assets_edit FOREIGN KEY (edit_id) REFERENCES clip_edits (id) ON DELETE CASCADE,
  CONSTRAINT fk_editor_assets_rights FOREIGN KEY (rights_id) REFERENCES content_rights (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
