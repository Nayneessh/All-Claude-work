-- Defence in depth: Row Level Security already blocks these tables, but the API roles should not hold privileges they never need.
-- * allowed_emails (the sign-up whitelist) is managed only by the database owner / service role.
-- * TRUNCATE, REFERENCES and TRIGGER are not subject to RLS and are never needed through the API.
revoke all on public.allowed_emails from anon, authenticated;
do $$ declare t record; begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
