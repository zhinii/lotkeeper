-- Lightweight sales recording for inventory. This deliberately records the
-- stock movement and customer/job context without processing payments.
alter table public.inventory_transactions
  drop constraint if exists inventory_transactions_event_type_check;

alter table public.inventory_transactions
  add constraint inventory_transactions_event_type_check
    check (event_type in ('used','removed','added','counted','moved','sold')),
  add column if not exists counterparty text,
  add column if not exists reference_code text;

drop function if exists public.record_inventory_use(uuid,numeric,text);
drop function if exists public.adjust_inventory(uuid,numeric,text,text);
drop function if exists public.adjust_inventory(uuid,numeric,text,text,text,text);

create function public.adjust_inventory(
  target_record uuid,
  quantity_value numeric,
  event_kind text,
  note_text text default '',
  counterparty_text text default '',
  reference_text text default ''
)
returns numeric language plpgsql security definer set search_path=public
as $$
declare r public.records; after_amount numeric; changed_amount numeric;
begin
  select * into r from public.records where id=target_record for update;
  if r.id is null or not public.member_has_permission(r.organization_id,'adjustInventory') then
    raise exception 'Inventory adjustment permission required';
  end if;
  if event_kind not in ('added','used','counted','sold') then
    raise exception 'Choose received, used, sold, or counted';
  end if;
  if quantity_value<0 or (event_kind<>'counted' and quantity_value=0) then
    raise exception 'Enter a valid quantity';
  end if;
  if event_kind='sold' and trim(coalesce(counterparty_text,''))='' then
    raise exception 'Enter who the item was sold to';
  end if;
  if event_kind='sold' and quantity_value>coalesce(r.quantity,0) then
    raise exception 'Not enough inventory is available for this sale';
  end if;
  if event_kind='counted' then after_amount:=quantity_value;
  elsif event_kind='added' then after_amount:=coalesce(r.quantity,0)+quantity_value;
  else after_amount:=greatest(0,coalesce(r.quantity,0)-quantity_value);
  end if;
  changed_amount:=case when event_kind='counted' then abs(after_amount-coalesce(r.quantity,0)) else quantity_value end;

  insert into public.inventory_transactions(
    organization_id,record_id,user_id,actor_name,event_type,quantity,
    before_quantity,after_quantity,note,counterparty,reference_code
  ) values(
    r.organization_id,r.id,auth.uid(),coalesce(auth.jwt()->>'email','Team member'),
    event_kind,changed_amount,r.quantity,after_amount,nullif(trim(note_text),''),
    case when event_kind='sold' then nullif(trim(counterparty_text),'') end,
    case when event_kind='sold' then nullif(trim(reference_text),'') end
  );

  update public.records
  set quantity=after_amount,updated_at=now(),updated_by=auth.uid(),version=version+1
  where id=r.id;

  insert into public.alerts(organization_id,alert_type,title,detail,record_id)
  values(
    r.organization_id,
    'inventory_'||event_kind,
    case when event_kind='sold' then 'Inventory sold: ' else 'Inventory updated: ' end||r.name,
    event_kind||' · '||quantity_value||coalesce(' '||r.unit,'')||
      case when event_kind='sold' then ' · Sold to '||trim(counterparty_text) else '' end||
      case when trim(reference_text)='' then '' else ' · '||trim(reference_text) end||
      case when trim(note_text)='' then '' else ' · '||trim(note_text) end,
    r.id
  );
  return after_amount;
end $$;

create function public.record_inventory_use(
  target_record uuid,
  amount_used numeric,
  note_text text default ''
)
returns numeric language sql security definer set search_path=public
as $$ select public.adjust_inventory(target_record,amount_used,'used',note_text,'','') $$;

grant execute on function public.adjust_inventory(uuid,numeric,text,text,text,text) to authenticated;
grant execute on function public.record_inventory_use(uuid,numeric,text) to authenticated;

notify pgrst, 'reload schema';
