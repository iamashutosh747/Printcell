-- 1. Anyone holding the public key could read the old balances table.
drop policy if exists "Allow public read access" on public.dpr_customer_balances;

-- 2. Signed-out visitors (role anon) never query tables directly:
--    DPR goes through access-code functions; CSRC, Tasks and the portal sign in first.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 3. Helpers that only signed-in users (and row-level-security policies) need.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_manager', 'auth_role', 'auth_engineer_id', 'create_service_assignment',
                        'guard_service_update', 'set_updated_at')
  loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
