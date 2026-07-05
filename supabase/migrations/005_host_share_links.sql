update public.shared_tournaments
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('hostShareCode', gen_random_uuid()::text)
where not (coalesce(config, '{}'::jsonb) ? 'hostShareCode');

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
    (coalesce(st.config, '{}'::jsonb) - 'hostShareCode')
      || jsonb_build_object('memberRole', p_member_role)
      || case
        when p_member_role = 'host' then jsonb_build_object('hostShareCode', st.config->>'hostShareCode')
        else '{}'::jsonb
      end,
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
    (coalesce(p_config, '{}'::jsonb) - 'hostShareCode') || jsonb_build_object(
      'hostShareCode',
      coalesce(nullif(p_config->>'hostShareCode', ''), gen_random_uuid()::text)
    )
  )
  returning * into v_tournament;

  insert into public.shared_lobby_members (tournament_id, user_id, role)
  values (v_tournament.id, auth.uid(), 'host')
  on conflict (tournament_id, user_id) do update set role = 'host';

  return query select * from public.shared_lobby_return_row(v_tournament.id, 'host');
end;
$$;

create or replace function public.join_shared_lobby_as_host(p_host_share_code text)
returns setof public.shared_tournaments
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

  select st.*
  into v_tournament
  from public.shared_tournaments st
  where st.config->>'hostShareCode' = p_host_share_code
    and st.status = 'active';

  if v_tournament.id is null then
    raise exception 'Shared lobby not found';
  end if;

  insert into public.shared_lobby_members (tournament_id, user_id, role)
  values (v_tournament.id, auth.uid(), 'host')
  on conflict (tournament_id, user_id) do update set role = 'host';

  return query select * from public.shared_lobby_return_row(v_tournament.id, 'host');
end;
$$;

grant execute on function public.create_shared_lobby(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.join_shared_lobby_as_host(text) to anon, authenticated;

notify pgrst, 'reload schema';
