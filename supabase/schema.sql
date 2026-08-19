-- Material Pin dedicated schema. Run only in the Material Pin Supabase project.
create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  mode text not null default 'material' check (mode = 'material'),
  public_access boolean not null default false,
  center_lat double precision not null,
  center_lng double precision not null,
  map_zoom integer not null default 14 check (map_zoom between 3 and 22),
  boundary jsonb not null default '[]'::jsonb,
  map_mode text not null default 'gps' check (map_mode in ('gps','image','grid')),
  map_image_path text,
  map_config jsonb not null default '{"gridRows":8,"gridColumns":10,"label":"Site map"}'::jsonb,
  features jsonb not null default '{"mapping":true,"inventory":true,"pos":true}'::jsonb,
  pos_config jsonb not null default '{"currency":"USD","taxRate":0}'::jsonb,
  collections jsonb not null default '[]'::jsonb,
  ai_enabled boolean not null default false,
  ai_catalog_context text not null default '',
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
  role text not null check (role in ('admin','employee','viewer')),
  permissions jsonb not null default '{}'::jsonb,
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
  availability_status text not null default 'available' check (availability_status in ('available','out_of_stock','sold','unavailable')),
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

-- Server-written usage events prevent anonymous photo previews from bypassing
-- the per-organization AI budget. There are intentionally no browser policies.
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  purpose text not null check (purpose in ('preview','submission','search')),
  created_at timestamptz not null default now()
);

create table public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  actor_name text not null default 'Team member',
  event_type text not null check (event_type in ('used','removed','added','counted','moved','sold')),
  quantity numeric not null,
  before_quantity numeric,
  after_quantity numeric,
  note text,
  counterparty text,
  reference_code text,
  created_at timestamptz not null default now()
);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_number text not null,
  customer_name text not null,
  customer_contact text,
  reference_code text,
  subtotal numeric(14,2) not null default 0,
  tax_rate numeric(7,4) not null default 0,
  tax_amount numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  payment_method text not null default 'invoice',
  note text,
  status text not null default 'completed' check (status in ('completed','voided')),
  created_by uuid not null references auth.users(id),
  actor_name text not null default 'Team member',
  created_at timestamptz not null default now(),
  unique(organization_id,sale_number)
);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid references public.records(id) on delete set null,
  item_name text not null,
  sku text,
  quantity numeric not null check (quantity>0),
  unit text,
  unit_price numeric(14,2) not null check (unit_price>=0),
  line_total numeric(14,2) not null check (line_total>=0)
);

create table public.record_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  moved_by uuid not null references auth.users(id),
  actor_name text not null default 'Team member',
  from_latitude double precision not null,
  from_longitude double precision not null,
  to_latitude double precision not null,
  to_longitude double precision not null,
  from_location text,
  to_location text,
  note text,
  moved_at timestamptz not null default now()
);

create table public.search_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid default auth.uid() references auth.users(id),
  query text not null,
  search_type text not null default 'text' check (search_type in ('text','image','filter')),
  filters jsonb not null default '{}'::jsonb,
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

create or replace function public.sync_record_availability()
returns trigger language plpgsql set search_path=public
as $$ declare collection_kind text; begin
  if new.quantity is null or new.quantity>0 then
    new.availability_status:='available';
  elsif new.availability_status not in ('out_of_stock','sold','unavailable') then
    select coalesce(collection->>'kind','consumable') into collection_kind from public.organizations organization_row cross join jsonb_array_elements(organization_row.collections) collection where organization_row.id=new.organization_id and collection->>'id'=new.collection_id limit 1;
    new.availability_status:=case when coalesce(collection_kind,'consumable')='persistent' then 'unavailable' else 'out_of_stock' end;
  end if;
  return new;
