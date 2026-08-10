-- Lotkeeper V2 dedicated schema. Run only in the new Lotkeeper Supabase project.
create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  mode text not null check (mode in ('civic','commercial')),
  public_access boolean not null default false,
  center_lat double precision not null,
  center_lng double precision not null,
  map_zoom integer not null default 14 check (map_zoom between 3 and 22),
  boundary jsonb not null default '[]'::jsonb,
  collections jsonb not null default '[]'::jsonb,
  ai_enabled boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  collection_id text not null,
  name text not null,
  description text not null default '',
  keywords text[] not null default '{}',
  category text not null default 'Uncategorized',
  data jsonb not null default '{}'::jsonb,
  quantity numeric,
  unit text,
  latitude double precision not null,
  longitude double precision not null,
  location_source text not null check (location_source in ('photo_exif','browser_gps','manual_pin')),
  photo_path text,
  photo_taken_at timestamptz,
  status text not null default 'active' check (status in ('active','archived','removed')),
  public_visible boolean not null default true,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

-- Administrator-only fields live outside the public record row so an
-- anonymous `select *` request cannot disclose private values.
create table public.record_private_data (
  record_id uuid primary key references public.records(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table public.record_versions (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  changed_by uuid references auth.users(id),
  changed_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_type text not null check (submission_type in ('new','update')),
  target_record_id uuid references public.records(id) on delete set null,
  collection_id text not null,
  proposed jsonb not null,
  photo_path text,
  latitude double precision not null,
  longitude double precision not null,
  location_source text not null check (location_source in ('photo_exif','browser_gps','manual_pin')),
  gps_accuracy double precision,
  photo_taken_at timestamptz,
  submitted_at timestamptz not null default now(),
  submitted_by uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  ai_status text not null default 'not_requested' check (ai_status in ('not_requested','queued','processing','complete','failed')),
  ai_suggestions jsonb not null default '{}'::jsonb
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  event_type text not null check (event_type in ('used','removed','added','counted','moved')),
  quantity numeric not null,
  before_quantity numeric,
  after_quantity numeric,
  note text,
  created_at timestamptz not null default now()
);

create table public.search_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id),
  query text not null,
  result_count integer not null,
  opened_record_id uuid references public.records(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_type text not null,
  title text not null,
  detail text not null,
  record_id uuid references public.records(id) on delete set null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index records_org_collection on public.records(organization_id,collection_id,status);
create index submissions_org_status on public.submissions(organization_id,status,submitted_at desc);
create index searches_org_created on public.search_events(organization_id,created_at desc);
create index alerts_org_status on public.alerts(organization_id,status,created_at desc);

alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_members enable row level security;
alter table public.records enable row level security;
alter table public.record_private_data enable row level security;
alter table public.record_versions enable row level security;
alter table public.submissions enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.search_events enable row level security;
alter table public.alerts enable row level security;

create or replace function public.is_org_member(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organization_members where organization_id=target and user_id=auth.uid()) $$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.platform_admins where user_id=auth.uid()) $$;

create or replace function public.is_org_admin(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o where o.id=target and (o.created_by=auth.uid() or exists(select 1 from public.organization_members m where m.organization_id=target and m.user_id=auth.uid() and m.role='admin'))) $$;

create or replace function public.can_view_org(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o where o.id=target and (o.public_access or public.is_org_member(o.id) or o.created_by=auth.uid())) $$;

create or replace function public.collection_accepts_public(target uuid, collection_key text)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o, jsonb_array_elements(o.collections) c where o.id=target and o.mode='civic' and o.public_access and c->>'id'=collection_key and coalesce((c->>'publicSubmit')::boolean,false)) $$;

create or replace function public.collection_is_public(target uuid, collection_key text)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o, jsonb_array_elements(o.collections) c where o.id=target and c->>'id'=collection_key and coalesce((c->>'publicVisible')::boolean,false)) $$;

create or replace function public.can_upload_submission_media(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o where o.id=target and ((o.mode='civic' and o.public_access and exists(select 1 from jsonb_array_elements(o.collections) c where coalesce((c->>'publicSubmit')::boolean,false))) or public.is_org_member(o.id))) $$;

create or replace function public.public_record_data(target uuid, collection_key text, proposed_data jsonb)
returns jsonb language sql stable security definer set search_path=public
as $$
  select coalesce(jsonb_object_agg(entry.key,entry.value),'{}'::jsonb)
  from public.organizations o
  cross join jsonb_array_elements(o.collections) collection
  cross join lateral jsonb_each(coalesce(proposed_data,'{}'::jsonb)) entry
  where o.id=target and collection->>'id'=collection_key
    and exists (
      select 1 from jsonb_array_elements(coalesce(collection->'fields','[]'::jsonb)) field
      where field->>'key'=entry.key and coalesce((field->>'publicVisible')::boolean,false)
    )
