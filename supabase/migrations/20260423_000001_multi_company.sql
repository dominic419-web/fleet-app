-- Multi-company (multi-tenant) foundation
-- - companies + company_members
-- - company_id added to current public tables and backfilled
-- - helper functions for RLS (current_company_id + role checks)
-- - updated RLS policies to use company membership + role
--
-- Notes:
-- - This migration keeps existing `user_id` columns for compatibility.
-- - Initial backfill sets companies.id = existing tenant `user_id` so Storage paths remain valid.
-- - You can later decouple company.id from user_id once the app fully uses company_id.

begin;

-- 0) Extensions (gen_random_uuid)
create extension if not exists pgcrypto;

-- 1) Core tables
create table if not exists public.companies (
  id uuid primary key,
  name text not null default '',
  created_at timestamptz not null default now(),
  created_by_auth_user_id uuid not null default auth.uid()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  auth_user_id uuid not null,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  invited_by_auth_user_id uuid null,
  primary key (company_id, auth_user_id),
  constraint company_members_role_check check (role in ('admin','driver')),
  constraint company_members_status_check check (status in ('invited','active','disabled'))
);

create index if not exists company_members_auth_user_id_idx on public.company_members(auth_user_id);

-- 2) Add company_id columns (nullable first)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='drivers' and column_name='company_id') then
    alter table public.drivers add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='vehicles' and column_name='company_id') then
    alter table public.vehicles add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='vehicle_documents' and column_name='company_id') then
    alter table public.vehicle_documents add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='journey_logs' and column_name='company_id') then
    alter table public.journey_logs add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='km_logs' and column_name='company_id') then
    alter table public.km_logs add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='expense_entries' and column_name='company_id') then
    alter table public.expense_entries add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='expense_ai_jobs' and column_name='company_id') then
    alter table public.expense_ai_jobs add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='service_history' and column_name='company_id') then
    alter table public.service_history add column company_id uuid null;
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='service_partners' and column_name='company_id') then
    alter table public.service_partners add column company_id uuid null;
  end if;
end $$;

-- 3) Backfill companies and company_id from existing tenant user_id
-- Create one company per tenant owner (existing pattern: rows have user_id).
insert into public.companies (id, name, created_by_auth_user_id)
select distinct
  t.user_id as id,
  coalesce(nullif('',''), 'Company ' || left(t.user_id::text, 8)) as name,
  t.user_id as created_by_auth_user_id
from (
  select user_id from public.vehicles
  union
  select user_id from public.drivers
  union
  select user_id from public.vehicle_documents
  union
  select user_id from public.km_logs
  union
  select user_id from public.expense_entries
  union
  select user_id from public.expense_ai_jobs
  union
  select user_id from public.journey_logs
  union
  select user_id from public.service_history
  union
  select user_id from public.service_partners
) t
where t.user_id is not null
on conflict (id) do nothing;

-- Owner becomes admin member of their company.
insert into public.company_members (company_id, auth_user_id, role, status, invited_by_auth_user_id)
select c.id, c.id, 'admin', 'active', c.id
from public.companies c
on conflict (company_id, auth_user_id) do nothing;

-- Existing drivers with auth accounts become driver members of the company they belong to (by drivers.user_id).
insert into public.company_members (company_id, auth_user_id, role, status, invited_by_auth_user_id)
select distinct d.user_id as company_id, d.auth_user_id, 'driver', 'active', d.user_id
from public.drivers d
where d.user_id is not null and d.auth_user_id is not null
on conflict (company_id, auth_user_id) do nothing;

-- Backfill company_id columns as tenant user_id (company id equals tenant user_id in phase 1)
update public.drivers set company_id = user_id where company_id is null and user_id is not null;
update public.vehicles set company_id = user_id where company_id is null and user_id is not null;
update public.vehicle_documents set company_id = user_id where company_id is null and user_id is not null;
update public.journey_logs set company_id = user_id where company_id is null and user_id is not null;
update public.km_logs set company_id = user_id where company_id is null and user_id is not null;
update public.expense_entries set company_id = user_id where company_id is null and user_id is not null;
update public.expense_ai_jobs set company_id = user_id where company_id is null and user_id is not null;
update public.service_history set company_id = user_id where company_id is null and user_id is not null;
update public.service_partners set company_id = user_id where company_id is null and user_id is not null;

-- 4) Constraints + indexes
alter table public.drivers alter column company_id set not null;
alter table public.vehicles alter column company_id set not null;
alter table public.vehicle_documents alter column company_id set not null;
alter table public.journey_logs alter column company_id set not null;
alter table public.km_logs alter column company_id set not null;
alter table public.expense_entries alter column company_id set not null;
alter table public.expense_ai_jobs alter column company_id set not null;
alter table public.service_history alter column company_id set not null;
alter table public.service_partners alter column company_id set not null;

