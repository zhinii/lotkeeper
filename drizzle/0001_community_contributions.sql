CREATE TABLE `contributions` (
  `id` text PRIMARY KEY NOT NULL,
  `submission_type` text NOT NULL,
  `record_type` text NOT NULL,
  `item_name` text NOT NULL,
  `category` text NOT NULL,
  `description` text,
  `quantity` real,
  `quantity_unit` text,
  `latitude` real NOT NULL,
  `longitude` real NOT NULL,
  `gps_latitude` real NOT NULL,
  `gps_longitude` real NOT NULL,
  `gps_accuracy` real,
  `contact_name` text NOT NULL,
  `contact_method` text NOT NULL,
  `contact_value` text NOT NULL,
  `photo_key` text NOT NULL,
  `photo_content_type` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `submitted_at` integer NOT NULL,
  `moderated_at` integer,
  `moderated_by` text,
  `moderation_note` text
);
CREATE INDEX `idx_contributions_status_submitted` ON `contributions` (`status`,`submitted_at`);
CREATE INDEX `idx_contributions_type_status` ON `contributions` (`submission_type`,`status`);
CREATE TABLE `public_records` (
  `id` text PRIMARY KEY NOT NULL,
  `record_type` text NOT NULL,
  `name` text NOT NULL,
  `category` text NOT NULL,
  `description` text,
  `latitude` real NOT NULL,
  `longitude` real NOT NULL,
  `photo_key` text,
  `source_submission_id` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
CREATE INDEX `idx_public_records_type_status` ON `public_records` (`record_type`,`status`);
PRAGMA optimize;
