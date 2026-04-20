-- Driver documents + cleaner UI (Supabase SQL)
-- This script secures vehicle documents for drivers:
-- - Adds storage_path to vehicle_documents
-- - Enables RLS and adds policies for admin (owner) + assigned drivers
-- - Adds storage.objects policies for private bucket `vehicle-documents`

-- 1) Schema: add storage_path
alter table public.vehicle_documents
  add column if not exists storage_path text;

create index if not exists vehicle_documents_storage_path_idx
  on public.vehicle_documents(storage_path);

-- Optional: keep doc_key constrained
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vehicle_documents_doc_key_check'
  ) then
    alter table public.vehicle_documents
      add constraint vehicle_documents_doc_key_check
      check (doc_key in ('registration','insurance','inspection','service'));
  end if;
end $$;

-- 2) Backfill storage_path from legacy public URLs (safe to run multiple times)
update public.vehicle_documents
set storage_path = regexp_replace(file_url,
  '^.*?/storage/v1/object/public/vehicle-documents/','')
where (storage_path is null or storage_path = '')
  and file_url is not null
  and file_url like '%/storage/v1/object/public/vehicle-documents/%';

-- 3) Helper function: current_driver_id (keeps policies readable)
create or replace function public.current_driver_id()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select d.id
  from public.drivers d
  where d.auth_user_id = auth.uid()
  limit 1;
$$;

revoke all on function public.current_driver_id() from public;
grant execute on function public.current_driver_id() to authenticated;

-- 4) Enable RLS
alter table public.drivers enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_documents enable row level security;

-- 5) RLS policies
-- drivers
drop policy if exists drivers_select_self on public.drivers;
create policy drivers_select_self on public.drivers
for select to authenticated
using (auth_user_id = auth.uid());

drop policy if exists drivers_admin_crud on public.drivers;
create policy drivers_admin_crud on public.drivers
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- vehicles
drop policy if exists vehicles_admin_select on public.vehicles;
create policy vehicles_admin_select on public.vehicles
for select to authenticated
using (user_id = auth.uid());

drop policy if exists vehicles_driver_select on public.vehicles;
create policy vehicles_driver_select on public.vehicles
for select to authenticated
using (driver_id = public.current_driver_id());

drop policy if exists vehicles_admin_crud on public.vehicles;
create policy vehicles_admin_crud on public.vehicles
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- vehicle_documents
drop policy if exists vehicle_documents_admin_all on public.vehicle_documents;
create policy vehicle_documents_admin_all on public.vehicle_documents
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists vehicle_documents_driver_select_registration on public.vehicle_documents;
create policy vehicle_documents_driver_select_registration on public.vehicle_documents
for select to authenticated
using (
  doc_key = 'registration'
  and exists (
    select 1
    from public.vehicles v
    where v.id = vehicle_documents.vehicle_id
      and v.driver_id = public.current_driver_id()
  )
);

-- 6) Storage policies for private bucket `vehicle-documents`
-- NOTE: first set the bucket to Private in the Supabase dashboard.

drop policy if exists vehicle_documents_objects_read on storage.objects;
create policy vehicle_documents_objects_read on storage.objects
for select to authenticated
using (
  bucket_id = 'vehicle-documents'
  and exists (
    select 1
    from public.vehicle_documents d
    join public.vehicles v on v.id = d.vehicle_id
    where d.storage_path = storage.objects.name
      and (
        d.user_id = auth.uid()
        or v.driver_id = public.current_driver_id()
      )
  )
);

drop policy if exists vehicle_documents_objects_write_owner on storage.objects;
create policy vehicle_documents_objects_write_owner on storage.objects
for insert to authenticated
with check (
  bucket_id = 'vehicle-documents'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists vehicle_documents_objects_delete_owner on storage.objects;
create policy vehicle_documents_objects_delete_owner on storage.objects
for delete to authenticated
using (
  bucket_id = 'vehicle-documents'
  and split_part(name, '/', 1) = auth.uid()::text
);

