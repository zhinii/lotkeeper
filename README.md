# Material Pin

Material Pin is an installable, mobile-first visual material and inventory finder. It combines item photos, map pins, searchable descriptions, SKU data, quantities, named locations and accountable updates in one system.

Live site: <https://zhinii.github.io/lotkeeper/>

## Three access layers

- **Public:** choose an organization, view its public items, search by text or photo, filter like a product catalog, and see matching pins on the map. Public visitors cannot change records.
- **Employee:** sign in to add a photo and pin, update an existing item, record inventory use, and mark the item public or employee-only. Mobile capture requires a valid live GPS fix before and after the camera opens. Desktop upload reads GPS and capture dates from the original image files, with manual map placement available when a file has no coordinates.
- **Administrator:** create and assign employee logins, review submissions, edit every standard field, change quantities and coordinates, archive items, import inventory CSV files, map generic inventory pins, configure organizations, and review search activity. Organization owners and platform administrators can also permanently delete a deployment from its settings.

Every captured item supports a name, description, quantity, unit, SKU or asset ID, named location, category, GPS coordinates, visibility, timestamps and the account that updated it. Additional organization-specific fields remain configurable.

## Photo and GPS policy

Material Pin intentionally uses different capture controls on mobile and desktop:

- **Mobile phones and tablets:** there is no image-file input. Employees must first allow precise browser location, then use Material Pin's live camera preview. The camera remains disabled until a GPS fix accurate to 100 meters or better is available, and location is checked again when the shutter is pressed. The stored location source is `Live phone GPS`.
- **Desktop and laptop computers:** employees may select one or many original image files. Material Pin reads each file's EXIF capture date and GPS coordinates and presents a crop, AI review and submission screen for each photo in sequence. Files without accessible GPS require manual map placement.

Android can redact GPS metadata when a file is selected through its system photo picker. The mobile workflow therefore does not depend on image EXIF. Desktop photo dumps should use the original files copied from the camera or phone rather than screenshots, edited exports or messaging-app copies that may have stripped metadata.

## Search design

Text search matches names, descriptions, categories, keywords, SKUs, manufacturers and named locations. Filters narrow by item group, category, availability and location while the map remains visible.

Optional photo search sends a compressed preview to the server-side OpenAI vision workflow. The API returns visible descriptors, readable product/SKU clues and alternate search terms; Material Pin then searches the catalog text. OpenAI text embedding models do not accept images, so this is the practical first implementation for a mixed inventory catalog. It is cost-limited per organization and the API key never enters the browser bundle.

When adding an item, photo compression and EXIF extraction finish before any AI request. The employee then chooses **Generate details automatically** or **Enter details myself**. Automatic details can be retried if the service is unavailable, and every generated value remains editable before submission.

Each organization can maintain an **AI catalog guide** describing its business, common materials or assets, preferred terminology, identifier formats and facts the AI must not guess. This makes the same image workflow useful for steel service centers, salvage yards, warehouses and other specialized catalogs without changing code.

Custom lists and fields do not create SQL columns. Their definitions are stored in the organization's `collections` JSON configuration, while field values use the public or private JSON data attached to each record. This lets deployments add fields without database migrations and keeps older records valid when a form changes.

## CSV inventory import

Administrators can import `name`, `description`, `sku`, `quantity`, `unit`, `category`, `location`, `latitude`, `longitude`, `public`, `keywords`, `manufacturer`, `condition` and `serial` columns. Rows without coordinates use the map location selected during import and appear as generic pins until a photo is added.

## Architecture

- React, TypeScript and Vite
- GitHub Pages static hosting
- Supabase Auth, PostgreSQL, Storage, Row-Level Security and Edge Functions
- MapLibre with OpenStreetMap tiles
- OpenAI Responses API for optional photo metadata and image-to-text search
- Progressive Web App manifest and service worker

Organizations share the Material Pin database by default and are isolated by `organization_id` plus row-level security. A dedicated private deployment can use its own Supabase project with the same schema.

## Local setup

Copy `.env.example` to `.env.development.local` and set the public Supabase values:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Keep `OPENAI_API_KEY` only in Supabase Edge Function secrets.

```powershell
pnpm install
pnpm test
pnpm build
pnpm dev
```

For an existing database, run the SQL migrations in `supabase/migrations` in filename order and deploy `supabase/functions/enrich-submission`.
