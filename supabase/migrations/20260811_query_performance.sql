-- Match the application's highest-traffic organization and date queries.
-- These indexes preserve all existing data and review state.
create index if not exists records_org_status_updated
  on public.records(organization_id, status, updated_at desc);

create index if not exists records_org_updated
  on public.records(organization_id, updated_at desc);

create index if not exists submissions_org_submitted
  on public.submissions(organization_id, submitted_at desc);

create index if not exists record_private_org_record
  on public.record_private_data(organization_id, record_id);

create index if not exists alerts_org_created
  on public.alerts(organization_id, created_at desc);
