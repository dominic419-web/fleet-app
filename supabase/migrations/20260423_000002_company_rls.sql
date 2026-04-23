-- Enable RLS + policies for companies + company_members

begin;

alter table public.companies enable row level security;
alter table public.company_members enable row level security;

-- Companies: members can select their companies
drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies
for select to authenticated
using (
  exists (
    select 1
    from public.company_members m
    where m.company_id = companies.id
      and m.auth_user_id = auth.uid()
      and m.status = 'active'
  )
);

-- Companies: only company admins can update/delete
drop policy if exists companies_admin_update on public.companies;
create policy companies_admin_update on public.companies
for update to authenticated
using (public.is_company_admin(companies.id))
with check (public.is_company_admin(companies.id));

drop policy if exists companies_admin_delete on public.companies;
create policy companies_admin_delete on public.companies
for delete to authenticated
using (public.is_company_admin(companies.id));

-- Optional: allow authenticated to create a new company where they become admin.
-- (Keep simple; app can also do this via service role.)
drop policy if exists companies_insert_self on public.companies;
create policy companies_insert_self on public.companies
for insert to authenticated
with check (created_by_auth_user_id = auth.uid());

-- company_members: users can read their own memberships
drop policy if exists company_members_select_self on public.company_members;
create policy company_members_select_self on public.company_members
for select to authenticated
using (auth_user_id = auth.uid());

-- company_members: admins can manage memberships in their company
drop policy if exists company_members_admin_all on public.company_members;
create policy company_members_admin_all on public.company_members
for all to authenticated
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

commit;

