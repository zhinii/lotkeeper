-- Material Pin product modules and multi-item checkout.
-- Run after 20260818_inventory_sales.sql.

alter table public.organizations
  add column if not exists features jsonb not null
  default '{"mapping":true,"inventory":true,"pos":true}'::jsonb;

alter table public.organizations
  add column if not exists pos_config jsonb not null
  default '{"currency":"USD","taxRate":0}'::jsonb;

alter table public.records
  add column if not exists availability_status text not null default 'available';
alter table public.records drop constraint if exists records_availability_status_check;
alter table public.records add constraint records_availability_status_check
  check (availability_status in ('available','out_of_stock','sold','unavailable'));
update public.records record_row
set availability_status=case
  when exists (
    select 1 from public.organizations organization_row,
      jsonb_array_elements(organization_row.collections) collection
    where organization_row.id=record_row.organization_id
      and collection->>'id'=record_row.collection_id
      and collection->>'kind'='persistent'
  ) then 'unavailable'
  else 'out_of_stock'
end
where quantity=0 and availability_status='available';

create or replace function public.sync_record_availability()
returns trigger language plpgsql set search_path=public
as $$
declare collection_kind text;
begin
  if new.quantity is null or new.quantity>0 then
    new.availability_status:='available';
  elsif new.availability_status not in ('out_of_stock','sold','unavailable') then
    select coalesce(collection->>'kind','consumable') into collection_kind
    from public.organizations organization_row
    cross join jsonb_array_elements(organization_row.collections) collection
    where organization_row.id=new.organization_id and collection->>'id'=new.collection_id
    limit 1;
    new.availability_status:=case when coalesce(collection_kind,'consumable')='persistent' then 'unavailable' else 'out_of_stock' end;
  end if;
  return new;
end $$;
drop trigger if exists records_sync_availability on public.records;
create trigger records_sync_availability
before insert or update of quantity,collection_id,availability_status on public.records
for each row execute function public.sync_record_availability();

create or replace function public.member_has_permission(target uuid, permission_key text)
returns boolean language sql stable security definer set search_path=public
as $$
  select public.is_org_admin(target) or exists(
    select 1
    from public.organization_members m
    where m.organization_id=target
      and m.user_id=auth.uid()
      and (m.role='employee' or permission_key in ('viewPrivate','viewInventory'))
      and coalesce(
        (m.permissions->>permission_key)::boolean,
        m.role='employee' and permission_key in (
          'viewPrivate','viewInventory','addItems','updateItems','adjustInventory'
        )
      )
  )
$$;

drop policy if exists private_record_member_read on public.record_private_data;
create policy private_record_member_read on public.record_private_data
for select to authenticated
using (
  public.member_has_permission(organization_id,'viewPrivate') or
  public.member_has_permission(organization_id,'usePos')
);

