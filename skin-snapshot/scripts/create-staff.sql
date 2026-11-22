-- Adds a staff member. Steps:
--  1. Create the user in Supabase Auth (Dashboard > Authentication > Users > Add user), tick "Auto confirm".
--  2. Copy the user's UUID and run this, choosing the role ('admin' or 'cosmetologist').
--  3. The person signs in at /console and is asked to set up an authenticator app. Until they have, the
--     database refuses every console function (it requires a two-step-verified session).
insert into ss.staff (user_id, email, role)
values ('00000000-0000-0000-0000-000000000000', 'person@example.com', 'cosmetologist')
on conflict (user_id) do update set role = excluded.role, active = true;

-- To remove access:  update ss.staff set active = false where email = 'person@example.com';
