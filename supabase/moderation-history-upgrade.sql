-- Fix creator administration and allow deliberate cleanup of resolved submissions.
-- Safe to rerun.

create or replace function public.is_instance_admin(target uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(
    select 1 from public.instances i
    where i.id=target and (
      i.created_by=auth.uid()
      or exists(select 1 from public.instance_members m where m.instance_id=target and m.user_id=auth.uid() and m.role='admin')
    )
  )
$$;

drop policy if exists "admins delete submissions" on public.submissions;
create policy "admins delete submissions" on public.submissions
for delete to authenticated using (public.is_instance_admin(instance_id) and status in ('approved','rejected'));

drop policy if exists "admins update stock history" on public.stock_events;
create policy "admins update stock history" on public.stock_events
for update to authenticated using (public.is_instance_admin(instance_id)) with check (public.is_instance_admin(instance_id));

drop policy if exists "admins delete submission photos" on storage.objects;
create policy "admins delete submission photos" on storage.objects
for delete to authenticated using (
  bucket_id='submission-media'
  and public.is_instance_admin(((storage.foldername(name))[1])::uuid)
);

select 'Lotkeeper moderation history upgrade installed' as result;
