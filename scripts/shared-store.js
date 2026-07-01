(function () {
  const TABLE = "shared_tournaments";
  let client = null;
  let activeSubscription = null;
  let activeTournamentId = "";
  let activeMemberRole = "";
  let suppressedRemote = null;
  let currentUserId = "";

  function getConfig() {
    return window.WWS_SUPABASE_CONFIG || {};
  }

  function isConfigured() {
    const config = getConfig();
    return Boolean(config.url && config.anonKey && window.supabase?.createClient);
  }

  function getClient() {
    if (!isConfigured()) {
      throw new Error("Supabase ist nicht konfiguriert.");
    }
    if (!client) {
      const config = getConfig();
      client = window.supabase.createClient(config.url, config.anonKey);
    }
    return client;
  }

  async function ensureAnonymousSession() {
    const supabase = getClient();
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData.session) {
      currentUserId = sessionData.session.user?.id || "";
      return sessionData.session;
    }
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    currentUserId = data.session?.user?.id || "";
    return data.session;
  }

  function getCurrentUserId() {
    return currentUserId;
  }

  function createShareCode() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function normalizeSharedRow(row) {
    const memberRole = row.config?.memberRole || (row.id === activeTournamentId ? activeMemberRole : "") || "player";
    if (row.id === activeTournamentId || row.config?.memberRole) {
      activeMemberRole = memberRole;
    }
    return {
      mode: "shared",
      id: row.id,
      shareCode: row.share_code,
      name: row.name,
      memberRole,
      version: row.version || 1,
      status: row.status || "active",
      updatedAt: row.updated_at,
      state: row.state || {},
    };
  }

  function localToSharedState(localTournament) {
    return {
      id: localTournament.id,
      name: localTournament.name,
      players: localTournament.players || [],
      playerOwners: localTournament.playerOwners || {},
      format: localTournament.format || BeachCupStore.DEFAULT_FORMAT,
      tournament: localTournament.tournament || null,
      registrationLink: localTournament.registrationLink || "",
      logoSrc: localTournament.logoSrc || BeachCupStore.DEFAULT_LOGO_SRC,
      createdAt: localTournament.createdAt,
      updatedAt: localTournament.updatedAt,
    };
  }

  function sharedToActiveTournament(shared) {
    return {
      ...shared.state,
      id: shared.id,
      name: shared.name || shared.state?.name || "Shared Tournament",
      shareCode: shared.shareCode,
      mode: "shared",
      version: shared.version,
      status: shared.status,
    };
  }

  function explainRpcError(error, functionName) {
    const message = error?.message || "";
    if (message.includes("schema cache") || message.includes(`public.${functionName}`)) {
      return new Error("Supabase ist noch nicht aktualisiert: Bitte die Migration supabase/migrations/004_role_based_shared_lobby_permissions.sql im Supabase SQL Editor ausfuehren und die Seite danach neu laden.");
    }
    return error;
  }

  async function createSharedTournament(localTournament) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const shareCode = createShareCode();
    const state = localToSharedState(localTournament);
    const { data, error } = await supabase.rpc("create_shared_lobby", {
      p_share_code: shareCode,
      p_name: localTournament.name || "Shared Tournament",
      p_state: state,
      p_config: {},
    });
    if (error) throw explainRpcError(error, "create_shared_lobby");
    return normalizeSharedRow(data[0]);
  }

  async function joinSharedTournamentByCode(shareCode) {
    const normalizedShareCode = normalizeShareCode(shareCode);
    if (!normalizedShareCode) {
      throw new Error("Der Shared-Lobby-Link enthaelt keinen gueltigen Lobby-Code.");
    }
    await ensureAnonymousSession();
    const supabase = getClient();
    const { data, error } = await supabase.rpc("join_shared_lobby", {
      p_share_code: normalizedShareCode,
    });
    if (error) throw explainRpcError(error, "join_shared_lobby");
    if (!data?.[0]) throw new Error("Dieses geteilte Turnier existiert nicht mehr oder der Link ist ungültig.");
    return normalizeSharedRow(data[0]);
  }

  async function saveSharedTournament(activeTournament) {
    return saveSharedTournamentAsHost(activeTournament);
  }

  async function saveSharedTournamentAsHost(activeTournament) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const state = localToSharedState(activeTournament);
    const { data, error } = await supabase.rpc("save_shared_lobby_as_host", {
      p_tournament_id: activeTournament.id,
      p_expected_version: null,
      p_name: activeTournament.name || state.name || "Shared Tournament",
      p_state: state,
    });
    if (error) throw explainRpcError(error, "save_shared_lobby_as_host");
    if (!data?.[0]) {
      throw new Error("Dieses Turnier wurde gerade in einer anderen Sitzung geändert. Bitte den aktuellen Stand abwarten und erneut versuchen.");
    }
    suppressedRemote = { id: data[0].id, version: data[0].version };
    return normalizeSharedRow(data[0]);
  }

  async function addSharedPlayer(tournamentId, name) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const { data, error } = await supabase.rpc("add_shared_player", {
      p_tournament_id: tournamentId,
      p_player_name: name,
    });
    if (error) throw explainRpcError(error, "add_shared_player");
    suppressedRemote = { id: data[0].id, version: data[0].version };
    return normalizeSharedRow(data[0]);
  }

  async function removeSharedPlayer(tournamentId, name) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const { data, error } = await supabase.rpc("remove_shared_player", {
      p_tournament_id: tournamentId,
      p_player_name: name,
    });
    if (error) throw explainRpcError(error, "remove_shared_player");
    suppressedRemote = { id: data[0].id, version: data[0].version };
    return normalizeSharedRow(data[0]);
  }

  async function setSharedTeamName(tournamentId, teamId, teamName) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const { data, error } = await supabase.rpc("set_shared_team_name", {
      p_tournament_id: tournamentId,
      p_team_id: teamId,
      p_team_name: teamName,
    });
    if (error) throw explainRpcError(error, "set_shared_team_name");
    suppressedRemote = { id: data[0].id, version: data[0].version };
    return normalizeSharedRow(data[0]);
  }

  async function deleteSharedTournament(tournamentId) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const { error } = await supabase.rpc("delete_shared_lobby_as_host", {
      p_tournament_id: tournamentId,
    });
    if (error) throw explainRpcError(error, "delete_shared_lobby_as_host");
  }

  function subscribeToSharedTournament(tournamentId, onChange, onDelete) {
    unsubscribeFromSharedTournament();
    activeTournamentId = tournamentId;
    const supabase = getClient();
    activeSubscription = supabase
      .channel(`shared-tournament-${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: TABLE, filter: `id=eq.${tournamentId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            onDelete?.();
            return;
          }
          if (!payload.new || payload.new.id !== activeTournamentId) return;
          if (suppressedRemote?.id === payload.new.id && suppressedRemote.version === payload.new.version) {
            suppressedRemote = null;
            return;
          }
          onChange(normalizeSharedRow(payload.new));
        }
      )
      .subscribe();
    return activeSubscription;
  }

  function unsubscribeFromSharedTournament() {
    if (activeSubscription && client) {
      client.removeChannel(activeSubscription);
    }
    activeSubscription = null;
    activeTournamentId = "";
    activeMemberRole = "";
    suppressedRemote = null;
  }

  function getShareLink(sharedTournament) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `lobby=${encodeURIComponent(sharedTournament.shareCode)}`;
    return url.toString();
  }

  function normalizeShareCode(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      return (
        url.searchParams.get("lobby") ||
        new URLSearchParams(url.hash.replace(/^#/, "")).get("lobby") ||
        ""
      ).trim();
    } catch {
      return raw
        .replace(/^#?lobby=/i, "")
        .split(/[&#?]/)[0]
        .trim();
    }
  }

  window.SharedTournamentStore = {
    isConfigured,
    ensureAnonymousSession,
    getCurrentUserId,
    createSharedTournament,
    joinSharedTournamentByCode,
    saveSharedTournament,
    saveSharedTournamentAsHost,
    addSharedPlayer,
    removeSharedPlayer,
    setSharedTeamName,
    deleteSharedTournament,
    subscribeToSharedTournament,
    unsubscribeFromSharedTournament,
    getShareLink,
    normalizeShareCode,
    sharedToActiveTournament,
  };
})();
