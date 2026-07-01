alter table public.shared_lobby_members
  add column if not exists role text not null default 'player'
  check (role in ('host', 'player'));

with first_members as (
  select distinct on (tournament_id) id
  from public.shared_lobby_members
  order by tournament_id, joined_at, id
)
update public.shared_lobby_members m
set role = 'host'
from first_members fm
where m.id = fm.id
  and m.role <> 'host';

create or replace function public.shared_lobby_return_row(
  p_tournament_id uuid,
  p_member_role text
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
language sql
security definer
set search_path = public
as $$
  select
    st.id,
    st.share_code,
    st.name,
    coalesce(st.config, '{}'::jsonb) || jsonb_build_object('memberRole', p_member_role),
    st.status,
    st.state,
    st.version,
    st.created_at,
    st.updated_at
  from public.shared_tournaments st
  where st.id = p_tournament_id;
$$;

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
  values (
    p_share_code,
    coalesce(nullif(trim(p_name), ''), 'Shared Tournament'),
    jsonb_set(coalesce(p_state, '{}'::jsonb), '{playerOwners}', coalesce(p_state->'playerOwners', '{}'::jsonb), true),
    coalesce(p_config, '{}'::jsonb)
  )
  returning * into v_tournament;

  insert into public.shared_lobby_members (tournament_id, user_id, role)
  values (v_tournament.id, auth.uid(), 'host')
  on conflict (tournament_id, user_id) do update set role = 'host';

  return query select * from public.shared_lobby_return_row(v_tournament.id, 'host');
end;
$$;

drop function if exists public.join_shared_lobby(text);

create function public.join_shared_lobby(p_share_code text)
returns setof public.shared_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tournament public.shared_tournaments;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select st.*
  into v_tournament
  from public.shared_tournaments st
  where st.share_code = p_share_code
    and st.status = 'active';

  if v_tournament.id is null then
    raise exception 'Shared lobby not found';
  end if;

  insert into public.shared_lobby_members (tournament_id, user_id, role)
  values (v_tournament.id, auth.uid(), 'player')
  on conflict (tournament_id, user_id) do nothing;

  select role
  into v_role
  from public.shared_lobby_members
  where tournament_id = v_tournament.id
    and user_id = auth.uid();

  return query
  select
    row.id,
    row.share_code,
    row.name,
    row.config,
    row.status,
    row.state,
    row.version,
    row.created_at,
    row.updated_at
  from public.shared_lobby_return_row(v_tournament.id, coalesce(v_role, 'player')) row;
end;
$$;

create or replace function public.current_shared_lobby_role(p_tournament_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select role
  from public.shared_lobby_members
  where tournament_id = p_tournament_id
    and user_id = auth.uid()
  limit 1;
$$;

create or replace function public.save_shared_lobby_as_host(
  p_tournament_id uuid,
  p_expected_version bigint,
  p_name text,
  p_state jsonb
)
returns setof public.shared_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tournament public.shared_tournaments;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_role := public.current_shared_lobby_role(p_tournament_id);
  if v_role <> 'host' then
    raise exception 'Only the tournament host can change this part of the lobby';
  end if;

  update public.shared_tournaments st
  set
    name = coalesce(nullif(trim(p_name), ''), 'Shared Tournament'),
    state = jsonb_set(coalesce(p_state, '{}'::jsonb), '{playerOwners}', coalesce(p_state->'playerOwners', '{}'::jsonb), true)
  where st.id = p_tournament_id
    and (p_expected_version is null or st.version = p_expected_version)
  returning * into v_tournament;

  if v_tournament.id is null then
    raise exception 'Shared lobby was changed in another session';
  end if;

  return query select * from public.shared_lobby_return_row(v_tournament.id, 'host');
end;
$$;

create or replace function public.add_shared_player(
  p_tournament_id uuid,
  p_player_name text
)
returns setof public.shared_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tournament public.shared_tournaments;
  v_name text := nullif(trim(p_player_name), '');
  v_players jsonb;
  v_owners jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_name is null then
    raise exception 'Player name is required';
  end if;

  v_role := public.current_shared_lobby_role(p_tournament_id);
  if v_role is null then
    raise exception 'Lobby membership required';
  end if;

  select * into v_tournament
  from public.shared_tournaments
  where id = p_tournament_id
  for update;

  if v_role <> 'host' and v_tournament.state ? 'tournament' and v_tournament.state->'tournament' <> 'null'::jsonb then
    raise exception 'Players cannot change the participant list after teams were drawn';
  end if;

  v_players := coalesce(v_tournament.state->'players', '[]'::jsonb);
  if jsonb_array_length(v_players) >= 12 then
    raise exception 'The participant list is already full';
  end if;
  if exists (select 1 from jsonb_array_elements_text(v_players) as players(player_name) where player_name = v_name) then
    raise exception 'Player name already exists';
  end if;

  v_owners := coalesce(v_tournament.state->'playerOwners', '{}'::jsonb);
  if v_role <> 'host' then
    if exists (
      select 1
      from jsonb_each_text(v_owners) owner_entry(player_name, user_id)
      where owner_entry.user_id = auth.uid()::text
    ) then
      raise exception 'This browser already registered a player name';
    end if;
    v_owners := jsonb_set(v_owners, array[v_name], to_jsonb(auth.uid()::text), true);
  end if;

  update public.shared_tournaments
  set state = jsonb_set(
    jsonb_set(v_tournament.state, '{players}', v_players || to_jsonb(v_name), true),
    '{playerOwners}',
    v_owners,
    true
  )
  where id = p_tournament_id
  returning * into v_tournament;

  return query select * from public.shared_lobby_return_row(v_tournament.id, v_role);
end;
$$;

create or replace function public.remove_shared_player(
  p_tournament_id uuid,
  p_player_name text
)
returns setof public.shared_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tournament public.shared_tournaments;
  v_name text := nullif(trim(p_player_name), '');
  v_players jsonb;
  v_owners jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_name is null then
    raise exception 'Player name is required';
  end if;

  v_role := public.current_shared_lobby_role(p_tournament_id);
  if v_role is null then
    raise exception 'Lobby membership required';
  end if;

  select * into v_tournament
  from public.shared_tournaments
  where id = p_tournament_id
  for update;

  if v_role <> 'host' and v_tournament.state ? 'tournament' and v_tournament.state->'tournament' <> 'null'::jsonb then
    raise exception 'Players cannot change the participant list after teams were drawn';
  end if;

  v_owners := coalesce(v_tournament.state->'playerOwners', '{}'::jsonb);
  if v_role <> 'host' and v_owners->>v_name <> auth.uid()::text then
    raise exception 'Players can only remove their own name';
  end if;

  select coalesce(jsonb_agg(to_jsonb(player_name)), '[]'::jsonb)
  into v_players
  from jsonb_array_elements_text(coalesce(v_tournament.state->'players', '[]'::jsonb)) as players(player_name)
  where player_name <> v_name;

  update public.shared_tournaments
  set state = jsonb_set(
    jsonb_set(v_tournament.state, '{players}', v_players, true),
    '{playerOwners}',
    v_owners - v_name,
    true
  )
  where id = p_tournament_id
  returning * into v_tournament;

  return query select * from public.shared_lobby_return_row(v_tournament.id, v_role);
end;
$$;

create or replace function public.wws_update_team_name_in_array(
  p_teams jsonb,
  p_team_id text,
  p_team_name text
)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    case
      when team->>'id' = p_team_id then jsonb_set(team, '{name}', to_jsonb(p_team_name), true)
      else team
    end
    order by ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) with ordinality as items(team, ordinality);
$$;

create or replace function public.set_shared_team_name(
  p_tournament_id uuid,
  p_team_id text,
  p_team_name text
)
returns setof public.shared_tournaments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_tournament public.shared_tournaments;
  v_name text := nullif(trim(p_team_name), '');
  v_team jsonb;
  v_teams jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_group_key text;
  v_group_value jsonb;
  v_owners jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if v_name is null then
    raise exception 'Team name is required';
  end if;

  v_role := public.current_shared_lobby_role(p_tournament_id);
  if v_role is null then
    raise exception 'Lobby membership required';
  end if;

  select * into v_tournament
  from public.shared_tournaments
  where id = p_tournament_id
  for update;

  if v_tournament.state->'tournament' is null or v_tournament.state->'tournament' = 'null'::jsonb then
    raise exception 'Teams have not been drawn yet';
  end if;

  v_teams := coalesce(v_tournament.state#>'{tournament,teams}', '[]'::jsonb);

  select team_value into v_team
  from jsonb_array_elements(v_teams) as teams(team_value)
  where team_value->>'id' = p_team_id
  limit 1;

  if v_team is null then
    raise exception 'Team not found';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_teams) as teams(team_value)
    where team_value->>'id' <> p_team_id
      and lower(trim(team_value->>'name')) = lower(v_name)
  ) then
    raise exception 'Team name already exists';
  end if;

  if v_role <> 'host' then
    v_owners := coalesce(v_tournament.state->'playerOwners', '{}'::jsonb);
    if not exists (
      select 1
      from jsonb_array_elements_text(coalesce(v_team->'players', '[]'::jsonb)) as players(player_name)
      where v_owners->>player_name = auth.uid()::text
    ) then
      raise exception 'Players can only rename their own team';
    end if;
  end if;

  v_teams := public.wws_update_team_name_in_array(v_teams, p_team_id, v_name);

  for v_group_key, v_group_value in
    select key, value
    from jsonb_each(coalesce(v_tournament.state#>'{tournament,groups}', '{}'::jsonb))
  loop
    v_groups := jsonb_set(
      v_groups,
      array[v_group_key],
      public.wws_update_team_name_in_array(v_group_value, p_team_id, v_name),
      true
    );
  end loop;

  update public.shared_tournaments
  set state = jsonb_set(
    jsonb_set(v_tournament.state, '{tournament,teams}', v_teams, true),
    '{tournament,groups}',
    v_groups,
    true
  )
  where id = p_tournament_id
  returning * into v_tournament;

  return query select * from public.shared_lobby_return_row(v_tournament.id, v_role);
end;
$$;

create or replace function public.delete_shared_lobby_as_host(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if public.current_shared_lobby_role(p_tournament_id) <> 'host' then
    raise exception 'Only the tournament host can delete this lobby';
  end if;

  delete from public.shared_tournaments
  where id = p_tournament_id;
end;
$$;

revoke update, delete on public.shared_tournaments from anon, authenticated;
grant select on public.shared_tournaments to anon, authenticated;
grant execute on function public.create_shared_lobby(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.join_shared_lobby(text) to anon, authenticated;
grant execute on function public.save_shared_lobby_as_host(uuid, bigint, text, jsonb) to anon, authenticated;
grant execute on function public.add_shared_player(uuid, text) to anon, authenticated;
grant execute on function public.remove_shared_player(uuid, text) to anon, authenticated;
grant execute on function public.set_shared_team_name(uuid, text, text) to anon, authenticated;
grant execute on function public.delete_shared_lobby_as_host(uuid) to anon, authenticated;

drop policy if exists "members can update their lobbies" on public.shared_tournaments;
drop policy if exists "members can delete their lobbies" on public.shared_tournaments;

notify pgrst, 'reload schema';
