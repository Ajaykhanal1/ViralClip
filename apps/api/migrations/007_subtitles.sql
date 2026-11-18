ALTER TABLE processing_artifacts
  MODIFY COLUMN kind VARCHAR(64) NOT NULL;

CREATE TABLE transcripts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  source_video_id BIGINT UNSIGNED NOT NULL,
  processing_job_id BIGINT UNSIGNED NULL,
  language VARCHAR(32) NULL,
  detected_language VARCHAR(32) NULL,
  model VARCHAR(64) NULL,
  duration_seconds DECIMAL(10,3) NULL,
  status ENUM('processing', 'completed', 'failed') NOT NULL DEFAULT 'completed',
  is_original TINYINT(1) NOT NULL DEFAULT 1,
  original_payload_json JSON NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transcripts_source_created (source_video_id, created_at),
  KEY idx_transcripts_user_created (user_id, created_at),
  CONSTRAINT fk_transcripts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_transcripts_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_transcripts_source FOREIGN KEY (source_video_id) REFERENCES source_videos (id) ON DELETE CASCADE,
  CONSTRAINT fk_transcripts_job FOREIGN KEY (processing_job_id) REFERENCES processing_jobs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE transcript_segments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transcript_id BIGINT UNSIGNED NOT NULL,
  segment_index INT UNSIGNED NOT NULL,
  start_ms INT UNSIGNED NOT NULL,
  end_ms INT UNSIGNED NOT NULL,
  text TEXT NOT NULL,
  speaker VARCHAR(64) NULL,
  words_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_transcript_segments_transcript (transcript_id, segment_index),
  CONSTRAINT fk_transcript_segments_transcript FOREIGN KEY (transcript_id) REFERENCES transcripts (id) ON DELETE CASCADE,
  CONSTRAINT chk_transcript_segments_time CHECK (end_ms >= start_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subtitle_tracks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  source_video_id BIGINT UNSIGNED NOT NULL,
  transcript_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  language VARCHAR(32) NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  style_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subtitle_tracks_source (source_video_id, created_at),
  KEY idx_subtitle_tracks_user (user_id, created_at),
  CONSTRAINT fk_subtitle_tracks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_subtitle_tracks_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_subtitle_tracks_source FOREIGN KEY (source_video_id) REFERENCES source_videos (id) ON DELETE CASCADE,
  CONSTRAINT fk_subtitle_tracks_transcript FOREIGN KEY (transcript_id) REFERENCES transcripts (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subtitle_segments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  track_id BIGINT UNSIGNED NOT NULL,
  segment_index INT UNSIGNED NOT NULL,
  start_ms INT UNSIGNED NOT NULL,
  end_ms INT UNSIGNED NOT NULL,
  text TEXT NOT NULL,
  speaker VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subtitle_segments_track (track_id, segment_index),
  CONSTRAINT fk_subtitle_segments_track FOREIGN KEY (track_id) REFERENCES subtitle_tracks (id) ON DELETE CASCADE,
  CONSTRAINT chk_subtitle_segments_time CHECK (end_ms >= start_ms)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
