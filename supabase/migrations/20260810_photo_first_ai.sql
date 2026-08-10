-- Supports cost-limited AI suggestions before a visitor submits the record.
create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  submission_id uuid references public.submissions(id) on delete set null,
  purpose text not null check (purpose in ('preview','submission')),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_org_created
  on public.ai_usage_events(organization_id,created_at desc);

alter table public.ai_usage_events enable row level security;
grant select,insert on public.ai_usage_events to service_role;
