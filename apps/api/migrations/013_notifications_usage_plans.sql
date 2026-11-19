CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity ENUM('info','success','warning','error') NOT NULL DEFAULT 'info',
  data_json JSON NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notifications_user_read (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE usage_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  metric VARCHAR(64) NOT NULL,
  amount DECIMAL(20,4) NOT NULL,
  idempotency_key VARCHAR(255) NOT NULL,
  metadata_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usage_records_idempotency (user_id, idempotency_key),
  KEY idx_usage_records_metric (user_id, metric, created_at),
  CONSTRAINT fk_usage_records_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE subscription_plans (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(128) NOT NULL,
  description TEXT NULL,
  price_monthly_cents INT UNSIGNED NOT NULL DEFAULT 0,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  limits_json JSON NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subscription_plans_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE user_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  status ENUM('active','cancelled','expired') NOT NULL DEFAULT 'active',
  email_notifications TINYINT(1) NOT NULL DEFAULT 0,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_subscriptions_user (user_id),
  CONSTRAINT fk_user_subscriptions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_user_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO subscription_plans (code, name, description, price_monthly_cents, currency, limits_json, is_active, sort_order)
VALUES
  ('free', 'Free', 'Get started with essential clipping and publishing.', 0, 'USD',
   JSON_OBJECT('uploadedVideos', 10, 'uploadedStorageBytes', 2147483648, 'processingMinutes', 60, 'generatedClips', 50, 'renderedVideos', 10, 'aiUsage', 50, 'youtubeUploads', 5), 1, 1),
  ('pro', 'Pro', 'Higher limits for regular creators.', 1900, 'USD',
   JSON_OBJECT('uploadedVideos', 100, 'uploadedStorageBytes', 21474836480, 'processingMinutes', 600, 'generatedClips', 500, 'renderedVideos', 100, 'aiUsage', 500, 'youtubeUploads', 50), 1, 2),
  ('business', 'Business', 'Unlimited usage for teams. Paid activation requires verified payment setup.', 9900, 'USD',
   JSON_OBJECT('uploadedVideos', NULL, 'uploadedStorageBytes', NULL, 'processingMinutes', NULL, 'generatedClips', NULL, 'renderedVideos', NULL, 'aiUsage', NULL, 'youtubeUploads', NULL), 1, 3)
ON DUPLICATE KEY UPDATE
  name = VALUES(name), description = VALUES(description), price_monthly_cents = VALUES(price_monthly_cents),
  limits_json = VALUES(limits_json), is_active = VALUES(is_active), sort_order = VALUES(sort_order);
