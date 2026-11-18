ALTER TABLE projects
  CHANGE COLUMN title name VARCHAR(200) NOT NULL,
  ADD COLUMN description TEXT NULL AFTER name;

CREATE TABLE project_activities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  project_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(64) NOT NULL,
  message VARCHAR(255) NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_project_activities_project_created (project_id, created_at),
  KEY idx_project_activities_user_created (user_id, created_at),
  CONSTRAINT fk_project_activities_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT fk_project_activities_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
