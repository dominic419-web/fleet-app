-- Fix RLS recursion ("stack depth limit exceeded") caused by policies
-- that call helper functions which query RLS-protected tables (company_members).
--
-- Approach: make helper functions SECURITY DEFINER so membership/role checks
-- are evaluated without RLS recursion.

begin;

-- Ensure we have pgcrypto available (used elsewhere too)
create extension if not exists pgcrypto;

-- Recreate helper functions as SECURITY DEFINER to avoid RLS recursion.
-- These functions are created/owned by the migration role (typically postgres),
-- so they can read company_members regardless of RLS.

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
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
security definer
set search_path = public
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
security definer
set search_path = public
as $$
  select public.company_role(target_company_id) = 'admin';
$$;

commit;

