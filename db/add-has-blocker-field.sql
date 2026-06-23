-- Add an explicit blocker flag for manual ticket fields.
-- Safe to run multiple times in Supabase SQL Editor.

alter table if exists public.manual_fields
  add column if not exists has_blocker boolean default false;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'manual_fields'
      and column_name = 'has_blocker'
      and data_type <> 'boolean'
  ) then
    alter table public.manual_fields
      alter column has_blocker drop default;

    alter table public.manual_fields
      alter column has_blocker type boolean
      using (
        case
          when lower(coalesce(has_blocker::text, '')) in ('true', 't', '1', 'yes', 'y', '是', '有', '有卡点') then true
          else false
        end
      );
  end if;
end $$;

update public.manual_fields
set has_blocker = false
where has_blocker is null;

alter table if exists public.manual_fields
  alter column has_blocker set default false;

alter table if exists public.manual_fields
  alter column has_blocker set not null;

create unique index if not exists manual_fields_ticket_key_unique
  on public.manual_fields (ticket_key);

grant select, insert, update on public.manual_fields to anon, authenticated;
