-- Applied automatically at startup. Existing bitmap tables are unchanged.
CREATE TABLE IF NOT EXISTS pixel_it_reports (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 icon_id BIGINT UNSIGNED NOT NULL,
 reason VARCHAR(1000) NOT NULL,
 status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TIMESTAMP NULL,
 INDEX icon_status (icon_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS pixel_it_moderation_audit (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 report_id BIGINT UNSIGNED NOT NULL,
 action ENUM('approve','reject','restore') NOT NULL,
 actor VARCHAR(64) NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX report_events (report_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