create table if not exists public.sales (
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

create table if not exists public.sale_items (
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

create table if not exists public.record_movements (
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

create index if not exists sales_org_created
  on public.sales(organization_id,created_at desc);
create index if not exists sales_org_number
  on public.sales(organization_id,sale_number);
create index if not exists sale_items_sale
  on public.sale_items(sale_id);
create index if not exists record_movements_record
  on public.record_movements(record_id,moved_at desc);
create index if not exists record_movements_org
  on public.record_movements(organization_id,moved_at desc);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.record_movements enable row level security;

drop policy if exists sales_member_read on public.sales;
create policy sales_member_read on public.sales
for select to authenticated
using (
  public.is_org_admin(organization_id) or
  public.member_has_permission(organization_id,'viewSales') or
  (public.member_has_permission(organization_id,'usePos') and created_by=auth.uid())
);

drop policy if exists sale_items_member_read on public.sale_items;
create policy sale_items_member_read on public.sale_items
for select to authenticated
using (
  exists(
    select 1 from public.sales sale
    where sale.id=sale_id and (
      public.is_org_admin(sale.organization_id) or
      public.member_has_permission(sale.organization_id,'viewSales') or
      (public.member_has_permission(sale.organization_id,'usePos') and sale.created_by=auth.uid())
    )
  )
);

drop policy if exists record_movements_member_read on public.record_movements;
create policy record_movements_member_read on public.record_movements
for select to authenticated
using (
  public.member_has_permission(organization_id,'viewPrivate') or
  public.member_has_permission(organization_id,'moveItems')
);

drop function if exists public.move_record(uuid,double precision,double precision,text,text);
create function public.move_record(
  target_record uuid,
  latitude_value double precision,
  longitude_value double precision,
  location_text text default '',
  note_text text default ''
)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare
  r public.records;
  org public.organizations;
  old_location text;
  updated_data jsonb;
  private_data jsonb;
  location_public boolean:=true;
begin
  select * into r from public.records where id=target_record for update;
  if r.id is null then raise exception 'Item not found'; end if;
  if not public.member_has_permission(r.organization_id,'moveItems') then raise exception 'Relocation permission required'; end if;
  select * into org from public.organizations where id=r.organization_id;
  if not coalesce((org.features->>'mapping')::boolean,true) then
    raise exception 'Visual mapping is not enabled for this organization';
  end if;
  if org.map_mode='gps' and (latitude_value not between -90 and 90 or longitude_value not between -180 and 180) then
    raise exception 'Choose a valid GPS location';
  end if;
  if org.map_mode<>'gps' and (latitude_value not between 0 and 100 or longitude_value not between 0 and 100) then
    raise exception 'Choose a location inside the site plan';
  end if;
  select data into private_data from public.record_private_data where record_id=r.id;
  private_data:=coalesce(private_data,'{}'::jsonb);
  select coalesce((field->>'publicVisible')::boolean,true) into location_public
  from jsonb_array_elements(org.collections) collection
  cross join jsonb_array_elements(coalesce(collection->'fields','[]'::jsonb)) field
  where collection->>'id'=r.collection_id
    and field->>'key' in ('location_code','location','storage_location','bin')
  order by case field->>'key' when 'location_code' then 0 when 'location' then 1 else 2 end
  limit 1;
  location_public:=coalesce(location_public,true);
  old_location:=coalesce(
    private_data->>'location_code',private_data->>'location',private_data->>'storage_location',private_data->>'bin',
    r.data->>'location_code',r.data->>'location',r.data->>'storage_location',r.data->>'bin'
  );
  updated_data:=r.data;
  if trim(coalesce(location_text,''))<>'' then
    if location_public then
      updated_data:=jsonb_set(updated_data,'{location_code}',to_jsonb(trim(location_text)),true);
      private_data:=private_data-'location_code'-'location'-'storage_location'-'bin';
    else
      updated_data:=updated_data-'location_code'-'location'-'storage_location'-'bin';
      private_data:=jsonb_set(private_data,'{location_code}',to_jsonb(trim(location_text)),true);
    end if;
    insert into public.record_private_data(record_id,organization_id,data,updated_by)
    values(r.id,r.organization_id,private_data,auth.uid())
    on conflict(record_id) do update set data=excluded.data,updated_at=now(),updated_by=excluded.updated_by;
  end if;
  insert into public.record_movements(
    organization_id,record_id,moved_by,actor_name,from_latitude,from_longitude,
    to_latitude,to_longitude,from_location,to_location,note
  ) values(
    r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),
    r.latitude,r.longitude,latitude_value,longitude_value,nullif(trim(old_location),''),
    nullif(trim(location_text),''),nullif(trim(note_text),'')
  );
  update public.records set
    latitude=latitude_value,longitude=longitude_value,location_source='manual_pin',
    data=updated_data,updated_at=now(),updated_by=auth.uid(),version=version+1
  where id=r.id;
  insert into public.inventory_transactions(
    organization_id,record_id,user_id,actor_name,event_type,quantity,
    before_quantity,after_quantity,note
  ) values(
    r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),
    'moved',0,r.quantity,r.quantity,
    concat_ws(' · ','Relocated item',nullif(trim(location_text),''),nullif(trim(note_text),''))
  );
  return jsonb_build_object('latitude',latitude_value,'longitude',longitude_value,'location',nullif(trim(location_text),''));
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
as $$
declare
  r public.records;
  after_amount numeric;
  changed_amount numeric;
  collection_kind text;
  next_availability text;
begin
  select * into r from public.records where id=target_record for update;
  if r.id is null then raise exception 'Inventory item not found'; end if;
  if not coalesce((select (features->>'inventory')::boolean from public.organizations where id=r.organization_id),true) then raise exception 'Inventory tracking is not enabled for this organization'; end if;
  if event_kind='sold' and not public.member_has_permission(r.organization_id,'usePos') then raise exception 'Checkout permission required'; end if;
  if event_kind<>'sold' and not public.member_has_permission(r.organization_id,'adjustInventory') then raise exception 'Inventory adjustment permission required'; end if;
  if event_kind not in ('added','used','counted','sold') then raise exception 'Choose received, used, sold, or counted'; end if;
  if quantity_value<0 or (event_kind<>'counted' and quantity_value=0) then raise exception 'Enter a valid quantity'; end if;
  if event_kind='sold' and trim(coalesce(counterparty_text,''))='' then raise exception 'Enter who the item was sold to'; end if;
  if event_kind='sold' and quantity_value>coalesce(r.quantity,0) then raise exception 'Not enough inventory is available for this sale'; end if;
  if event_kind='counted' then after_amount:=quantity_value;
  elsif event_kind='added' then after_amount:=coalesce(r.quantity,0)+quantity_value;
  else after_amount:=greatest(0,coalesce(r.quantity,0)-quantity_value); end if;
  changed_amount:=case when event_kind='counted' then abs(after_amount-coalesce(r.quantity,0)) else quantity_value end;
  select coalesce(collection->>'kind','consumable') into collection_kind
  from public.organizations organization_row
  cross join jsonb_array_elements(organization_row.collections) collection
  where organization_row.id=r.organization_id and collection->>'id'=r.collection_id
  limit 1;
  next_availability:=case
    when after_amount>0 then 'available'
    when coalesce(collection_kind,'consumable')='persistent' and event_kind='sold' then 'sold'
    when coalesce(collection_kind,'consumable')='persistent' then 'unavailable'
    else 'out_of_stock'
  end;
  insert into public.inventory_transactions(
    organization_id,record_id,user_id,actor_name,event_type,quantity,
    before_quantity,after_quantity,note,counterparty,reference_code
  ) values(
    r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),
    event_kind,changed_amount,r.quantity,after_amount,nullif(trim(note_text),''),
    case when event_kind='sold' then nullif(trim(counterparty_text),'') end,
    case when event_kind='sold' then nullif(trim(reference_text),'') end
  );
  update public.records set
    quantity=after_amount,availability_status=next_availability,
    updated_at=now(),updated_by=auth.uid(),version=version+1
  where id=r.id;
  insert into public.alerts(organization_id,alert_type,title,detail,record_id)
  values(
    r.organization_id,'inventory_'||event_kind,
    case when event_kind='sold' then 'Inventory sold: ' else 'Inventory updated: ' end||r.name,
    event_kind||' · '||quantity_value||coalesce(' '||r.unit,'')||
      case when event_kind='sold' then ' · Sold to '||trim(counterparty_text) else '' end||
      case when trim(reference_text)='' then '' else ' · '||trim(reference_text) end||
      case when trim(note_text)='' then '' else ' · '||trim(note_text) end,
    r.id
  );
  return after_amount;