end $$;
create trigger records_sync_availability before insert or update of quantity,collection_id,availability_status on public.records for each row execute function public.sync_record_availability();
create index submissions_org_status on public.submissions(organization_id,status,submitted_at desc);
create index ai_usage_org_created on public.ai_usage_events(organization_id,created_at desc);
create index searches_org_created on public.search_events(organization_id,created_at desc);
create index alerts_org_status on public.alerts(organization_id,status,created_at desc);
create index records_org_status_updated on public.records(organization_id,status,updated_at desc);
create index records_org_updated on public.records(organization_id,updated_at desc);
create index submissions_org_submitted on public.submissions(organization_id,submitted_at desc);
create index record_private_org_record on public.record_private_data(organization_id,record_id);
create index alerts_org_created on public.alerts(organization_id,created_at desc);
create index sales_org_created on public.sales(organization_id,created_at desc);
create index sales_org_number on public.sales(organization_id,sale_number);
create index sale_items_sale on public.sale_items(sale_id);
create index record_movements_record on public.record_movements(record_id,moved_at desc);
create index record_movements_org on public.record_movements(organization_id,moved_at desc);

alter table public.organizations enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organization_members enable row level security;
alter table public.records enable row level security;
alter table public.record_private_data enable row level security;
alter table public.record_versions enable row level security;
alter table public.submissions enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.record_movements enable row level security;
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
as $$ select public.is_platform_admin() or exists(select 1 from public.organizations o where o.id=target and (o.created_by=auth.uid() or exists(select 1 from public.organization_members m where m.organization_id=target and m.user_id=auth.uid() and m.role='admin'))) $$;

create or replace function public.member_has_permission(target uuid, permission_key text)
returns boolean language sql stable security definer set search_path=public
as $$ select public.is_org_admin(target) or exists(select 1 from public.organization_members m where m.organization_id=target and m.user_id=auth.uid() and (m.role='employee' or permission_key in ('viewPrivate','viewInventory')) and coalesce((m.permissions->>permission_key)::boolean,m.role='employee' and permission_key in ('viewPrivate','viewInventory','addItems','updateItems','adjustInventory'))) $$;

create or replace function public.can_view_org(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o where o.id=target and (o.public_access or public.is_platform_admin() or public.is_org_member(o.id) or o.created_by=auth.uid())) $$;

create or replace function public.collection_accepts_public(target uuid, collection_key text)
returns boolean language sql stable security definer set search_path=public
as $$ select false $$;

create or replace function public.collection_is_public(target uuid, collection_key text)
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.organizations o, jsonb_array_elements(o.collections) c where o.id=target and c->>'id'=collection_key and coalesce((c->>'publicVisible')::boolean,false)) $$;

create or replace function public.can_upload_submission_media(target uuid)
returns boolean language sql stable security definer set search_path=public
as $$ select public.member_has_permission(target,'addItems') or public.member_has_permission(target,'updateItems') $$;

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

create policy organizations_read on public.organizations for select using (public_access or public.is_platform_admin() or public.is_org_member(id) or created_by=auth.uid());
create policy platform_admin_self_read on public.platform_admins for select to authenticated using (user_id=auth.uid());
create policy organizations_admin_update on public.organizations for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));
create policy members_read on public.organization_members for select to authenticated using (user_id=auth.uid() or public.is_org_admin(organization_id));
create policy members_admin_manage on public.organization_members for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy records_read on public.records for select using (public.can_view_org(organization_id) and (public_visible or public.member_has_permission(organization_id,'viewPrivate')));
create policy records_admin_manage on public.records for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy private_record_member_read on public.record_private_data for select to authenticated using (public.member_has_permission(organization_id,'viewPrivate') or public.member_has_permission(organization_id,'usePos'));
create policy private_record_admin_manage on public.record_private_data for all to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy versions_member_read on public.record_versions for select to authenticated using (public.member_has_permission(organization_id,'viewPrivate'));
create policy submissions_create on public.submissions for insert to authenticated with check (status='pending' and submitted_by=auth.uid() and ((submission_type='new' and public.member_has_permission(organization_id,'addItems')) or (submission_type='update' and public.member_has_permission(organization_id,'updateItems'))));
create policy submissions_admin_read on public.submissions for select to authenticated using (public.is_org_admin(organization_id));
create policy submissions_admin_update on public.submissions for update to authenticated using (public.is_org_admin(organization_id)) with check (public.is_org_admin(organization_id));
create policy submissions_admin_delete on public.submissions for delete to authenticated using (public.is_org_admin(organization_id) and status<>'pending');
create policy inventory_member_read on public.inventory_transactions for select to authenticated using (public.member_has_permission(organization_id,'viewInventory'));
create policy sales_member_read on public.sales for select to authenticated using (public.is_org_admin(organization_id) or public.member_has_permission(organization_id,'viewSales') or (public.member_has_permission(organization_id,'usePos') and created_by=auth.uid()));
create policy sale_items_member_read on public.sale_items for select to authenticated using (exists(select 1 from public.sales sale where sale.id=sale_id and (public.is_org_admin(sale.organization_id) or public.member_has_permission(sale.organization_id,'viewSales') or (public.member_has_permission(sale.organization_id,'usePos') and sale.created_by=auth.uid()))));
create policy record_movements_member_read on public.record_movements for select to authenticated using (public.member_has_permission(organization_id,'viewPrivate') or public.member_has_permission(organization_id,'moveItems'));
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
  if r.id is null or not public.member_has_permission(r.organization_id,'adjustInventory') then raise exception 'Inventory adjustment permission required'; end if;
  if amount_used<=0 then raise exception 'Amount must be greater than zero'; end if;
  after_amount:=case when r.quantity is null then null else greatest(0,r.quantity-amount_used) end;
  insert into public.inventory_transactions(organization_id,record_id,user_id,actor_name,event_type,quantity,before_quantity,after_quantity,note) values(r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),'used',amount_used,r.quantity,after_amount,note_text);
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

