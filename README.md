# Material Pin

Material Pin is a mobile-first visual location finder and inventory tracker for physical sites: yards, warehouses, stores, vehicle lots, parks, campuses, and other large spaces. It connects photos, searchable catalog details, map pins, quantities, named locations, and accountable updates without forcing every site into the same workflow.

Live site: <https://zhinii.github.io/lotkeeper/>

## Product structure

The homepage explains the product. **Open a site** leads to the available public sites; authenticated people also see private sites assigned to them.

Each site has two focused work areas:

- **Visual finder:** McMaster-Carr-style text, photo, and filter search directly beside a map. Every result and pin shares the same number, making the item-to-location relationship clear at a glance.
- **Inventory tracker:** a separate category-first workspace for SKU, location, on-hand quantity, low/out-of-stock status, received/used/count adjustments, lightweight sale recording, and recent activity. Keeping this separate prevents operational inventory controls from cluttering the finder.

## Four access levels

- **Platform administrator:** can access and create every organization in the shared Material Pin deployment.
- **Site administrator:** manages settings, users, approvals, catalog items, inventory, AI guidance, and the map for assigned sites only.
- **Employee:** receives granular permissions from a site administrator: view private items, open inventory, add items, suggest updates, and/or adjust quantities.
- **Viewer:** read-only. A site administrator can allow private-item or inventory viewing, but viewers cannot submit or change data.

Permissions are enforced in the UI and in Supabase Row-Level Security/functions. Hiding a button is never the only access control.

## Maps and site plans

Each organization selects one location system:

- **Street map:** MapLibre/OpenStreetMap, GPS/EXIF, live phone location, manual pin correction, and optional boundaries.
- **Uploaded site plan:** a JPG, PNG, or WebP floor plan, store map, campus diagram, or yard drawing. Pins use percentage positions on the plan, so GPS is not required.
- **Generated grid:** configurable rows and columns for aisles, bays, zones, or storage yards without an existing drawing.

The plan image is stored in a private Supabase Storage bucket and delivered with a signed URL only when the organization is viewable.

## AI assistance

The existing server-side OpenAI key is used by the `enrich-submission` Supabase Edge Function. It never enters the GitHub Pages browser bundle.

AI is optional and user-reviewed. It can:

- suggest an item name, description, broad category, keywords, and alternate search terms from a photo;
- select a likely configured item group and fill only supported visible fields;
- read clearly visible identifiers or labels without inventing missing characters;
- convert a search photo into neutral text before searching the real catalog.

AI never publishes an item, approves a submission, or changes inventory. Employees edit suggestions before submission and site administrators approve the result. Per-site catalog guidance improves terminology without forcing unrelated objects into the catalog, and daily usage limits control cost.

## Inventory and data model

Standard records support name, description, category, photo, quantity, unit, SKU/asset ID, named location, map position, visibility, timestamps, and updater. Organization-specific fields are stored as JSON configuration and values, so adding a field does not require a new SQL column.

Inventory changes use a database function that records received, used, counted, and sold quantities with before/after values, the signed-in person, a note, timestamp, and an administrator alert. A sale also records the customer/company/job and optional order or invoice reference, prevents overselling, and reduces the on-hand quantity atomically.

This is intentionally a **sale-recording workflow, not payment processing**. Material Pin does not yet calculate tax, take card payments, issue fiscal receipts, manage a cash drawer, or replace accounting software. Those should only be added after real checkout requirements and integrations are defined.

CSV import recognizes `name`, `description`, `sku`, `quantity`, `unit`, `category`, `location`, `latitude`, `longitude`, `public`, `keywords`, `manufacturer`, `condition`, and `serial`.

## Architecture

- React, TypeScript, and Vite
- GitHub Pages static hosting
- Supabase Auth, PostgreSQL, Storage, Row-Level Security, and Edge Functions
- MapLibre/OpenStreetMap plus native uploaded-plan/grid maps
- OpenAI Responses API for optional photo suggestions and image-to-text search
- Progressive Web App manifest and service worker

Organizations share one database by default and are isolated by `organization_id` and RLS. A private paid deployment can use a dedicated Supabase project with the same schema.

## Upgrade an existing deployment

Run migrations in filename order. The current upgrade is:

```text
supabase/migrations/20260818_roles_inventory_site_maps.sql
supabase/migrations/20260818_inventory_sales.sql
```

Then redeploy both Edge Functions because user management now stores roles and permissions:

```powershell
supabase functions deploy manage-organization
supabase functions deploy enrich-submission
```

The existing `OPENAI_API_KEY` Supabase secret is reused; do not create or expose a new browser key.

## Local setup

Copy `.env.example` to `.env.development.local` and set only the public browser values:

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
