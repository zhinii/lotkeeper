-- The manage-organization Edge Function uses the server role only after it
-- validates the signed-in caller and checks organization ownership or role.
grant select, delete on public.organizations to service_role;
grant select on public.platform_admins to service_role;
grant select, insert, update, delete on public.organization_members to service_role;

select 'Material Pin organization management permissions installed' as result;
