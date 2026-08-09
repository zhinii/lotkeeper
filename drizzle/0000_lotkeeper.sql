CREATE TABLE `locations` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `name` text NOT NULL, `code` text NOT NULL, `description` text, `map_x` integer DEFAULT 50 NOT NULL, `map_y` integer DEFAULT 50 NOT NULL);
CREATE UNIQUE INDEX `idx_locations_code` ON `locations` (`code`);
CREATE TABLE `inventory_items` (`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL, `sku` text NOT NULL, `name` text NOT NULL, `category` text NOT NULL, `description` text, `status` text DEFAULT 'available' NOT NULL, `price_label` text, `location_id` integer, `public_visible` integer DEFAULT true NOT NULL, `created_by` text, `created_at` integer NOT NULL, `updated_at` integer NOT NULL, FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`));
CREATE UNIQUE INDEX `idx_inventory_items_sku` ON `inventory_items` (`sku`);
CREATE INDEX `idx_inventory_items_public_category` ON `inventory_items` (`public_visible`,`category`);
CREATE TABLE `staff_profiles` (`user_id` text PRIMARY KEY NOT NULL, `email` text NOT NULL, `display_name` text NOT NULL, `role` text DEFAULT 'staff' NOT NULL, `created_at` integer NOT NULL);
CREATE UNIQUE INDEX `idx_staff_profiles_email` ON `staff_profiles` (`email`);
PRAGMA optimize;
