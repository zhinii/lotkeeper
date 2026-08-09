# Lotkeeper Site Template

Lotkeeper is a configurable, location-aware directory and operations template for large physical sites. It can be deployed separately for yards, vehicle lots, warehouses, stores, parks, venues, attractions, or other organizations.

## Current record model

- **Places:** trails, attractions, facilities, departments, viewpoints, and other persistent destinations.
- **Assets:** vehicles, machines, tools, rental equipment, and other individually managed items.
- **Stock:** consumable or sellable material with quantities and units.
- **Loose material:** scrap, offcuts, salvage, temporary piles, or informally managed items.

The organization name, site name, and initial map position are configured through the deployment environment. Copy `.env.example` to `.env.local` for local customization.

## Public contribution workflow

Public visitors do not need accounts. They can:

1. Add or update a mapped place, asset, stock location, or loose material record.
2. Report stock or consumable material that was used or removed.
3. Take or choose a current photograph in the browser.
4. Grant high-accuracy GPS access and move the pin to the exact location.
5. Provide a name plus phone, email, or assigned user name for staff follow-up.

Every submission is private and `pending` by default. Contributor contact information is staff-only. A signed-in administrator can review the photo, GPS accuracy, map pin, details, and contact information, then approve or reject it. Approval publishes new mapped records. Stock-change reports remain reviewed operational notices and do not silently change authoritative quantities.

## Storage and security

- Cloudflare D1 stores structured records and moderation history.
- R2 stores uploaded photographs.
- The staff workspace uses managed Sign in with ChatGPT.
- Public API responses never include contributor contact information.
- Public submissions are size- and type-validated and include a honeypot field. Production deployments should also configure platform rate limiting and an administrator allowlist.

## Local development

```powershell
npm install
npm run dev
npm run build
npm test
```

Database migrations are stored under `drizzle/`. The current deployment declares logical `DB` and `MEDIA` bindings in `.openai/hosting.json`.