do $$
begin
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='drivers_company_fk') then
    alter table public.drivers add constraint drivers_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='vehicles_company_fk') then
    alter table public.vehicles add constraint vehicles_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='vehicle_documents_company_fk') then
    alter table public.vehicle_documents add constraint vehicle_documents_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='journey_logs_company_fk') then
    alter table public.journey_logs add constraint journey_logs_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='km_logs_company_fk') then
    alter table public.km_logs add constraint km_logs_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='expense_entries_company_fk') then
    alter table public.expense_entries add constraint expense_entries_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='expense_ai_jobs_company_fk') then
    alter table public.expense_ai_jobs add constraint expense_ai_jobs_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='service_history_company_fk') then
    alter table public.service_history add constraint service_history_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
  if not exists (select 1 from information_schema.table_constraints where constraint_schema='public' and constraint_name='service_partners_company_fk') then
    alter table public.service_partners add constraint service_partners_company_fk foreign key (company_id) references public.companies(id) on delete cascade;
  end if;
end $$;

create index if not exists vehicles_company_id_idx on public.vehicles(company_id);
create index if not exists drivers_company_id_idx on public.drivers(company_id);
create index if not exists journey_logs_company_id_started_at_idx on public.journey_logs(company_id, started_at desc);
create index if not exists expense_entries_company_id_occurred_at_idx on public.expense_entries(company_id, occurred_at desc);

-- 5) Helper functions for RLS (JWT claim approach)
create or replace function public.current_company_id()
returns uuid
language sql
stable
as $$
  select nullif((auth.jwt() -> 'app_metadata' ->> 'company_id')::text, '')::uuid;
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = target_company_id
      and m.auth_user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.company_role(target_company_id uuid)
returns text
language sql
stable
as $$
  select m.role
  from public.company_members m
  where m.company_id = target_company_id
    and m.auth_user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select public.company_role(target_company_id) = 'admin';
$$;

-- Update current_driver_id() to be company-scoped
create or replace function public.current_driver_id()
returns bigint
language sql
stable
as $$
  select d.id
  from public.drivers d
  where d.auth_user_id = auth.uid()
    and d.company_id = public.current_company_id()
  limit 1;
$$;

-- 6) RLS policy refactor (drop old, create company-scoped)
-- Drivers table
drop policy if exists drivers_admin_crud on public.drivers;
drop policy if exists drivers_delete_own on public.drivers;
drop policy if exists drivers_insert_own on public.drivers;
drop policy if exists drivers_select_own on public.drivers;
drop policy if exists drivers_select_self on public.drivers;
drop policy if exists drivers_select_self_by_auth on public.drivers;
drop policy if exists drivers_update_own on public.drivers;

create policy drivers_admin_all on public.drivers
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy drivers_self_select on public.drivers
for select to authenticated
using (company_id = public.current_company_id() and auth_user_id = auth.uid());

-- Vehicles
drop policy if exists vehicles_admin_crud on public.vehicles;
drop policy if exists vehicles_admin_select on public.vehicles;
drop policy if exists vehicles_delete_own on public.vehicles;
drop policy if exists vehicles_driver_select on public.vehicles;
drop policy if exists vehicles_insert_own on public.vehicles;
drop policy if exists vehicles_select_assigned_driver on public.vehicles;
drop policy if exists vehicles_select_own on public.vehicles;
drop policy if exists vehicles_update_assigned_driver on public.vehicles;
drop policy if exists vehicles_update_own on public.vehicles;

create policy vehicles_admin_all on public.vehicles
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy vehicles_driver_select on public.vehicles
for select to authenticated
using (company_id = public.current_company_id() and driver_id = public.current_driver_id());

-- Journey logs
drop policy if exists journey_logs_admin_all on public.journey_logs;
drop policy if exists journey_logs_driver_insert_start on public.journey_logs;
drop policy if exists journey_logs_driver_select on public.journey_logs;
drop policy if exists journey_logs_driver_update_stop on public.journey_logs;

