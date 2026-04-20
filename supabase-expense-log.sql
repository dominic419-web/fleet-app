-- Digital Fuel + Expense Log (manual + AI) - Supabase SQL
-- Creates:
-- - expense_entries: unified fuel/expense log
-- - expense_ai_jobs: receipt-processing jobs
-- Adds RLS policies for admin + driver (assigned vehicles) and storage.objects policies
-- for private bucket `expense-receipts`.
--
-- Prereq: public.current_driver_id() exists (see supabase-driver-docs.sql)

-- 1) Tables
create table if not exists public.expense_entries (
  id bigserial primary key,
  user_id uuid not null,
  vehicle_id bigint not null,
  driver_id bigint null,

  expense_type text not null,
  occurred_at timestamptz not null,

  station_name text null,
  station_location text null,
  odometer_km integer null,

  currency text not null default 'HUF',
  gross_amount numeric(12,2) not null,
  net_amount numeric(12,2) null,
  vat_amount numeric(12,2) null,
  vat_rate numeric(5,2) null,
  invoice_number text null,

  payment_method text null,
  payment_card_last4 text null,

  fuel_type text null,
  liters numeric(10,3) null,
  unit_price numeric(12,3) null,

  receipt_storage_path text null,
  receipt_mime text null,
  receipt_original_filename text null,

  status text not null default 'posted',
  ai_confidence numeric(5,2) null,
  ai_raw_json jsonb null,

  created_by_auth_user_id uuid not null default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expense_ai_jobs (
  id bigserial primary key,
  user_id uuid not null,
  vehicle_id bigint not null,
  driver_id bigint null,
  receipt_storage_path text not null,
  status text not null default 'queued',
  error_message text null,
  result_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Constraints
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expense_entries_type_check') then
    alter table public.expense_entries
      add constraint expense_entries_type_check
      check (expense_type in ('fuel','toll','parking','service','fluid','other'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expense_entries_status_check') then
    alter table public.expense_entries
      add constraint expense_entries_status_check
      check (status in ('posted','draft_ai','rejected'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expense_entries_currency_check') then
    alter table public.expense_entries
      add constraint expense_entries_currency_check
      check (char_length(currency) between 3 and 5);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expense_entries_payment_last4_check') then
    alter table public.expense_entries
      add constraint expense_entries_payment_last4_check
      check (payment_card_last4 is null or payment_card_last4 ~ '^[0-9]{4}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expense_entries_amounts_nonneg_check') then
    alter table public.expense_entries
      add constraint expense_entries_amounts_nonneg_check
      check (
        gross_amount >= 0
        and (net_amount is null or net_amount >= 0)
        and (vat_amount is null or vat_amount >= 0)
        and (odometer_km is null or odometer_km >= 0)
        and (liters is null or liters >= 0)
        and (unit_price is null or unit_price >= 0)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'expense_ai_jobs_status_check') then
    alter table public.expense_ai_jobs
      add constraint expense_ai_jobs_status_check
      check (status in ('queued','processing','succeeded','failed'));
  end if;
end $$;

create index if not exists expense_entries_user_id_occurred_at_idx
  on public.expense_entries(user_id, occurred_at desc);

create index if not exists expense_entries_vehicle_id_occurred_at_idx
  on public.expense_entries(vehicle_id, occurred_at desc);

create index if not exists expense_ai_jobs_user_id_created_at_idx
  on public.expense_ai_jobs(user_id, created_at desc);

create index if not exists expense_ai_jobs_receipt_path_idx
  on public.expense_ai_jobs(receipt_storage_path);

-- 3) updated_at triggers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_expense_entries_updated_at on public.expense_entries;
create trigger set_expense_entries_updated_at
before update on public.expense_entries
for each row execute function public.set_updated_at();

drop trigger if exists set_expense_ai_jobs_updated_at on public.expense_ai_jobs;
create trigger set_expense_ai_jobs_updated_at
before update on public.expense_ai_jobs
for each row execute function public.set_updated_at();

-- 4) RLS
alter table public.expense_entries enable row level security;
alter table public.expense_ai_jobs enable row level security;

-- Admin: full access within tenant
drop policy if exists expense_entries_admin_all on public.expense_entries;
create policy expense_entries_admin_all on public.expense_entries
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists expense_ai_jobs_admin_all on public.expense_ai_jobs;
create policy expense_ai_jobs_admin_all on public.expense_ai_jobs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Driver: read entries for assigned vehicles
drop policy if exists expense_entries_driver_select on public.expense_entries;
create policy expense_entries_driver_select on public.expense_entries
for select to authenticated
using (
  exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_entries.user_id
  )
);

-- Driver: insert entries for assigned vehicles; must set user_id to tenant and driver_id = current_driver_id()
drop policy if exists expense_entries_driver_insert on public.expense_entries;
create policy expense_entries_driver_insert on public.expense_entries
for insert to authenticated
with check (
  driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_entries.user_id
  )
);

-- Driver: update only AI drafts they created (finalize) and only for assigned vehicles
drop policy if exists expense_entries_driver_update_finalize on public.expense_entries;
create policy expense_entries_driver_update_finalize on public.expense_entries
for update to authenticated
using (
  status = 'draft_ai'
  and created_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_entries.user_id
  )
)
with check (
  status in ('draft_ai','posted','rejected')
  and created_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_entries.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_entries.user_id
  )
);

-- Driver: AI job select/insert for assigned vehicles (polling)
drop policy if exists expense_ai_jobs_driver_select on public.expense_ai_jobs;
create policy expense_ai_jobs_driver_select on public.expense_ai_jobs
for select to authenticated
using (
  driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_ai_jobs.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_ai_jobs.user_id
  )
);

drop policy if exists expense_ai_jobs_driver_insert on public.expense_ai_jobs;
create policy expense_ai_jobs_driver_insert on public.expense_ai_jobs
for insert to authenticated
with check (
  driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = expense_ai_jobs.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = expense_ai_jobs.user_id
  )
);

-- 5) Storage policies for private bucket `expense-receipts`
-- NOTE: Create bucket `expense-receipts` and set to Private in Supabase dashboard.

drop policy if exists expense_receipts_objects_read on storage.objects;
create policy expense_receipts_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and exists (
    select 1
    from public.expense_entries e
    join public.vehicles v on v.id = e.vehicle_id
    where e.receipt_storage_path = storage.objects.name
      and e.user_id = v.user_id
      and (
        e.user_id = auth.uid()
        or v.driver_id = public.current_driver_id()
      )
  )
);

-- Write/delete: admin only (tenant path: {userId}/...)
drop policy if exists expense_receipts_objects_write_owner on storage.objects;
create policy expense_receipts_objects_write_owner on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and split_part(name, '/', 1) = auth.uid()::text
);

-- Driver can upload receipts under tenant prefix for assigned vehicle
drop policy if exists expense_receipts_objects_write_driver on storage.objects;
create policy expense_receipts_objects_write_driver on storage.objects
for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and exists (
    select 1
    from public.vehicles v
    where v.driver_id = public.current_driver_id()
      and split_part(storage.objects.name, '/', 1) = v.user_id::text
      and split_part(storage.objects.name, '/', 2) = v.id::text
  )
);

drop policy if exists expense_receipts_objects_delete_owner on storage.objects;
create policy expense_receipts_objects_delete_owner on storage.objects
for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and split_part(name, '/', 1) = auth.uid()::text
);

