# Lotkeeper deployment models

## Public and free examples

Public examples share the main Lotkeeper GitHub Pages application and Supabase project. Data is separated by `instance_id` and Supabase row-level security. Creating an instance adds configuration and membership rows; it does not create new tables.

Use this model for demonstrations, community maps, pilots, and organizations that accept logical separation in a shared service.

## Private access on the shared service

An instance may be marked private. Users must authenticate and be members of that instance, but its data still resides in the shared Supabase project. Describe this as **private access**, not a dedicated database.

## Dedicated private deployment

Use this model for paid customers requiring independent ownership, billing, backups, retention, or contractual separation.

1. Create a Supabase project owned by or assigned to the customer.
2. Run `supabase/lotkeeper-schema.sql` in that project.
3. Create the first administrator in Supabase Auth.
4. Create a dedicated GitHub repository or deployment branch.
5. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as GitHub Actions variables for that repository.
6. Deploy with the included GitHub Pages workflow.
7. Create the customer's first instance through `#/admin`.
8. Record ownership, backup, retention, support, export, and closure requirements.

Never place a Supabase service-role key in GitHub Pages or browser code. Database migration, full export, and destructive closure operations belong in a protected operator workflow.

## Closing a dedicated deployment

1. Disable public access and user sign-in.
2. Export the customer's database and storage when retention requires it.
3. Obtain explicit approval for permanent deletion.
4. Remove the GitHub Pages deployment.
5. Delete or transfer the dedicated Supabase project.
6. Record completion and the disposition of backups.
