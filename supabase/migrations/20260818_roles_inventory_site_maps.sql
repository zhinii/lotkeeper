-- Four clear access levels, granular employee capabilities, inventory updates,
-- and non-GPS site maps for stores, warehouses, parks, and yards.
alter table public.organizations
  add column if not exists map_mode text not null default 'gps',
  add column if not exists map_image_path text,
  add column if not exists map_config jsonb not null default '{"gridRows":8,"gridColumns":10,"label":"Site map"}'::jsonb;

alter table public.organizations drop constraint if exists organizations_map_mode_check;
alter table public.organizations
  add constraint organizations_map_mode_check check (map_mode in ('gps','image','grid'));

alter table public.organization_members
  add column if not exists permissions jsonb not null default '{}'::jsonb;

alter table public.inventory_transactions
  add column if not exists actor_name text not null default 'Team member';

alter table public.organization_members drop constraint if exists organization_members_role_check;
update public.organization_members set role='employee' where role='staff';
alter table public.organization_members
  add constraint organization_members_role_check check (role in ('admin','employee','viewer'));

update public.organization_members
set permissions='{"viewPrivate":true,"viewInventory":true,"addItems":true,"updateItems":true,"adjustInventory":true}'::jsonb
where role='employee' and permissions='{}'::jsonb;

create or replace function public.is_org_admin(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_platform_admin() or exists(
    select 1
    from public.organizations o
    where o.id=target and (
      o.created_by=auth.uid() or exists(
        select 1 from public.organization_members m
        where m.organization_id=target and m.user_id=auth.uid() and m.role='admin'
      )
    )
  )
$$;

create or replace function public.member_has_permission(target uuid, permission_key text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_org_admin(target) or exists(
    select 1
    from public.organization_members m
    where m.organization_id=target and m.user_id=auth.uid()
      and (m.role='employee' or permission_key in ('viewPrivate','viewInventory'))
      and coalesce(
        (m.permissions->>permission_key)::boolean,
        m.role='employee' and permission_key in ('viewPrivate','viewInventory','addItems','updateItems','adjustInventory')
      )
  )
$$;

create or replace function public.can_view_org(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select exists(
    select 1 from public.organizations o
    where o.id=target and (
      o.public_access or public.is_platform_admin() or o.created_by=auth.uid() or
      exists(select 1 from public.organization_members m where m.organization_id=o.id and m.user_id=auth.uid())
    )
  )
$$;

create or replace function public.can_upload_submission_media(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.member_has_permission(target,'addItems') or public.member_has_permission(target,'updateItems')
$$;

drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select
  using (public_access or public.is_platform_admin() or public.is_org_member(id) or created_by=auth.uid());

drop policy if exists members_read on public.organization_members;
create policy members_read on public.organization_members for select to authenticated
  using (user_id=auth.uid() or public.is_org_admin(organization_id));

drop policy if exists records_read on public.records;
create policy records_read on public.records for select
  using (
    public.can_view_org(organization_id) and (
      public_visible or public.member_has_permission(organization_id,'viewPrivate')
    )
  );

drop policy if exists private_record_member_read on public.record_private_data;
create policy private_record_member_read on public.record_private_data for select to authenticated
  using (public.member_has_permission(organization_id,'viewPrivate'));

drop policy if exists versions_member_read on public.record_versions;
create policy versions_member_read on public.record_versions for select to authenticated
  using (public.member_has_permission(organization_id,'viewPrivate'));

drop policy if exists submissions_create on public.submissions;
create policy submissions_create on public.submissions for insert to authenticated
  with check (
    status='pending' and submitted_by=auth.uid() and (
      (submission_type='new' and public.member_has_permission(organization_id,'addItems')) or
      (submission_type='update' and public.member_has_permission(organization_id,'updateItems'))
    )
  );

drop policy if exists inventory_member_read on public.inventory_transactions;
create policy inventory_member_read on public.inventory_transactions for select to authenticated
  using (public.member_has_permission(organization_id,'viewInventory'));

create or replace function public.adjust_inventory(
  target_record uuid,
  quantity_value numeric,
  event_kind text,
  note_text text default ''
)
returns numeric language plpgsql security definer set search_path=public
as $$
declare r public.records; after_amount numeric; changed_amount numeric;
begin
  select * into r from public.records where id=target_record for update;
  if r.id is null or not public.member_has_permission(r.organization_id,'adjustInventory') then
    raise exception 'Inventory adjustment permission required';
  end if;
  if event_kind not in ('added','used','counted') then raise exception 'Choose received, used, or counted'; end if;
  if quantity_value<0 or (event_kind<>'counted' and quantity_value=0) then raise exception 'Enter a valid quantity'; end if;
  if event_kind='counted' then after_amount:=quantity_value;
  elsif event_kind='added' then after_amount:=coalesce(r.quantity,0)+quantity_value;
  else after_amount:=greatest(0,coalesce(r.quantity,0)-quantity_value);
  end if;
  changed_amount:=case when event_kind='counted' then abs(after_amount-coalesce(r.quantity,0)) else quantity_value end;
  insert into public.inventory_transactions(organization_id,record_id,user_id,actor_name,event_type,quantity,before_quantity,after_quantity,note)
  values(r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),event_kind,changed_amount,r.quantity,after_amount,nullif(trim(note_text),''));
  update public.records set quantity=after_amount,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=r.id;
  insert into public.alerts(organization_id,alert_type,title,detail,record_id)
  values(r.organization_id,'inventory_'||event_kind,'Inventory updated: '||r.name,
    event_kind||' · '||quantity_value||coalesce(' '||r.unit,'')||case when trim(note_text)='' then '' else ' · '||trim(note_text) end,r.id);
  return after_amount;
end $$;

create or replace function public.record_inventory_use(target_record uuid, amount_used numeric, note_text text default '')
returns numeric language sql security definer set search_path=public
as $$ select public.adjust_inventory(target_record,amount_used,'used',note_text) $$;

grant execute on function public.member_has_permission(uuid,text) to anon,authenticated;
grant execute on function public.adjust_inventory(uuid,numeric,text,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('site-maps','site-maps',false,15728640,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists site_map_read on storage.objects;
create policy site_map_read on storage.objects for select
  using (bucket_id='site-maps' and public.can_view_org(((storage.foldername(name))[1])::uuid));
drop policy if exists site_map_admin_insert on storage.objects;
create policy site_map_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists site_map_admin_update on storage.objects;
create policy site_map_admin_update on storage.objects for update to authenticated
  using (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid))
  with check (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
drop policy if exists site_map_admin_delete on storage.objects;
create policy site_map_admin_delete on storage.objects for delete to authenticated
  using (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
