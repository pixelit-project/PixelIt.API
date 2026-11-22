ALTER TABLE pixel_it_reports
 MODIFY status ENUM('pending','approved','rejected','blocked') NOT NULL DEFAULT 'pending';
ALTER TABLE pixel_it_moderation_audit
 MODIFY action ENUM('approve','reject','restore','block','unblock') NOT NULL;