create or replace function public.log_material_search(target_organization uuid, search_query text, search_kind text, search_filters jsonb, matching_records integer)
returns uuid language plpgsql security definer set search_path=public
as $$ declare new_id uuid; begin
  if search_kind not in ('text','image','filter') then raise exception 'Unsupported search type'; end if;
  if not exists(select 1 from public.organizations where id=target_organization and (public_access or public.is_org_member(id))) then raise exception 'Organization is not available'; end if;
  insert into public.search_events(organization_id,user_id,query,search_type,filters,result_count)
  values(target_organization,auth.uid(),left(coalesce(nullif(trim(search_query),''),'Browse filters'),500),search_kind,coalesce(search_filters,'{}'::jsonb),greatest(0,matching_records))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.move_record(target_record uuid,latitude_value double precision,longitude_value double precision,location_text text default '',note_text text default '')
returns jsonb language plpgsql security definer set search_path=public
as $$ declare r public.records; org public.organizations; old_location text; updated_data jsonb; private_data jsonb; location_public boolean:=true; begin
  select * into r from public.records where id=target_record for update;
  if r.id is null then raise exception 'Item not found'; end if;
  if not public.member_has_permission(r.organization_id,'moveItems') then raise exception 'Relocation permission required'; end if;
  select * into org from public.organizations where id=r.organization_id;
  if not coalesce((org.features->>'mapping')::boolean,true) then raise exception 'Visual mapping is not enabled for this organization'; end if;
  if org.map_mode='gps' and (latitude_value not between -90 and 90 or longitude_value not between -180 and 180) then raise exception 'Choose a valid GPS location'; end if;
  if org.map_mode<>'gps' and (latitude_value not between 0 and 100 or longitude_value not between 0 and 100) then raise exception 'Choose a location inside the site plan'; end if;
  select data into private_data from public.record_private_data where record_id=r.id; private_data:=coalesce(private_data,'{}'::jsonb);
  select coalesce((field->>'publicVisible')::boolean,true) into location_public from jsonb_array_elements(org.collections) collection cross join jsonb_array_elements(coalesce(collection->'fields','[]'::jsonb)) field where collection->>'id'=r.collection_id and field->>'key' in ('location_code','location','storage_location','bin') order by case field->>'key' when 'location_code' then 0 when 'location' then 1 else 2 end limit 1; location_public:=coalesce(location_public,true);
  old_location:=coalesce(private_data->>'location_code',private_data->>'location',private_data->>'storage_location',private_data->>'bin',r.data->>'location_code',r.data->>'location',r.data->>'storage_location',r.data->>'bin'); updated_data:=r.data;
  if trim(coalesce(location_text,''))<>'' then
    if location_public then updated_data:=jsonb_set(updated_data,'{location_code}',to_jsonb(trim(location_text)),true); private_data:=private_data-'location_code'-'location'-'storage_location'-'bin';
    else updated_data:=updated_data-'location_code'-'location'-'storage_location'-'bin'; private_data:=jsonb_set(private_data,'{location_code}',to_jsonb(trim(location_text)),true); end if;
    insert into public.record_private_data(record_id,organization_id,data,updated_by) values(r.id,r.organization_id,private_data,auth.uid()) on conflict(record_id) do update set data=excluded.data,updated_at=now(),updated_by=excluded.updated_by;
  end if;
  insert into public.record_movements(organization_id,record_id,moved_by,actor_name,from_latitude,from_longitude,to_latitude,to_longitude,from_location,to_location,note)
  values(r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),r.latitude,r.longitude,latitude_value,longitude_value,nullif(trim(old_location),''),nullif(trim(location_text),''),nullif(trim(note_text),''));
  update public.records set latitude=latitude_value,longitude=longitude_value,location_source='manual_pin',data=updated_data,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=r.id;
  insert into public.inventory_transactions(organization_id,record_id,user_id,actor_name,event_type,quantity,before_quantity,after_quantity,note)
  values(r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),'moved',0,r.quantity,r.quantity,concat_ws(' · ','Relocated item',nullif(trim(location_text),''),nullif(trim(note_text),'')));
  return jsonb_build_object('latitude',latitude_value,'longitude',longitude_value,'location',nullif(trim(location_text),''));