create policy journey_logs_admin_all on public.journey_logs
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy journey_logs_driver_select on public.journey_logs
for select to authenticated
using (
  company_id = public.current_company_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.company_id = journey_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy journey_logs_driver_insert_start on public.journey_logs
for insert to authenticated
with check (
  company_id = public.current_company_id()
  and ended_at is null
  and end_km is null
  and end_location is null
  and ended_by_auth_user_id is null
  and driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.company_id = journey_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy journey_logs_driver_update_stop on public.journey_logs
for update to authenticated
using (
  company_id = public.current_company_id()
  and ended_at is null
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.company_id = journey_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
)
with check (
  company_id = public.current_company_id()
  and ended_at is not null
  and end_km is not null
  and end_location is not null
  and ended_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.company_id = journey_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

-- Expense entries + AI jobs
drop policy if exists expense_entries_admin_all on public.expense_entries;
drop policy if exists expense_entries_driver_insert on public.expense_entries;
drop policy if exists expense_entries_driver_select on public.expense_entries;
drop policy if exists expense_entries_driver_update_finalize on public.expense_entries;

create policy expense_entries_admin_all on public.expense_entries
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy expense_entries_driver_select on public.expense_entries
for select to authenticated
using (
  company_id = public.current_company_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.company_id = expense_entries.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy expense_entries_driver_insert on public.expense_entries
for insert to authenticated
with check (
  company_id = public.current_company_id()
  and driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.company_id = expense_entries.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy expense_entries_driver_update_finalize on public.expense_entries
for update to authenticated
using (
  company_id = public.current_company_id()
  and status = 'draft_ai'
  and created_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.company_id = expense_entries.company_id
      and v.driver_id = public.current_driver_id()
  )
)
with check (
  company_id = public.current_company_id()
  and status in ('draft_ai','posted','rejected')
  and created_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.company_id = expense_entries.company_id
      and v.driver_id = public.current_driver_id()
  )
);

drop policy if exists expense_ai_jobs_admin_all on public.expense_ai_jobs;
drop policy if exists expense_ai_jobs_driver_insert on public.expense_ai_jobs;
drop policy if exists expense_ai_jobs_driver_select on public.expense_ai_jobs;

create policy expense_ai_jobs_admin_all on public.expense_ai_jobs
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy expense_ai_jobs_driver_select on public.expense_ai_jobs
for select to authenticated
using (
  company_id = public.current_company_id()
  and driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_ai_jobs.vehicle_id
      and v.company_id = expense_ai_jobs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy expense_ai_jobs_driver_insert on public.expense_ai_jobs
for insert to authenticated
with check (
  company_id = public.current_company_id()
  and driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_ai_jobs.vehicle_id
      and v.company_id = expense_ai_jobs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

-- km_logs
-- We keep admin-all and driver-insert/select pattern; remove overlapping old policies first.
drop policy if exists km_logs_delete_own on public.km_logs;
drop policy if exists km_logs_delete_vehicle_owner on public.km_logs;
drop policy if exists km_logs_insert_assigned_driver on public.km_logs;
drop policy if exists km_logs_insert_own on public.km_logs;
drop policy if exists km_logs_select_assigned_driver on public.km_logs;
drop policy if exists km_logs_select_own on public.km_logs;
drop policy if exists km_logs_select_vehicle_owner on public.km_logs;
drop policy if exists km_logs_update_own on public.km_logs;

create policy km_logs_admin_all on public.km_logs
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy km_logs_driver_select on public.km_logs
for select to authenticated
using (
  company_id = public.current_company_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = km_logs.vehicle_id
      and v.company_id = km_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

create policy km_logs_driver_insert on public.km_logs
for insert to authenticated
with check (
  company_id = public.current_company_id()
  and driver_id = public.current_driver_id()
  and source = 'driver'
  and exists (
    select 1
    from public.vehicles v
    where v.id = km_logs.vehicle_id
      and v.company_id = km_logs.company_id
      and v.driver_id = public.current_driver_id()
  )
);

-- service_history + service_partners: admin-only within company (matches current admin UX)
drop policy if exists service_history_delete_own on public.service_history;
drop policy if exists service_history_insert_own on public.service_history;
drop policy if exists service_history_select_own on public.service_history;
drop policy if exists service_history_update_own on public.service_history;

create policy service_history_admin_all on public.service_history
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

drop policy if exists service_partners_delete_own on public.service_partners;
drop policy if exists service_partners_insert_own on public.service_partners;
drop policy if exists service_partners_select_own on public.service_partners;
drop policy if exists service_partners_update_own on public.service_partners;

create policy service_partners_admin_all on public.service_partners
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

-- vehicle_documents: admin all + driver select registration
drop policy if exists vehicle_documents_admin_all on public.vehicle_documents;
drop policy if exists vehicle_documents_delete_own on public.vehicle_documents;
drop policy if exists vehicle_documents_driver_select_registration on public.vehicle_documents;
drop policy if exists vehicle_documents_insert_own on public.vehicle_documents;
drop policy if exists vehicle_documents_select_own on public.vehicle_documents;
drop policy if exists vehicle_documents_update_own on public.vehicle_documents;

create policy vehicle_documents_admin_all on public.vehicle_documents
for all to authenticated
using (company_id = public.current_company_id() and public.is_company_admin(company_id))
with check (company_id = public.current_company_id() and public.is_company_admin(company_id));

create policy vehicle_documents_driver_select_registration on public.vehicle_documents
for select to authenticated
using (
  company_id = public.current_company_id()
  and doc_key = 'registration'
  and exists (
    select 1
    from public.vehicles v
    where v.id = vehicle_documents.vehicle_id
      and v.company_id = vehicle_documents.company_id
      and v.driver_id = public.current_driver_id()
  )
);

commit;

