-- GitHub Pages + Supabase Free trial policies.
-- Purpose: allow the browser Supabase anon/publishable key to read and write shared dashboard data.
-- This is for quick field trial only. Tighten these policies before publishing sensitive data.

alter table public.base_tickets enable row level security;
alter table public.manual_fields enable row level security;
alter table public.project_followups enable row level security;
alter table public.import_logs enable row level security;

create unique index if not exists manual_fields_ticket_key_unique
  on public.manual_fields (ticket_key);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.base_tickets to anon, authenticated;
grant select, insert, update, delete on public.manual_fields to anon, authenticated;
grant select, insert, update, delete on public.project_followups to anon, authenticated;
grant select, insert, update, delete on public.import_logs to anon, authenticated;

do $$
begin
  if to_regclass('public.manual_fields_id_seq') is not null then
    grant usage, select on sequence public.manual_fields_id_seq to anon, authenticated;
  end if;
end $$;

drop policy if exists "trial read base_tickets" on public.base_tickets;
create policy "trial read base_tickets"
  on public.base_tickets for select
  to anon, authenticated
  using (true);

drop policy if exists "trial insert base_tickets" on public.base_tickets;
create policy "trial insert base_tickets"
  on public.base_tickets for insert
  to anon, authenticated
  with check (true);

drop policy if exists "trial update base_tickets" on public.base_tickets;
create policy "trial update base_tickets"
  on public.base_tickets for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "trial read manual_fields" on public.manual_fields;
create policy "trial read manual_fields"
  on public.manual_fields for select
  to anon, authenticated
  using (true);

drop policy if exists "trial insert manual_fields" on public.manual_fields;
create policy "trial insert manual_fields"
  on public.manual_fields for insert
  to anon, authenticated
  with check (true);

drop policy if exists "trial update manual_fields" on public.manual_fields;
create policy "trial update manual_fields"
  on public.manual_fields for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "trial read project_followups" on public.project_followups;
create policy "trial read project_followups"
  on public.project_followups for select
  to anon, authenticated
  using (true);

drop policy if exists "trial insert project_followups" on public.project_followups;
create policy "trial insert project_followups"
  on public.project_followups for insert
  to anon, authenticated
  with check (true);

drop policy if exists "trial update project_followups" on public.project_followups;
create policy "trial update project_followups"
  on public.project_followups for update
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "trial delete project_followups" on public.project_followups;
create policy "trial delete project_followups"
  on public.project_followups for delete
  to anon, authenticated
  using (true);

drop policy if exists "trial read import_logs" on public.import_logs;
create policy "trial read import_logs"
  on public.import_logs for select
  to anon, authenticated
  using (true);

drop policy if exists "trial insert import_logs" on public.import_logs;
create policy "trial insert import_logs"
  on public.import_logs for insert
  to anon, authenticated
  with check (true);
