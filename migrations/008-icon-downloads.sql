CREATE TABLE IF NOT EXISTS pixel_it_icon_downloads (
    day DATE NOT NULL,
    icon_id BIGINT UNSIGNED NOT NULL,
    request_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day, icon_id)
) ENGINE=InnoDB;
