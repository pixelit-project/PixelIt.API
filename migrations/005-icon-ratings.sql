CREATE TABLE IF NOT EXISTS pixel_it_icon_ratings (
    icon_id BIGINT UNSIGNED NOT NULL,
    voter_uuid BINARY(20) NOT NULL,
    stars TINYINT UNSIGNED NOT NULL,
    PRIMARY KEY (icon_id, voter_uuid),
    CHECK (stars BETWEEN 1 AND 5)
) ENGINE=InnoDB;
