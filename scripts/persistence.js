(function () {
  const STORE_KEY = "wws-beachcup-store-v2";
  const HOST_KEY = "wws-beachcup-host-id-v1";
  const LEGACY_KEY = "beach-cup-state-v1";
  const DEFAULT_TOURNAMENT_NAME = "1. WWS-Herren BeachCup";
  const DEFAULT_LOGO_SRC = "assets/wilde-wespen-logo.jpeg";
  const DEFAULT_FORMAT = { teamCount: 6, playersPerTeam: 2, groupCount: 2, targetScore: 15 };

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function createId(prefix) {
    const value = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function createEmptyTournament(name = DEFAULT_TOURNAMENT_NAME) {
    const now = new Date().toISOString();
    return {
      id: createId("tournament"),
      name,
      players: [],
      playerOwners: {},
      tournament: null,
      registrationLink: "",
      logoSrc: DEFAULT_LOGO_SRC,
      createdAt: now,
      updatedAt: now,
    };
  }

  function normalizeStore(store) {
    return store && typeof store === "object" && store.hosts ? store : { hosts: {} };
  }

  function getCurrentHostId() {
    let hostId = localStorage.getItem(HOST_KEY);
    if (!hostId) {
      hostId = createId("host");
      localStorage.setItem(HOST_KEY, hostId);
    }
    return hostId;
  }

  function getStore() {
    return normalizeStore(readJson(STORE_KEY, { hosts: {} }));
  }

  function saveStore(store) {
    writeJson(STORE_KEY, normalizeStore(store));
  }

  function getHostData() {
    const hostId = getCurrentHostId();
    const store = getStore();
    if (!store.hosts[hostId]) {
      store.hosts[hostId] = {
        tournaments: {},
        activeTournamentId: "",
        settings: { dark: false, beam: false },
      };
      saveStore(store);
    }
    return store.hosts[hostId];
  }

  function saveHostData(hostData) {
    const hostId = getCurrentHostId();
    const store = getStore();
    store.hosts[hostId] = hostData;
    saveStore(store);
  }

  function migrateLegacyState() {
    if (localStorage.getItem(`${LEGACY_KEY}-migrated`)) return;
    const legacy = readJson(LEGACY_KEY, null);
    if (!legacy || (!legacy.players?.length && !legacy.tournament && !legacy.registrationLink)) {
      localStorage.setItem(`${LEGACY_KEY}-migrated`, "1");
      return;
    }
    const hostData = getHostData();
    const legacyTournament = createEmptyTournament(DEFAULT_TOURNAMENT_NAME);
    legacyTournament.players = Array.isArray(legacy.players) ? legacy.players : [];
    legacyTournament.tournament = legacy.tournament || null;
    legacyTournament.registrationLink = legacy.registrationLink || "";
    legacyTournament.logoSrc = legacy.logoSrc || DEFAULT_LOGO_SRC;
    legacyTournament.createdAt = legacy.tournament?.createdAt || legacyTournament.createdAt;
    hostData.tournaments[legacyTournament.id] = legacyTournament;
    hostData.activeTournamentId = legacyTournament.id;
    hostData.settings = {
      dark: Boolean(legacy.dark),
      beam: Boolean(legacy.beam),
    };
    saveHostData(hostData);
    localStorage.setItem(`${LEGACY_KEY}-migrated`, "1");
  }

  function ensureActiveTournament() {
    migrateLegacyState();
    const hostData = getHostData();
    const ids = Object.keys(hostData.tournaments || {});
    if (!hostData.activeTournamentId || !hostData.tournaments[hostData.activeTournamentId]) {
      if (ids.length === 0) {
        const tournament = createEmptyTournament();
        hostData.tournaments[tournament.id] = tournament;
        hostData.activeTournamentId = tournament.id;
      } else {
        hostData.activeTournamentId = ids[0];
      }
      saveHostData(hostData);
    }
    return hostData.tournaments[hostData.activeTournamentId];
  }

  function getActiveTournament() {
    return ensureActiveTournament();
  }

  function getAllTournaments() {
    const hostData = getHostData();
    return Object.values(hostData.tournaments || {}).sort((left, right) => {
      return (right.updatedAt || right.createdAt || "").localeCompare(left.updatedAt || left.createdAt || "");
    });
  }

  function saveTournament(tournament) {
    const hostData = getHostData();
    const now = new Date().toISOString();
    const next = {
      ...tournament,
      id: tournament.id || createId("tournament"),
      name: tournament.name || DEFAULT_TOURNAMENT_NAME,
      players: Array.isArray(tournament.players) ? tournament.players : [],
      playerOwners: tournament.playerOwners || {},
      logoSrc: tournament.logoSrc || DEFAULT_LOGO_SRC,
      updatedAt: now,
      createdAt: tournament.createdAt || now,
    };
    hostData.tournaments[next.id] = next;
    hostData.activeTournamentId = next.id;
    saveHostData(hostData);
    return next;
  }

  function createTournament(name = DEFAULT_TOURNAMENT_NAME) {
    return saveTournament(createEmptyTournament(name));
  }

  function deleteTournament(id) {
    const hostData = getHostData();
    delete hostData.tournaments[id];
    if (hostData.activeTournamentId === id) {
      hostData.activeTournamentId = Object.keys(hostData.tournaments)[0] || "";
    }
    if (!hostData.activeTournamentId) {
      const fallback = createEmptyTournament();
      hostData.tournaments[fallback.id] = fallback;
      hostData.activeTournamentId = fallback.id;
    }
    saveHostData(hostData);
    return hostData.tournaments[hostData.activeTournamentId];
  }

  function setActiveTournament(id) {
    const hostData = getHostData();
    if (hostData.tournaments[id]) {
      hostData.activeTournamentId = id;
      saveHostData(hostData);
    }
    return getActiveTournament();
  }

  function getSettings() {
    return { dark: false, beam: false, ...(getHostData().settings || {}) };
  }

  function saveSettings(settings) {
    const hostData = getHostData();
    hostData.settings = { ...getSettings(), ...settings };
    saveHostData(hostData);
    return hostData.settings;
  }

  window.BeachCupStore = {
    getCurrentHostId,
    getHostData,
    getActiveTournament,
    getAllTournaments,
    saveTournament,
    createTournament,
    deleteTournament,
    setActiveTournament,
    getSettings,
    saveSettings,
    DEFAULT_LOGO_SRC,
    DEFAULT_FORMAT,
  };
})();
