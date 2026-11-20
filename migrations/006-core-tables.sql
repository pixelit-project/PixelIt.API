-- Bootstrap empty installations while preserving existing tables and data.
CREATE TABLE IF NOT EXISTS pixel_it_user (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    aktiv BOOLEAN NOT NULL DEFAULT TRUE,
    INDEX active_user_name (name, aktiv)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pixel_it_bitmap (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    datetime DATETIME NOT NULL,
    name VARCHAR(255) NOT NULL,
    rgb565array LONGTEXT NOT NULL,
    sizex SMALLINT UNSIGNED NOT NULL,
    sizey SMALLINT UNSIGNED NOT NULL,
    userid BIGINT UNSIGNED NOT NULL,
    animated BOOLEAN NOT NULL DEFAULT FALSE,
    INDEX bitmap_user (userid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pixel_it_hitcount (
    pixel_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    hitcount BIGINT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pixel_it_telemetry (
    uuid CHAR(40) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL PRIMARY KEY,
    version VARCHAR(255) NOT NULL,
    build_section VARCHAR(255) NOT NULL DEFAULT '',
    type VARCHAR(255) NOT NULL,
    matrix JSON NOT NULL,
    sensors JSON NOT NULL,
    geoip JSON,
    last_change DATETIME NOT NULL,
    INDEX telemetry_last_change (last_change)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