end $$;

create or replace function public.checkout_sale(
  target_organization uuid,
  cart_items jsonb,
  customer_text text,
  contact_text text default '',
  reference_text text default '',
  payment_method_text text default 'invoice',
  tax_rate_value numeric default 0,
  note_text text default ''
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  sale_id uuid:=gen_random_uuid(); sale_code text;
  actor text:=coalesce(auth.jwt()->>'email','Team member');
  line jsonb; r public.records; line_quantity numeric; line_price numeric;
  line_amount numeric; next_quantity numeric; current_sku text; collection_kind text; next_availability text;
  calculated_subtotal numeric:=0; calculated_tax numeric:=0; calculated_total numeric:=0;
  safe_tax_rate numeric:=least(100,greatest(0,coalesce(tax_rate_value,0)));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.member_has_permission(target_organization,'usePos') then raise exception 'Checkout permission required'; end if;
  if not coalesce((select (features->>'pos')::boolean from public.organizations where id=target_organization),true) then raise exception 'Checkout is not enabled for this organization'; end if;
  if trim(coalesce(customer_text,''))='' then raise exception 'Enter a customer, company, or job'; end if;
  if jsonb_typeof(cart_items)<>'array' or jsonb_array_length(cart_items)=0 then raise exception 'Add at least one item'; end if;
  if exists(select 1 from jsonb_array_elements(cart_items) cart_line group by cart_line->>'record_id' having count(*)>1) then raise exception 'Each checkout item can appear only once'; end if;
  perform 1 from public.records record_row where record_row.id in (select (cart_line->>'record_id')::uuid from jsonb_array_elements(cart_items) cart_line) order by record_row.id for update;
  sale_code:='MP-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(sale_id::text,'-',''),1,6));
  insert into public.sales(id,organization_id,sale_number,customer_name,customer_contact,reference_code,payment_method,note,created_by,actor_name)
  values(sale_id,target_organization,sale_code,trim(customer_text),nullif(trim(contact_text),''),nullif(trim(reference_text),''),coalesce(nullif(trim(payment_method_text),''),'invoice'),nullif(trim(note_text),''),auth.uid(),actor);
  for line in select value from jsonb_array_elements(cart_items) loop
    select * into r from public.records where id=(line->>'record_id')::uuid and organization_id=target_organization and status='active' for update;
    if r.id is null then raise exception 'A checkout item is no longer available'; end if;
    if r.quantity is null then raise exception '% is not quantity-tracked',r.name; end if;
    line_quantity:=nullif(line->>'quantity','')::numeric; line_price:=nullif(line->>'unit_price','')::numeric;
    if line_quantity is null or line_quantity<=0 then raise exception 'Enter a valid quantity for %',r.name; end if;
    if line_price is null or line_price<0 then raise exception 'Enter a valid unit price for %',r.name; end if;
    if line_quantity>r.quantity then raise exception 'Not enough inventory is available for %',r.name; end if;
    next_quantity:=r.quantity-line_quantity; line_amount:=round(line_quantity*line_price,2);
    select coalesce(collection->>'kind','consumable') into collection_kind from public.organizations organization_row cross join jsonb_array_elements(organization_row.collections) collection where organization_row.id=target_organization and collection->>'id'=r.collection_id limit 1;
    next_availability:=case when next_quantity>0 then 'available' when coalesce(collection_kind,'consumable')='persistent' then 'sold' else 'out_of_stock' end;
    select coalesce(private_data.data->>'sku',r.data->>'sku',r.data->>'asset_id') into current_sku from public.records record_row left join public.record_private_data private_data on private_data.record_id=record_row.id where record_row.id=r.id;
    insert into public.sale_items(sale_id,organization_id,record_id,item_name,sku,quantity,unit,unit_price,line_total)
    values(sale_id,target_organization,r.id,r.name,nullif(trim(current_sku),''),line_quantity,r.unit,line_price,line_amount);
    insert into public.inventory_transactions(organization_id,record_id,user_id,actor_name,event_type,quantity,before_quantity,after_quantity,note,counterparty,reference_code)
    values(target_organization,r.id,auth.uid(),actor,'sold',line_quantity,r.quantity,next_quantity,'Checkout '||sale_code,trim(customer_text),coalesce(nullif(trim(reference_text),''),sale_code));
    update public.records set quantity=next_quantity,availability_status=next_availability,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=r.id;
    calculated_subtotal:=calculated_subtotal+line_amount;
  end loop;
  calculated_tax:=round(calculated_subtotal*safe_tax_rate/100,2); calculated_total:=calculated_subtotal+calculated_tax;
  update public.sales set subtotal=calculated_subtotal,tax_rate=safe_tax_rate,tax_amount=calculated_tax,total=calculated_total where id=sale_id;
  insert into public.alerts(organization_id,alert_type,title,detail) values(target_organization,'sale_completed','Checkout completed: '||sale_code,trim(customer_text)||' · '||calculated_total||' · '||actor);
  return jsonb_build_object('id',sale_id,'sale_number',sale_code,'subtotal',calculated_subtotal,'tax_amount',calculated_tax,'total',calculated_total);
end $$;

create or replace function public.adjust_inventory(
  target_record uuid,
  quantity_value numeric,
  event_kind text,
  note_text text default '',
  counterparty_text text default '',
  reference_text text default ''
)
returns numeric language plpgsql security definer set search_path=public
as $$ declare r public.records; after_amount numeric; changed_amount numeric; collection_kind text; next_availability text; begin
  select * into r from public.records where id=target_record for update;
  if r.id is null then raise exception 'Inventory item not found'; end if;
  if not coalesce((select (features->>'inventory')::boolean from public.organizations where id=r.organization_id),true) then raise exception 'Inventory tracking is not enabled for this organization'; end if;
  if event_kind='sold' and not public.member_has_permission(r.organization_id,'usePos') then raise exception 'Checkout permission required'; end if;
  if event_kind<>'sold' and not public.member_has_permission(r.organization_id,'adjustInventory') then raise exception 'Inventory adjustment permission required'; end if;
  if event_kind not in ('added','used','counted','sold') then raise exception 'Choose received, used, sold, or counted'; end if;
  if quantity_value<0 or (event_kind<>'counted' and quantity_value=0) then raise exception 'Enter a valid quantity'; end if;
  if event_kind='sold' and trim(coalesce(counterparty_text,''))='' then raise exception 'Enter who the item was sold to'; end if;
  if event_kind='sold' and quantity_value>coalesce(r.quantity,0) then raise exception 'Not enough inventory is available for this sale'; end if;
  if event_kind='counted' then after_amount:=quantity_value; elsif event_kind='added' then after_amount:=coalesce(r.quantity,0)+quantity_value; else after_amount:=greatest(0,coalesce(r.quantity,0)-quantity_value); end if;
  changed_amount:=case when event_kind='counted' then abs(after_amount-coalesce(r.quantity,0)) else quantity_value end;
  select coalesce(collection->>'kind','consumable') into collection_kind from public.organizations organization_row cross join jsonb_array_elements(organization_row.collections) collection where organization_row.id=r.organization_id and collection->>'id'=r.collection_id limit 1;
  next_availability:=case when after_amount>0 then 'available' when coalesce(collection_kind,'consumable')='persistent' and event_kind='sold' then 'sold' when coalesce(collection_kind,'consumable')='persistent' then 'unavailable' else 'out_of_stock' end;
  insert into public.inventory_transactions(organization_id,record_id,user_id,actor_name,event_type,quantity,before_quantity,after_quantity,note,counterparty,reference_code)
  values(r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),event_kind,changed_amount,r.quantity,after_amount,nullif(trim(note_text),''),case when event_kind='sold' then nullif(trim(counterparty_text),'') end,case when event_kind='sold' then nullif(trim(reference_text),'') end);
  update public.records set quantity=after_amount,availability_status=next_availability,updated_at=now(),updated_by=auth.uid(),version=version+1 where id=r.id;
  insert into public.alerts(organization_id,alert_type,title,detail,record_id)
  values(r.organization_id,'inventory_'||event_kind,case when event_kind='sold' then 'Inventory sold: ' else 'Inventory updated: ' end||r.name,event_kind||' · '||quantity_value||coalesce(' '||r.unit,'')||case when event_kind='sold' then ' · Sold to '||trim(counterparty_text) else '' end||case when trim(reference_text)='' then '' else ' · '||trim(reference_text) end||case when trim(note_text)='' then '' else ' · '||trim(note_text) end,r.id);
  return after_amount;
