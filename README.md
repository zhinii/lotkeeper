# Lotkeeper

Lotkeeper is a multi-organization, location-aware catalog and operations application hosted on GitHub Pages and backed by Supabase.

One static deployment can provide independently configured instances for material yards, vehicle lots, warehouses, stores, parks, attractions, and other large physical sites.

## Capabilities

- Admin console for creating organization instances.
- Public or member-only access per instance.
- Selectable Places, Assets, Stock, and Loose Material modules.
- Custom terminology for each organization.
- Search-first catalog with categories, codes, quantities, locations, photos, and an interactive map.
- Browser photo capture, high-accuracy GPS, and manual pin correction.
- Anonymous public contributions that remain private until approved.
- Staff-only contributor contact information.
- Approval/rejection queue and audited stock-removal reports.
- Supabase Auth, Postgres row-level security, and Storage.

## Architecture

GitHub Pages hosts one static React application. Organization deployments are database-backed instances reached through hash URLs such as:

```text
https://OWNER.github.io/REPOSITORY/#/site/page-steel
https://OWNER.github.io/REPOSITORY/#/site/example-park
https://OWNER.github.io/REPOSITORY/#/admin
```

This avoids maintaining a separate code copy for every customer. Each instance stores its own name, slug, site name, public/private access, enabled modules, labels, and initial map position.

## One-time Supabase setup

This repository is configured to use the existing Page Steel Supabase project through its public publishable key. No service-role secret belongs in this repository.

1. Open the Supabase project.
2. Open **SQL Editor**.
3. Run the complete file `supabase/lotkeeper-schema.sql`.
4. Open **Authentication → Users** and create the first administrator account.
5. Open the deployed application at `#/admin` and sign in.
6. Create the first organization instance.

The SQL creates tables, indexes, storage buckets, and row-level security policies. Public users may only read public instances and approved records. Submission contact information and pending photographs are restricted to instance administrators.

## Local use with PowerShell

```powershell
pnpm install
pnpm run dev
```

Production check:

```powershell
pnpm run build
pnpm test
```

## GitHub Pages deployment

The workflow at `.github/workflows/pages.yml` builds and publishes automatically from `main`.

After pushing the repository:

1. Open the GitHub repository.
2. Select **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main` or run the workflow manually from **Actions**.

The Vite build uses relative assets and hash routing, so it works under any GitHub Pages repository path.

## Configuration override

The default public Supabase URL and publishable key can be replaced during development with:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Only public/publishable client keys are supported. Administrative authorization is enforced by Supabase Auth and database policies—not by a secret embedded in the browser application.
