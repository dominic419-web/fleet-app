-- NAV journey log (útnyilvántartás) - Supabase SQL
-- Creates journey_logs with RLS for:
-- - Admin/owner (tenant): full CRUD within their user_id
-- - Driver: start/stop only for assigned vehicles (vehicles.driver_id = current_driver_id())

-- Prereq: public.current_driver_id() exists (created in supabase-driver-docs.sql)

-- 1) Table
create table if not exists public.journey_logs (
  id bigserial primary key,
  user_id uuid not null,
  vehicle_id bigint not null,
  driver_id bigint null,

  started_at timestamptz not null,
  ended_at timestamptz null,

  start_km integer not null,
  end_km integer null,

  start_location text not null,
  end_location text null,

  trip_type text not null,
  note text null,

  created_by_auth_user_id uuid not null default auth.uid(),
  ended_by_auth_user_id uuid null,

  updated_at timestamptz not null default now()
);

-- 2) Constraints
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'journey_logs_trip_type_check') then
    alter table public.journey_logs
      add constraint journey_logs_trip_type_check
      check (trip_type in ('business','private'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'journey_logs_end_after_start_check') then
    alter table public.journey_logs
      add constraint journey_logs_end_after_start_check
      check (ended_at is null or ended_at >= started_at);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'journey_logs_end_km_check') then
    alter table public.journey_logs
      add constraint journey_logs_end_km_check
      check (end_km is null or end_km >= start_km);
  end if;
end $$;

create index if not exists journey_logs_user_id_started_at_idx
  on public.journey_logs(user_id, started_at desc);

create index if not exists journey_logs_vehicle_id_started_at_idx
  on public.journey_logs(vehicle_id, started_at desc);

-- Only one active journey per vehicle
create unique index if not exists journey_logs_one_active_per_vehicle
  on public.journey_logs(vehicle_id)
  where ended_at is null;

-- Optional foreign keys (enable only if your ids/types match exactly)
-- alter table public.journey_logs
--   add constraint journey_logs_vehicle_fk foreign key (vehicle_id) references public.vehicles(id) on delete cascade;
-- alter table public.journey_logs
--   add constraint journey_logs_driver_fk foreign key (driver_id) references public.drivers(id) on delete set null;

-- 3) RLS
alter table public.journey_logs enable row level security;

-- Admin/owner: full CRUD within tenant
drop policy if exists journey_logs_admin_all on public.journey_logs;
create policy journey_logs_admin_all on public.journey_logs
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Driver: read journeys for assigned vehicles
drop policy if exists journey_logs_driver_select on public.journey_logs;
create policy journey_logs_driver_select on public.journey_logs
for select to authenticated
using (
  exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.driver_id = public.current_driver_id()
  )
);

-- Driver: start journey (insert) for assigned vehicle, must be active (ended_at null)
drop policy if exists journey_logs_driver_insert_start on public.journey_logs;
create policy journey_logs_driver_insert_start on public.journey_logs
for insert to authenticated
with check (
  ended_at is null
  and end_km is null
  and end_location is null
  and ended_by_auth_user_id is null
  and driver_id = public.current_driver_id()
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = journey_logs.user_id
  )
);

-- Driver: stop journey (update) only for assigned vehicle; must close an active journey
drop policy if exists journey_logs_driver_update_stop on public.journey_logs;
create policy journey_logs_driver_update_stop on public.journey_logs
for update to authenticated
using (
  ended_at is null
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = journey_logs.user_id
  )
)
with check (
  ended_at is not null
  and end_km is not null
  and end_location is not null
  and ended_by_auth_user_id = auth.uid()
  and exists (
    select 1
    from public.vehicles v
    where v.id = journey_logs.vehicle_id
      and v.driver_id = public.current_driver_id()
      and v.user_id = journey_logs.user_id
  )
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_journey_logs_updated_at on public.journey_logs;
create trigger set_journey_logs_updated_at
before update on public.journey_logs
for each row execute function public.set_updated_at();

