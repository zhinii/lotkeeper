-- The modern Supabase sb_secret key assumes the service_role database role.
-- Grant only the tables and operations required by enrich-submission.
grant usage on schema public to service_role;
grant select on public.organizations to service_role;
grant select, update on public.submissions to service_role;
