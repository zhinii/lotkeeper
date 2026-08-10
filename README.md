# Lotkeeper V2

Lotkeeper is a mobile-first visual location and inventory finder for civic and commercial spaces. It joins photographs, map pins, descriptions, searchable fields and accountable activity in one system.

## What it supports

- **Civic deployments:** public maps, account-free photo submissions, EXIF GPS or browser GPS, manual pin correction, administrator approval/rejection, and reviewed updates to existing records.
- **Commercial deployments:** private or public sites, custom collections, persistent assets, consumable inventory, quantities and units, search logging, inventory-use transactions, and administrator alerts.
- **Every deployment:** organization branding, configurable opening map and boundary, configurable modules and fields, field-level public/private storage, responsive map/list search, record history, and resolved-alert reopening.
- **Optional AI:** server-side image suggestions for descriptions, categories and search terms. AI is off by default, limited per organization, and never publishes without administrator review.

## What V2 does not include yet

- Reservations, ticketing, payments, purchasing or full ERP/accounting functions.
- Automatic inventory reconciliation with external POS/ERP systems.
- Turn-by-turn navigation, offline maps or native mobile apps.
- A no-code user invitation screen; initial users are created/invited through Supabase Authentication.
- Guaranteed image identification. AI suggestions are search metadata and must be reviewed by a person.

## Architecture

- React + TypeScript + Vite on GitHub Pages.
- MapLibre with OpenStreetMap raster tiles.
- A dedicated Supabase project for Postgres, Authentication, Storage, RLS and the image-enrichment Edge Function.
- OpenAI image understanding runs only inside the Edge Function. The browser never receives `OPENAI_API_KEY` or a Supabase service key.

Page Steel remains a separate archived application and database. Lotkeeper deployments share the dedicated Lotkeeper database by default and are isolated by `organization_id` plus row-level security. A private paid deployment can instead use its own Supabase project with the same schema.

## Local setup

1. Install dependencies with `pnpm install`.
2. Create a separate Supabase project.
3. Run [`supabase/schema.sql`](supabase/schema.sql) once in that project's SQL Editor.
4. Copy `.env.example` to `.env.local` and add the project's URL and publishable key.
5. Run `pnpm dev`.

Do not place `OPENAI_API_KEY` in any `VITE_` variable. Deploy [`supabase/functions/enrich-submission/index.ts`](supabase/functions/enrich-submission/index.ts) as `enrich-submission`, turn legacy JWT verification off, and save `OPENAI_API_KEY` as an encrypted Edge Function secret. The implementation uses low-detail image input and Structured Outputs supported by the [OpenAI Images and Vision guide](https://developers.openai.com/api/docs/guides/images-vision) and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

## GitHub Pages

Set these repository variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then enable **Settings → Pages → Source: GitHub Actions**. Pushes to `main` run tests, build the relative-path Vite bundle and deploy Pages.

## Database safety

Public field values live in `records.data`. Private values live in the separate `record_private_data` table and are readable only by organization members. Public submissions enter `submissions` as `pending`; approval is performed by a security-definer database function after an administrator review. Storage uses separate private submission and public approved-image buckets.

Run checks with:

```powershell
pnpm test
pnpm build
```
