create table if not exists public.profile_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

alter table public.profile_follows enable row level security;

drop policy if exists "users read own follows" on public.profile_follows;
drop policy if exists "users manage own follows" on public.profile_follows;

create policy "users read own follows" on public.profile_follows
  for select using (auth.uid() = follower_id);

create policy "users manage own follows" on public.profile_follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);
