CREATE TABLE IF NOT EXISTS pixel_it_icon_rating_submissions (
    day DATE NOT NULL,
    submission_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day)
) ENGINE=InnoDB;
