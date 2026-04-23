-- Vehicle image support
-- - vehicles.image_path stores storage object path in bucket `vehicle_images`
-- - admin-only writes to storage objects scoped by current company

begin;

alter table public.vehicles
  add column if not exists image_path text null;

-- Storage policies for bucket `vehicle_images`
-- Note: bucket is public, so images can be displayed via public URL.
-- These policies control authenticated API operations (upload/update/delete/list).

-- Read/list: company members can read object metadata for their company folder
drop policy if exists vehicle_images_select_member on storage.objects;
create policy vehicle_images_select_member on storage.objects
for select to authenticated
using (
  bucket_id = 'vehicle_images'
  and public.current_company_id() is not null
  and name like (public.current_company_id()::text || '/%')
  and public.is_company_member(public.current_company_id())
);

-- Insert: admins can upload into their company folder
drop policy if exists vehicle_images_insert_admin on storage.objects;
create policy vehicle_images_insert_admin on storage.objects
for insert to authenticated
with check (
  bucket_id = 'vehicle_images'
  and public.current_company_id() is not null
  and name like (public.current_company_id()::text || '/%')
  and public.is_company_admin(public.current_company_id())
);

-- Update: admins can overwrite objects in their company folder
drop policy if exists vehicle_images_update_admin on storage.objects;
create policy vehicle_images_update_admin on storage.objects
for update to authenticated
using (
  bucket_id = 'vehicle_images'
  and public.current_company_id() is not null
  and name like (public.current_company_id()::text || '/%')
  and public.is_company_admin(public.current_company_id())
)
with check (
  bucket_id = 'vehicle_images'
  and public.current_company_id() is not null
  and name like (public.current_company_id()::text || '/%')
  and public.is_company_admin(public.current_company_id())
);

-- Delete: admins can delete objects in their company folder
drop policy if exists vehicle_images_delete_admin on storage.objects;
create policy vehicle_images_delete_admin on storage.objects
for delete to authenticated
using (
  bucket_id = 'vehicle_images'
  and public.current_company_id() is not null
  and name like (public.current_company_id()::text || '/%')
  and public.is_company_admin(public.current_company_id())
);

commit;