$$;

create policy organizations_read on public.organizations for select using (public_access or public.is_org_member(id) or created_by=auth.uid());
create policy platform_admin_self_read on public.platform_admins for select to authenticated using (user_id=auth.uid());
create policy organizations_admin_update on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy members_read on public.organization_members for select to authenticated using (user_id=auth.uid() or public.is_org_admin(organization_id));
create policy members_admin_manage on public.organization_members for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy records_read on public.records for select using (public.can_view_org(organization_id) and (public.is_org_member(organization_id) or public_visible));
create policy records_admin_manage on public.records for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy private_record_member_read on public.record_private_data for select to authenticated using (public.is_org_member(organization_id));
create policy private_record_admin_manage on public.record_private_data for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy versions_member_read on public.record_versions for select to authenticated using (public.is_org_member(organization_id));
create policy submissions_create on public.submissions for insert to anon,authenticated with check (status='pending' and (public.collection_accepts_public(organization_id,collection_id) or public.is_org_member(organization_id)) and (submitted_by is null or submitted_by=auth.uid()));
create policy submissions_admin_read on public.submissions for select to authenticated using (public.is_org_admin(organization_id));
create policy submissions_admin_update on public.submissions for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy submissions_admin_delete on public.submissions for delete to authenticated using (public.is_org_admin(organization_id) and status<>'pending');
create policy inventory_member_read on public.inventory_transactions for select to authenticated using (public.is_org_member(organization_id));
create policy searches_member_insert on public.search_events for insert to authenticated with check (public.is_org_member(organization_id) and user_id=auth.uid());
create policy searches_admin_read on public.search_events for select to authenticated using (public.is_org_admin(organization_id));
create policy alerts_admin_read on public.alerts for select to authenticated using (public.is_org_admin(organization_id));
create policy alerts_admin_update on public.alerts for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));

create or replace function public.create_organization(org_name text, org_slug text, org_mode text, is_public boolean, latitude double precision, longitude double precision, zoom_level integer, collection_config jsonb)
returns uuid language plpgsql security definer set search_path=public
as $$ declare new_id uuid; begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_platform_admin() then raise exception 'Platform administrator access required'; end if;
  insert into public.organizations(name,slug,mode,public_access,center_lat,center_lng,map_zoom,collections,created_by) values(trim(org_name),lower(trim(org_slug)),org_mode,is_public,latitude,longitude,zoom_level,collection_config,auth.uid()) returning id into new_id;
  insert into public.organization_members(organization_id,user_id,role) values(new_id,auth.uid(),'admin');
  return new_id;
end $$;

create or replace function public.approve_submission(submission_id uuid, published_photo_path text)
returns uuid language plpgsql security definer set search_path=public
as $$ declare s public.submissions; r public.records; result_id uuid; all_data jsonb; visible_data jsonb; suggested_keywords text[]; begin
  select * into s from public.submissions where id=submission_id;
  if s.id is null or not public.is_org_admin(s.organization_id) then raise exception 'Administrator access required'; end if;
  if s.status<>'pending' then raise exception 'Submission is already resolved'; end if;
  all_data:=coalesce(s.proposed->'data','{}'::jsonb);
  visible_data:=public.public_record_data(s.organization_id,s.collection_id,all_data);
  suggested_keywords:=case when jsonb_typeof(s.ai_suggestions->'keywords')='array' then array(select jsonb_array_elements_text(s.ai_suggestions->'keywords')) else '{}'::text[] end;
  if s.submission_type='new' then
    insert into public.records(id,organization_id,collection_id,name,description,keywords,category,data,quantity,unit,latitude,longitude,location_source,photo_path,photo_taken_at,public_visible,updated_by)
    values(s.id,s.organization_id,s.collection_id,s.proposed->>'name',coalesce(s.proposed->>'description',''),suggested_keywords,coalesce(s.ai_suggestions->>'category',s.proposed->>'category','Uncategorized'),visible_data,case when s.proposed->>'quantity' is null then null else (s.proposed->>'quantity')::numeric end,s.proposed->>'unit',s.latitude,s.longitude,s.location_source,published_photo_path,s.photo_taken_at,public.collection_is_public(s.organization_id,s.collection_id),auth.uid()) returning id into result_id;
    insert into public.record_private_data(record_id,organization_id,data,updated_by) values(result_id,s.organization_id,all_data,auth.uid());
  else
    select * into r from public.records where id=s.target_record_id and organization_id=s.organization_id for update;
    if r.id is null then raise exception 'Target record not found'; end if;
    insert into public.record_versions(record_id,organization_id,version,snapshot,changed_by) values(r.id,r.organization_id,r.version,to_jsonb(r),auth.uid());
    update public.records set name=coalesce(s.proposed->>'name',name),description=coalesce(s.proposed->>'description',description),data=case when s.proposed ? 'data' then visible_data else data end,quantity=case when s.proposed ? 'quantity' then nullif(s.proposed->>'quantity','')::numeric else quantity end,unit=case when s.proposed ? 'unit' then s.proposed->>'unit' else unit end,latitude=s.latitude,longitude=s.longitude,location_source=s.location_source,photo_path=coalesce(published_photo_path,photo_path),photo_taken_at=coalesce(s.photo_taken_at,photo_taken_at),keywords=case when jsonb_typeof(s.ai_suggestions->'keywords')='array' then suggested_keywords else keywords end,category=coalesce(s.ai_suggestions->>'category',category),public_visible=public.collection_is_public(s.organization_id,s.collection_id),version=version+1,updated_at=now(),updated_by=auth.uid() where id=r.id returning id into result_id;
    if s.proposed ? 'data' then
      insert into public.record_private_data(record_id,organization_id,data,updated_by) values(result_id,s.organization_id,all_data,auth.uid())
      on conflict(record_id) do update set data=excluded.data,updated_at=now(),updated_by=excluded.updated_by;
    end if;
  end if;
  update public.submissions set status='approved',reviewed_at=now(),reviewed_by=auth.uid() where id=s.id;
  return result_id;
