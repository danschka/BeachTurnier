(function () {
  const TABLE = "shared_tournaments";
  let client = null;
  let activeSubscription = null;
  let activeTournamentId = "";
  let suppressNextRemote = false;

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
    if (sessionData.session) return sessionData.session;
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    return data.session;
  }

  function createShareCode() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function normalizeSharedRow(row) {
    return {
      mode: "shared",
      id: row.id,
      shareCode: row.share_code,
      name: row.name,
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
    if (error) throw error;
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
    if (error) throw error;
    if (!data?.[0]) throw new Error("Dieses geteilte Turnier existiert nicht mehr oder der Link ist ungültig.");
    return normalizeSharedRow(data[0]);
  }

  async function saveSharedTournament(activeTournament) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const state = localToSharedState(activeTournament);
    let query = supabase
      .from(TABLE)
      .update({
        name: activeTournament.name || state.name || "Shared Tournament",
        state,
      })
      .eq("id", activeTournament.id);
    if (activeTournament.version) {
      query = query.eq("version", activeTournament.version);
    }
    const { data, error } = await query
      .select("id, share_code, name, config, status, state, version, created_at, updated_at")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("Dieses Turnier wurde gerade in einer anderen Sitzung geändert. Bitte den aktuellen Stand abwarten und erneut versuchen.");
    }
    suppressNextRemote = true;
    return normalizeSharedRow(data);
  }

  async function deleteSharedTournament(tournamentId) {
    await ensureAnonymousSession();
    const supabase = getClient();
    const { error } = await supabase.from(TABLE).delete().eq("id", tournamentId);
    if (error) throw error;
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
          if (suppressNextRemote) {
            suppressNextRemote = false;
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
    createSharedTournament,
    joinSharedTournamentByCode,
    saveSharedTournament,
    deleteSharedTournament,
    subscribeToSharedTournament,
    unsubscribeFromSharedTournament,
    getShareLink,
    normalizeShareCode,
    sharedToActiveTournament,
  };
})();
