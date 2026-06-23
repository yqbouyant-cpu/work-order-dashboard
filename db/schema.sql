create table if not exists public.base_tickets (
  ticket_key text primary key,
  ticket_type text not null,
  ticket_no text not null,
  creator text,
  create_time date,
  document_status text,
  work_order_status text,
  region text,
  issue_summary text,
  material_code text,
  material_description text,
  age_days integer,
  raw_data jsonb,
  last_imported_at timestamptz,
  last_imported_by text,
  source_file_name text,
  created_at timestamptz not null default now()
);

create index if not exists idx_base_tickets_type
  on public.base_tickets (ticket_type);

create index if not exists idx_base_tickets_document_status
  on public.base_tickets (document_status);

create index if not exists idx_base_tickets_last_imported
  on public.base_tickets (last_imported_at desc);

create table if not exists public.manual_fields (
  id bigserial primary key,
  ticket_key text not null unique,
  ticket_type text not null,
  ticket_no text not null,
  risk_reason text,
  remark text,
  unclosed_reason text,
  blocker text,
  next_plan text,
  expected_close_at date,
  latest_progress text,
  has_blocker boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_fields_type
  on public.manual_fields (ticket_type);

create table if not exists public.project_followups (
  id text primary key,
  project_name text,
  related_tickets text,
  ticket_type text,
  current_stage text,
  progress integer,
  return_status text,
  analysis_conclusion text,
  responsibility_conclusion text,
  onsite_solution text,
  blocker text,
  next_action text,
  owner text,
  expected_finish_at date,
  latest_progress text,
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_project_followups_ticket_type
  on public.project_followups (ticket_type);

create table if not exists public.import_logs (
  id text primary key,
  imported_at timestamptz not null default now(),
  imported_by text,
  ticket_type text,
  file_name text,
  total_rows integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  ended_count integer not null default 0,
  preserved_manual_count integer not null default 0,
  status text,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_import_logs_imported_at
  on public.import_logs (imported_at desc);

-- GitHub Pages 免费试跑版本：前端使用 Supabase anon public key 直连。
-- 下面策略允许知道链接的人匿名读写，便于最快跑通多人协作。
-- 后续如果要做权限/登录，请删除这些 anon 策略，改为 authenticated + 用户权限策略。
alter table public.base_tickets enable row level security;
alter table public.manual_fields enable row level security;
alter table public.project_followups enable row level security;
alter table public.import_logs enable row level security;

grant usage on schema public to anon;
grant select, insert, update, delete on public.base_tickets to anon;
grant select, insert, update, delete on public.manual_fields to anon;
grant select, insert, update, delete on public.project_followups to anon;
grant select, insert, update, delete on public.import_logs to anon;
grant usage, select on sequence public.manual_fields_id_seq to anon;

drop policy if exists "anon read base_tickets" on public.base_tickets;
create policy "anon read base_tickets"
  on public.base_tickets for select
  to anon
  using (true);

drop policy if exists "anon insert base_tickets" on public.base_tickets;
create policy "anon insert base_tickets"
  on public.base_tickets for insert
  to anon
  with check (true);

drop policy if exists "anon update base_tickets" on public.base_tickets;
create policy "anon update base_tickets"
  on public.base_tickets for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anon read manual_fields" on public.manual_fields;
create policy "anon read manual_fields"
  on public.manual_fields for select
  to anon
  using (true);

drop policy if exists "anon insert manual_fields" on public.manual_fields;
create policy "anon insert manual_fields"
  on public.manual_fields for insert
  to anon
  with check (true);

drop policy if exists "anon update manual_fields" on public.manual_fields;
create policy "anon update manual_fields"
  on public.manual_fields for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anon read project_followups" on public.project_followups;
create policy "anon read project_followups"
  on public.project_followups for select
  to anon
  using (true);

drop policy if exists "anon insert project_followups" on public.project_followups;
create policy "anon insert project_followups"
  on public.project_followups for insert
  to anon
  with check (true);

drop policy if exists "anon update project_followups" on public.project_followups;
create policy "anon update project_followups"
  on public.project_followups for update
  to anon
  using (true)
  with check (true);

drop policy if exists "anon delete project_followups" on public.project_followups;
create policy "anon delete project_followups"
  on public.project_followups for delete
  to anon
  using (true);

drop policy if exists "anon read import_logs" on public.import_logs;
create policy "anon read import_logs"
  on public.import_logs for select
  to anon
  using (true);

drop policy if exists "anon insert import_logs" on public.import_logs;
create policy "anon insert import_logs"
  on public.import_logs for insert
  to anon
  with check (true);