end $$;

create or replace function public.record_inventory_use(target_record uuid, amount_used numeric, note_text text default '')
returns numeric language plpgsql security definer set search_path=public
as $$ declare r public.records; after_amount numeric; begin
  select * into r from public.records where id=target_record for update;
  if r.id is null or not public.is_org_member(r.organization_id) then raise exception 'Member access required'; end if;
  if amount_used<=0 then raise exception 'Amount must be greater than zero'; end if;
  after_amount:=case when r.quantity is null then null else greatest(0,r.quantity-amount_used) end;
  insert into public.inventory_transactions(organization_id,record_id,user_id,event_type,quantity,before_quantity,after_quantity,note) values(r.organization_id,r.id,auth.uid(),'used',amount_used,r.quantity,after_amount,note_text);
  update public.records set quantity=after_amount,updated_at=now(),updated_by=auth.uid() where id=r.id;
  insert into public.alerts(organization_id,alert_type,title,detail,record_id) values(r.organization_id,'inventory_used','Inventory used: '||r.name,amount_used||coalesce(' '||r.unit,'')||' reported used',r.id);
  return after_amount;
end $$;

create or replace function public.log_commercial_search()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  if exists(select 1 from public.organizations where id=new.organization_id and mode='commercial') then
    insert into public.alerts(organization_id,alert_type,title,detail,record_id) values(new.organization_id,case when new.result_count=0 then 'search_no_result' else 'inventory_search' end,'Inventory search: '||new.query,new.result_count||' results returned',new.opened_record_id);
  end if;
  return new;
end $$;
create trigger search_alert after insert on public.search_events for each row execute function public.log_commercial_search();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('submission-media','submission-media',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('public-records','public-records',true,15728640,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy submission_photo_create on storage.objects for insert to anon,authenticated with check (bucket_id='submission-media' and public.can_upload_submission_media(((storage.foldername(name))[1])::uuid));
create policy submission_photo_admin_read on storage.objects for select to authenticated using (bucket_id='submission-media' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy submission_photo_admin_delete on storage.objects for delete to authenticated using (bucket_id='submission-media' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy public_photo_read on storage.objects for select using (bucket_id='public-records');
create policy public_photo_admin_insert on storage.objects for insert to authenticated with check (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy public_photo_admin_update on storage.objects for update to authenticated using (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid)) with check (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid));

grant usage on schema public to anon,authenticated;
grant usage on schema public to service_role;
grant select on public.organizations,public.records to anon,authenticated;
grant select on public.organizations to service_role;
grant select on public.platform_admins to authenticated;
grant select on public.record_private_data to authenticated;
grant insert on public.submissions to anon,authenticated;
grant select,update on public.submissions to service_role;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function public.create_organization to authenticated;
grant execute on function public.approve_submission to authenticated;
grant execute on function public.record_inventory_use to authenticated;

select 'Lotkeeper V2 schema installed' as result;