end $$;

create or replace function public.record_inventory_use(
  target_record uuid,
  amount_used numeric,
  note_text text default ''
)
returns numeric language sql security definer set search_path=public
as $$ select public.adjust_inventory(target_record,amount_used,'used',note_text,'','') $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('submission-media','submission-media',false,15728640,array['image/jpeg','image/png','image/webp','image/heic','image/heif']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('public-records','public-records',true,15728640,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=true,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('site-maps','site-maps',false,15728640,array['image/jpeg','image/png','image/webp']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy submission_photo_create on storage.objects for insert to anon,authenticated with check (bucket_id='submission-media' and public.can_upload_submission_media(((storage.foldername(name))[1])::uuid));
create policy submission_photo_admin_read on storage.objects for select to authenticated using (bucket_id='submission-media' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy submission_photo_admin_delete on storage.objects for delete to authenticated using (bucket_id='submission-media' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy public_photo_read on storage.objects for select using (bucket_id='public-records');
create policy public_photo_admin_insert on storage.objects for insert to authenticated with check (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy public_photo_admin_update on storage.objects for update to authenticated using (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid)) with check (bucket_id='public-records' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy site_map_read on storage.objects for select using (bucket_id='site-maps' and public.can_view_org(((storage.foldername(name))[1])::uuid));
create policy site_map_admin_insert on storage.objects for insert to authenticated with check (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy site_map_admin_update on storage.objects for update to authenticated using (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid)) with check (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));
create policy site_map_admin_delete on storage.objects for delete to authenticated using (bucket_id='site-maps' and public.is_org_admin(((storage.foldername(name))[1])::uuid));

grant usage on schema public to anon,authenticated;
grant usage on schema public to service_role;
grant select on public.organizations,public.records to anon,authenticated;
grant select,delete on public.organizations to service_role;
grant select on public.platform_admins to service_role;
grant select,insert,update,delete on public.organization_members to service_role;
grant select on public.platform_admins to authenticated;
grant select on public.record_private_data to authenticated;
grant insert on public.submissions to anon,authenticated;
grant select,update on public.submissions to service_role;
grant select,insert on public.ai_usage_events to service_role;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on function public.create_organization to authenticated;
grant execute on function public.approve_submission to authenticated;
grant execute on function public.record_inventory_use to authenticated;
grant execute on function public.member_has_permission to anon,authenticated;
grant execute on function public.adjust_inventory to authenticated;
grant select on public.sales,public.sale_items,public.record_movements to authenticated;
grant execute on function public.checkout_sale(uuid,jsonb,text,text,text,text,numeric,text) to authenticated;
grant execute on function public.move_record(uuid,double precision,double precision,text,text) to authenticated;
grant execute on function public.log_material_search(uuid,text,text,jsonb,integer) to anon,authenticated;

select 'Material Pin schema installed' as result;
