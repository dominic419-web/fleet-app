-- Add vehicles.status for admin-managed lifecycle state
-- Values: active | service | inactive
-- Archived remains on vehicles.archived

begin;

alter table public.vehicles
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehicles_status_check') then
    alter table public.vehicles
      add constraint vehicles_status_check
      check (status in ('active','service','inactive'));
  end if;
end $$;

create index if not exists vehicles_company_id_status_idx
  on public.vehicles(company_id, status);

commit;

