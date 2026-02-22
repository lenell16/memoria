-- Seed data for local development. Add inserts here as needed.
-- This file is loaded during `supabase db reset`.

-- Seed profiles for local development
insert into public.profiles (id, display_name, avatar_url)
values
  ('00000000-0000-0000-0000-000000000001', 'Dev User', null),
  ('00000000-0000-0000-0000-000000000002', 'Test User', null)
on conflict (id) do nothing;
