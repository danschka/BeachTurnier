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
drop policy if exists "members can delete their lobbies" on public.shared_tournaments;

revoke update, delete on public.shared_tournaments from anon, authenticated;

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
