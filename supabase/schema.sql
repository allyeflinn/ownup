create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'New stylist',
  age_group text not null default '25-34',
  style_signal text not null default 'minimal street',
  created_at timestamptz not null default now()
);

create table if not exists public.closet_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text not null check (category in ('top', 'bottom', 'outerwear', 'shoe', 'accessory')),
  color text not null default '#1f6f78',
  image_url text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  caption text,
  image_url text,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  created_at timestamptz not null default now()
);

create table if not exists public.outfit_items (
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  closet_item_id uuid not null references public.closet_items(id) on delete cascade,
  primary key (outfit_id, closet_item_id)
);

create table if not exists public.outfit_saves (
  user_id uuid not null references auth.users(id) on delete cascade,
  outfit_id uuid not null references public.outfits(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, outfit_id)
);

alter table public.profiles enable row level security;
alter table public.closet_items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;
alter table public.outfit_saves enable row level security;

create policy "profiles are readable" on public.profiles
  for select using (true);

create policy "users update own profile" on public.profiles
  for update using (auth.uid() = id);

create policy "users insert own profile" on public.profiles
  for insert with check (auth.uid() = id);

create policy "users manage own closet" on public.closet_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "public outfits are readable" on public.outfits
  for select using (visibility = 'public' or auth.uid() = user_id);

create policy "users manage own outfits" on public.outfits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "outfit items readable for visible outfits" on public.outfit_items
  for select using (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and (outfits.visibility = 'public' or outfits.user_id = auth.uid())
    )
  );

create policy "users manage own outfit items" on public.outfit_items
  for all using (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and outfits.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.outfits
      where outfits.id = outfit_items.outfit_id
      and outfits.user_id = auth.uid()
    )
  );

create policy "users manage own saves" on public.outfit_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('closet-photos', 'closet-photos', true)
on conflict (id) do nothing;

create policy "closet photos are publicly readable" on storage.objects
  for select using (bucket_id = 'closet-photos');

create policy "users upload own closet photos" on storage.objects
  for insert with check (
    bucket_id = 'closet-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users update own closet photos" on storage.objects
  for update using (
    bucket_id = 'closet-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "users delete own closet photos" on storage.objects
  for delete using (
    bucket_id = 'closet-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
