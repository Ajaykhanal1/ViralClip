ALTER TABLE source_videos
  MODIFY COLUMN status ENUM(
    'pending',
    'awaiting_authorized_source',
    'queued',
    'processing',
    'ready',
    'failed',
    'cancelled'
  ) NOT NULL DEFAULT 'pending';

CREATE TABLE processing_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  project_id BIGINT UNSIGNED NOT NULL,
  source_video_id BIGINT UNSIGNED NOT NULL,
  queue_name VARCHAR(64) NOT NULL,
  job_type VARCHAR(64) NOT NULL,
  bullmq_job_id VARCHAR(191) NULL,
  status ENUM('queued', 'processing', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
  progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
  attempt INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
  cancel_requested TINYINT(1) NOT NULL DEFAULT 0,
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  payload_json JSON NULL,
  result_json JSON NULL,
  started_at TIMESTAMP NULL DEFAULT NULL,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_processing_jobs_bullmq (queue_name, bullmq_job_id),
  KEY idx_processing_jobs_user_created (user_id, created_at),
  KEY idx_processing_jobs_project_created (project_id, created_at),
  KEY idx_processing_jobs_source_status (source_video_id, status, created_at),
  KEY idx_processing_jobs_status_queue (status, queue_name, created_at),
  CONSTRAINT fk_processing_jobs_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_processing_jobs_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_processing_jobs_source FOREIGN KEY (source_video_id) REFERENCES source_videos (id) ON DELETE CASCADE,
  CONSTRAINT chk_processing_jobs_progress CHECK (progress <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE processing_job_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  level ENUM('debug', 'info', 'warn', 'error') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  details_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_processing_job_logs_job_created (job_id, created_at),
  CONSTRAINT fk_processing_job_logs_job FOREIGN KEY (job_id) REFERENCES processing_jobs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE processing_artifacts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id BIGINT UNSIGNED NOT NULL,
  source_video_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(64) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  mime_type VARCHAR(100) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_processing_artifacts_storage_key (storage_key),
  KEY idx_processing_artifacts_job (job_id),
  KEY idx_processing_artifacts_source_kind (source_video_id, kind),
  CONSTRAINT fk_processing_artifacts_job FOREIGN KEY (job_id) REFERENCES processing_jobs (id) ON DELETE CASCADE,
  CONSTRAINT fk_processing_artifacts_source FOREIGN KEY (source_video_id) REFERENCES source_videos (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
