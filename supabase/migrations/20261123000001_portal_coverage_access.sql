-- Coverage access becomes a switch on the person, like Stock and DPR.
-- Before, a portal login only reached Coverage if an admin linked it to a row in cov_users, and there was no way
-- to create more of those rows, so nobody new could be given access. Now an admin turns Coverage on for a person
-- in the portal. cov_users and the direct Coverage sign-in stay as they are, and anyone already linked keeps access.

alter table public.portal_users
  add column if not exists coverage_access boolean not null default false;

-- Everyone who reached Coverage through a linked account keeps it.
update public.portal_users u
   set coverage_access = true
 where not u.coverage_access
   and u.coverage_user is not null
   and exists (select 1 from public.cov_users cv where cv.username = u.coverage_user and cv.active);

-- Who the coverage site sees after a portal sign-in: a linked account keeps its own username,
-- everyone else is known by their portal username.
create or replace function public.portal_coverage_identity()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
           'username', coalesce(cv.username, u.username),
           'name', coalesce(nullif(u.full_name, ''), cv.full_name, u.username))
    from public.portal_users u
    left join public.cov_users cv on cv.username = u.coverage_user and cv.active
   where u.id = auth.uid() and u.active
     and (u.coverage_access or cv.username is not null)
$function$;
revoke all on function public.portal_coverage_identity() from public, anon;
grant execute on function public.portal_coverage_identity() to authenticated;

create or replace function public.portal_me()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'id', u.id, 'username', u.username, 'full_name', u.full_name,
    'is_admin', u.is_admin, 'active', u.active,
    'csrc', case when c.id is not null and c.active then jsonb_build_object('role', c.role) end,
    'tasks', case when t.id is not null and t.active then jsonb_build_object('role', t.role) end,
    'dpr', case when u.dpr_role is not null then jsonb_build_object(
             'role', u.dpr_role, 'agent_name', u.dpr_agent_name, 'can_export', u.dpr_can_export) end,
    'coverage', case when u.coverage_access or (cv.username is not null and cv.active)
                     then jsonb_build_object('username', coalesce(cv.username, u.username)) end,
    'stock', case when u.stock_role is not null then jsonb_build_object('role', u.stock_role) end)
  from public.portal_users u
  left join public.csrc_app_users c on c.id = u.csrc_user_id
  left join public.task_list_profiles t on t.id = u.task_user_id
  left join public.cov_users cv on cv.username = u.coverage_user
  where u.id = auth.uid()
$function$;

-- The home screen's Coverage card follows the same rule. Patch the live definition rather than copy it,
-- and stop if the text it expects is not there.
do $patch$
declare d text;
begin
  select pg_get_functiondef('public.portal_home()'::regprocedure) into d;
  d := replace(d,
    'if me.coverage_user is not null and exists (select 1 from public.cov_users where username = me.coverage_user and active) then',
    'if me.coverage_access or (me.coverage_user is not null and exists (select 1 from public.cov_users where username = me.coverage_user and active)) then');
  if d not like '%me.coverage_access%' then
    raise exception 'portal_home was not patched: the Coverage condition was not found';
  end if;
  execute d;
end
$patch$;
