-- The coverage dashboard only talks to the database through its cov_* functions (with a token),
-- so signed-out visitors (role anon) need no direct table access. New tables had inherited it again.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Stop future tables in public from granting anon everything by default.
-- (Any table that really needs signed-out access must now be granted explicitly.)
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
