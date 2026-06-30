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

grant execute on function public.join_shared_lobby(text) to anon, authenticated;