end $$;

create or replace function public.record_inventory_use(target_record uuid, amount_used numeric, note_text text default '')
returns numeric language sql security definer set search_path=public
as $$ select public.adjust_inventory(target_record,amount_used,'used',note_text,'','') $$;

drop function if exists public.checkout_sale(uuid,jsonb,text,text,text,text,numeric,text);
create function public.checkout_sale(
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
  sale_id uuid:=gen_random_uuid();
  sale_code text;
  actor text:=coalesce(auth.jwt()->>'email','Team member');
  line jsonb;
  r public.records;
  line_quantity numeric;
  line_price numeric;
  line_amount numeric;
  next_quantity numeric;
  collection_kind text;
  next_availability text;
  current_sku text;
  calculated_subtotal numeric:=0;
  calculated_tax numeric:=0;
  calculated_total numeric:=0;
  safe_tax_rate numeric:=least(100,greatest(0,coalesce(tax_rate_value,0)));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.member_has_permission(target_organization,'usePos') then
    raise exception 'Checkout permission required';
  end if;
  if not coalesce((select (features->>'pos')::boolean from public.organizations where id=target_organization),true) then
    raise exception 'Checkout is not enabled for this organization';
  end if;
  if trim(coalesce(customer_text,''))='' then raise exception 'Enter a customer, company, or job'; end if;
  if jsonb_typeof(cart_items)<>'array' or jsonb_array_length(cart_items)=0 then raise exception 'Add at least one item'; end if;
  if exists(
    select 1 from jsonb_array_elements(cart_items) cart_line
    group by cart_line->>'record_id' having count(*)>1
  ) then raise exception 'Each checkout item can appear only once'; end if;

  perform 1 from public.records record_row
  where record_row.id in (
    select (cart_line->>'record_id')::uuid from jsonb_array_elements(cart_items) cart_line
  )
  order by record_row.id
  for update;

  sale_code:='MP-'||to_char(now(),'YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(sale_id::text,'-',''),1,6));
  insert into public.sales(
    id,organization_id,sale_number,customer_name,customer_contact,reference_code,
    payment_method,note,created_by,actor_name
  ) values(
    sale_id,target_organization,sale_code,trim(customer_text),nullif(trim(contact_text),''),
    nullif(trim(reference_text),''),coalesce(nullif(trim(payment_method_text),''),'invoice'),
    nullif(trim(note_text),''),auth.uid(),actor
  );

  for line in select value from jsonb_array_elements(cart_items)
  loop
    select * into r
    from public.records
    where id=(line->>'record_id')::uuid
      and organization_id=target_organization
      and status='active'
    for update;
    if r.id is null then raise exception 'A checkout item is no longer available'; end if;
    if r.quantity is null then raise exception '% is not quantity-tracked',r.name; end if;

    line_quantity:=nullif(line->>'quantity','')::numeric;
    line_price:=nullif(line->>'unit_price','')::numeric;
    if line_quantity is null or line_quantity<=0 then raise exception 'Enter a valid quantity for %',r.name; end if;
    if line_price is null or line_price<0 then raise exception 'Enter a valid unit price for %',r.name; end if;
    if line_quantity>r.quantity then raise exception 'Not enough inventory is available for %',r.name; end if;

    next_quantity:=r.quantity-line_quantity;
    select coalesce(collection->>'kind','consumable') into collection_kind
    from public.organizations organization_row
    cross join jsonb_array_elements(organization_row.collections) collection
    where organization_row.id=target_organization and collection->>'id'=r.collection_id
    limit 1;
    next_availability:=case
      when next_quantity>0 then 'available'
      when coalesce(collection_kind,'consumable')='persistent' then 'sold'
      else 'out_of_stock'
    end;
    line_amount:=round(line_quantity*line_price,2);
    select coalesce(private_data.data->>'sku',r.data->>'sku',r.data->>'asset_id')
      into current_sku
    from public.records record_row
    left join public.record_private_data private_data on private_data.record_id=record_row.id
    where record_row.id=r.id;

    insert into public.sale_items(
      sale_id,organization_id,record_id,item_name,sku,quantity,unit,unit_price,line_total
    ) values(
      sale_id,target_organization,r.id,r.name,nullif(trim(current_sku),''),line_quantity,
      r.unit,line_price,line_amount
    );
    insert into public.inventory_transactions(
      organization_id,record_id,user_id,actor_name,event_type,quantity,
      before_quantity,after_quantity,note,counterparty,reference_code
    ) values(
      target_organization,r.id,auth.uid(),actor,'sold',line_quantity,r.quantity,next_quantity,
      'Checkout '||sale_code,trim(customer_text),coalesce(nullif(trim(reference_text),''),sale_code)
    );
    update public.records
      set quantity=next_quantity,availability_status=next_availability,
        updated_at=now(),updated_by=auth.uid(),version=version+1
      where id=r.id;
    calculated_subtotal:=calculated_subtotal+line_amount;
  end loop;

  calculated_tax:=round(calculated_subtotal*safe_tax_rate/100,2);
  calculated_total:=calculated_subtotal+calculated_tax;
  update public.sales set
    subtotal=calculated_subtotal,tax_rate=safe_tax_rate,
    tax_amount=calculated_tax,total=calculated_total
  where id=sale_id;
  insert into public.alerts(organization_id,alert_type,title,detail)
  values(
    target_organization,'sale_completed','Checkout completed: '||sale_code,
    trim(customer_text)||' · '||calculated_total||' · '||actor
  );

  return jsonb_build_object(
    'id',sale_id,'sale_number',sale_code,'subtotal',calculated_subtotal,
    'tax_amount',calculated_tax,'total',calculated_total
  );
end $$;

grant select on public.sales,public.sale_items,public.record_movements to authenticated;
grant execute on function public.checkout_sale(uuid,jsonb,text,text,text,text,numeric,text) to authenticated;
grant execute on function public.move_record(uuid,double precision,double precision,text,text) to authenticated;

notify pgrst, 'reload schema';
