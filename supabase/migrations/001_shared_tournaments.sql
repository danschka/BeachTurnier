create extension if not exists pgcrypto;

create table if not exists public.shared_tournaments (
  id uuid primary key default gen_random_uuid(),
  share_code text not null unique,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'deleted')),
  state jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shared_lobby_members (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.shared_tournaments(id) on delete cascade,
  user_id uuid not null,
  joined_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);

create index if not exists shared_lobby_members_tournament_user_idx
  on public.shared_lobby_members (tournament_id, user_id);

create index if not exists shared_lobby_members_user_tournament_idx
  on public.shared_lobby_members (user_id, tournament_id);

create or replace function public.touch_shared_tournament()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.version = coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists shared_tournaments_touch on public.shared_tournaments;
create trigger shared_tournaments_touch
before update on public.shared_tournaments
for each row
execute function public.touch_shared_tournament();

create or replace function public.create_shared_lobby(
  p_share_code text,
  p_name text,
  p_state jsonb default '{}'::jsonb,
  p_config jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  share_code text,
  name text,
  config jsonb,
  status text,
  state jsonb,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament public.shared_tournaments;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  insert into public.shared_tournaments (share_code, name, state, config)
  values (p_share_code, coalesce(nullif(trim(p_name), ''), 'Shared Tournament'), coalesce(p_state, '{}'::jsonb), coalesce(p_config, '{}'::jsonb))
  returning * into v_tournament;

  insert into public.shared_lobby_members (tournament_id, user_id)
  values (v_tournament.id, auth.uid())
  on conflict (tournament_id, user_id) do nothing;

  return query
  select st.id, st.share_code, st.name, st.config, st.status, st.state, st.version, st.created_at, st.updated_at
  from public.shared_tournaments st
  where st.id = v_tournament.id;
end;
$$;

create or replace function public.join_shared_lobby(p_share_code text)
returns table (
  id uuid,
  share_code text,
  name text,
  config jsonb,
  status text,
  state jsonb,
  version bigint,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament public.shared_tournaments;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
  into v_tournament
  from public.shared_tournaments st
  where st.share_code = p_share_code
    and st.status = 'active';

  if v_tournament.id is null then
    raise exception 'Shared lobby not found';
  end if;

  insert into public.shared_lobby_members (tournament_id, user_id)
  values (v_tournament.id, auth.uid())
  on conflict (tournament_id, user_id) do nothing;

  return query
  select st.id, st.share_code, st.name, st.config, st.status, st.state, st.version, st.created_at, st.updated_at
  from public.shared_tournaments st
  where st.id = v_tournament.id;
end;
$$;

grant execute on function public.create_shared_lobby(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.join_shared_lobby(text) to anon, authenticated;

grant select, update, delete on public.shared_tournaments to anon, authenticated;
grant select, delete on public.shared_lobby_members to anon, authenticated;

alter table public.shared_tournaments enable row level security;
alter table public.shared_lobby_members enable row level security;

drop policy if exists "members can read their lobbies" on public.shared_tournaments;
create policy "members can read their lobbies"
on public.shared_tournaments
for select
using (
  exists (
    select 1
    from public.shared_lobby_members m
    where m.tournament_id = shared_tournaments.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "members can update their lobbies" on public.shared_tournaments;
create policy "members can update their lobbies"
on public.shared_tournaments
for update
using (
  exists (
    select 1
    from public.shared_lobby_members m
    where m.tournament_id = shared_tournaments.id
      and m.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.shared_lobby_members m
    where m.tournament_id = shared_tournaments.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "members can delete their lobbies" on public.shared_tournaments;
create policy "members can delete their lobbies"
on public.shared_tournaments
for delete
using (
  exists (
    select 1
    from public.shared_lobby_members m
    where m.tournament_id = shared_tournaments.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "members can read lobby members" on public.shared_lobby_members;
create policy "members can read lobby members"
on public.shared_lobby_members
for select
using (user_id = auth.uid());

drop policy if exists "members can leave their lobby" on public.shared_lobby_members;
create policy "members can leave their lobby"
on public.shared_lobby_members
for delete
using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'shared_tournaments'
  ) then
    alter publication supabase_realtime add table public.shared_tournaments;
  end if;
end;
$$;
