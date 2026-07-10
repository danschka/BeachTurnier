(function () {
  const DEFAULT_TOURNAMENT_NAME = "1. WWS-Herren BeachCup";
  const DEFAULT_LOGO_SRC = BeachCupStore.DEFAULT_LOGO_SRC || "assets/beachcup-logo.svg";
  const LEGACY_LOGO_SRC = "assets/wilde-wespen-logo.jpeg";
  const DEFAULT_FORMAT = BeachTournament.DEFAULT_FORMAT || BeachCupStore.DEFAULT_FORMAT || { playerCount: 12, playersPerTeam: 2, courtCount: 2, groupCount: 2, targetScore: 15 };
  const PLAYER_NAME_KEY = "wws-beachcup-player-name-v1";
  const SHARED_SAVE_DELAY = 750;
  const SAMPLE_PLAYERS = [
    "Alex Müller",
    "Samira Becker",
    "Jonas Weber",
    "Mira Hoffmann",
    "Luca Fischer",
    "Nora Klein",
    "Ben Wagner",
    "Lea Schmidt",
    "Tom Schneider",
    "Amelie Koch",
    "Felix Bauer",
    "Hanna Richter",
  ];

  let active = BeachCupStore.getActiveTournament();
  let settings = BeachCupStore.getSettings();
  let mode = "local";
  let playerMode = false;
  let activeShared = null;
  let sharedError = "";
  const $ = (selector) => document.querySelector(selector);
  let scoreRenderTimer = null;
  let scoreSaveTimer = null;
  let sharedSaveTimer = null;
  let sharedSaveInFlight = false;
  let sharedSaveQueued = false;
  let sharedSaveGeneration = 0;
  let sharedHasLocalChanges = false;
  let deferredSharedRemote = null;

  function isSharedHost() {
    return mode !== "shared" || activeShared?.memberRole === "host";
  }

  function isSharedPlayer() {
    return mode === "shared" && activeShared?.memberRole !== "host";
  }

  function normalizeLogoSrc(logoSrc) {
    return !logoSrc || logoSrc === LEGACY_LOGO_SRC ? DEFAULT_LOGO_SRC : logoSrc;
  }

  function refreshActive() {
    if (mode === "shared" && activeShared) {
      active = SharedTournamentStore.sharedToActiveTournament(activeShared);
    } else if (mode === "shared") {
      active = {
        id: "",
        name: "Shared Lobby",
        players: [],
        playerOwners: {},
        format: { ...DEFAULT_FORMAT },
        tournament: null,
        registrationLink: "",
        logoSrc: DEFAULT_LOGO_SRC,
      };
    } else if (mode === "local") {
      active = BeachCupStore.getActiveTournament();
    }
    active.logoSrc = normalizeLogoSrc(active.logoSrc);
    settings = BeachCupStore.getSettings();
  }

  function saveActive(options = {}) {
    if (mode === "shared") {
      if (!isSharedHost()) return;
      sharedHasLocalChanges = true;
      activeShared = {
        ...activeShared,
        id: active.id,
        name: active.name || DEFAULT_TOURNAMENT_NAME,
        state: snapshotActiveForShared(),
      };
      scheduleSharedSave(Boolean(options.immediate));
      return;
    }
    active = BeachCupStore.saveTournament(active);
  }

  function scheduleSharedSave(immediate = false) {
    window.clearTimeout(sharedSaveTimer);
    if (immediate) {
      flushSharedSave();
      return;
    }
    sharedSaveTimer = window.setTimeout(flushSharedSave, SHARED_SAVE_DELAY);
  }

  function resetSharedSaveQueue() {
    sharedSaveGeneration += 1;
    window.clearTimeout(scoreSaveTimer);
    scoreSaveTimer = null;
    window.clearTimeout(sharedSaveTimer);
    sharedSaveTimer = null;
    sharedSaveInFlight = false;
    sharedSaveQueued = false;
    sharedHasLocalChanges = false;
    deferredSharedRemote = null;
  }

  function flushSharedSave() {
    window.clearTimeout(sharedSaveTimer);
    sharedSaveTimer = null;
    if (mode !== "shared" || !activeShared) return;
    if (sharedSaveInFlight) {
      sharedSaveQueued = true;
      return;
    }

    sharedSaveInFlight = true;
    const tournamentToSave = cloneTournament(active);
    const saveGeneration = sharedSaveGeneration;
    SharedTournamentStore.saveSharedTournament(tournamentToSave)
      .then((shared) => {
        if (saveGeneration !== sharedSaveGeneration) return;
        const hasQueuedChanges = sharedSaveQueued;
        activeShared = hasQueuedChanges
          ? { ...shared, name: active.name || DEFAULT_TOURNAMENT_NAME, state: snapshotActiveForShared() }
          : shared;
        if (mode === "shared") {
          active.version = shared.version;
          if (!hasQueuedChanges) {
            active = SharedTournamentStore.sharedToActiveTournament(activeShared);
            sharedHasLocalChanges = false;
          }
        }
      })
      .catch((error) => {
        if (saveGeneration !== sharedSaveGeneration) return;
        if (!sharedSaveQueued) {
          sharedHasLocalChanges = false;
        }
        alert(`Shared Lobby konnte nicht gespeichert werden: ${error.message}`);
      })
      .finally(() => {
        if (saveGeneration !== sharedSaveGeneration) return;
        sharedSaveInFlight = false;
        if (sharedSaveQueued && mode === "shared") {
          sharedSaveQueued = false;
          scheduleSharedSave(true);
        } else {
          applyDeferredSharedRemote();
        }
      });
  }

  function hasPendingSharedSave() {
    return Boolean(sharedHasLocalChanges || sharedSaveTimer || sharedSaveInFlight || sharedSaveQueued);
  }

  function receiveSharedRemote(shared) {
    if (mode !== "shared" || shared.id !== activeShared?.id) return;
    if (shared.version < (activeShared.version || 0)) return;
    if (hasPendingSharedSave()) {
      if (!deferredSharedRemote || shared.version >= deferredSharedRemote.version) {
        deferredSharedRemote = shared;
      }
      return;
    }
    applySharedRemote(shared);
  }

  function applyDeferredSharedRemote() {
    if (mode !== "shared" || !deferredSharedRemote || hasPendingSharedSave()) return;
    const shared = deferredSharedRemote;
    deferredSharedRemote = null;
    if (shared.version < (activeShared?.version || 0)) return;
    applySharedRemote(shared);
  }

  function applySharedRemote(shared) {
    activeShared = shared;
    render();
  }

  function cloneTournament(tournament) {
    return JSON.parse(JSON.stringify(tournament));
  }

  function snapshotActiveForShared() {
    return {
      id: active.id,
      name: active.name || DEFAULT_TOURNAMENT_NAME,
      players: active.players || [],
      playerOwners: active.playerOwners || {},
      format: active.format || DEFAULT_FORMAT,
      tournament: active.tournament || null,
      registrationLink: active.registrationLink || "",
      logoSrc: active.logoSrc || DEFAULT_LOGO_SRC,
      createdAt: active.createdAt,
      updatedAt: active.updatedAt,
    };
  }

  async function init() {
    bindTabs();
    bindActions();
    playerMode = getViewModeFromLocation() === "player";
    document.body.classList.toggle("dark", settings.dark);
    document.body.classList.toggle("beam", settings.beam);
    await openSharedLobbyFromUrl();
    render();
  }

  function bindTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((item) => item.classList.remove("is-active"));
        document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("is-visible"));
        tab.classList.add("is-active");
        $(`#${tab.dataset.tab}`).classList.add("is-visible");
      });
    });
  }

  function bindActions() {
    $("#playerForm").addEventListener("submit", (event) => {
      event.preventDefault();
      addPlayer($("#playerName").value);
    });
    $("#playerSignupForm").addEventListener("submit", (event) => {
      event.preventDefault();
      addPlayer($("#playerSignupName").value, { rememberPlayer: true });
      $("#playerSignupName").value = "";
    });
    $("#samplePlayersButton").addEventListener("click", () => {
      active.players = samplePlayersForFormat();
      active.playerOwners = {};
      active.tournament = null;
      persistAndRender();
    });
    $("#clearAllButton").addEventListener("click", () => {
      if (!confirmDestructive("alle Teilnehmer löschen")) return;
      if (!confirm("Alle Daten dieses Turniers löschen?")) return;
      active.players = [];
      active.playerOwners = {};
      active.tournament = null;
      persistAndRender();
    });
    $("#saveRegistrationLinkButton").addEventListener("click", () => {
      active.registrationLink = $("#registrationLink").value.trim();
      saveActive({ immediate: true });
      renderRegistrationLink();
    });
    $("#copyRegistrationLinkButton").addEventListener("click", copyRegistrationLink);
    $("#openRegistrationLinkButton").addEventListener("click", () => {
      const link = $("#registrationLink").value.trim();
      if (!link) return;
      active.registrationLink = link;
      saveActive({ immediate: true });
      window.open(link, "_blank", "noopener");
    });
    $("#newTournamentButton").addEventListener("click", () => {
      const name = prompt("Name für das neue Turnier:", DEFAULT_TOURNAMENT_NAME);
      if (name === null) return;
      leaveSharedLobby(false);
      active = BeachCupStore.createTournament(name.trim() || DEFAULT_TOURNAMENT_NAME);
      persistAndRender();
    });
    $("#newSharedTournamentButton").addEventListener("click", createNewSharedTournament);
    $("#tournamentSelect").addEventListener("change", (event) => {
      leaveSharedLobby(false);
      active = BeachCupStore.setActiveTournament(event.target.value);
      persistAndRender();
    });
    $("#renameTournamentButton").addEventListener("click", () => {
      active.name = $("#tournamentNameInput").value.trim() || DEFAULT_TOURNAMENT_NAME;
      persistAndRender();
    });
    $("#tournamentNameInput").addEventListener("change", () => {
      active.name = $("#tournamentNameInput").value.trim() || DEFAULT_TOURNAMENT_NAME;
      persistAndRender();
    });
    $("#saveLogoUrlButton").addEventListener("click", () => {
      const logoUrl = $("#logoUrlInput").value.trim();
      if (!logoUrl) return;
      active.logoSrc = logoUrl;
      persistAndRender();
    });
    $("#resetLogoButton").addEventListener("click", () => {
      active.logoSrc = DEFAULT_LOGO_SRC;
      $("#logoFileInput").value = "";
      persistAndRender();
    });
    $("#logoFileInput").addEventListener("change", importLogoFile);
    $("#deleteTournamentButton").addEventListener("click", () => {
      if (!confirmDestructive("Turnier löschen")) return;
      if (!confirm(`Turnier "${active.name}" löschen?`)) return;
      if (mode === "shared") {
        deleteActiveSharedTournament();
        return;
      }
      active = BeachCupStore.deleteTournament(active.id);
      persistAndRender();
    });
    $("#generateTournamentButton").addEventListener("click", () => generateTournament());
    $("#reshuffleButton").addEventListener("click", () => generateTournament());
    $("#startTournamentButton").addEventListener("click", startTournament);
    ["courtCountInput", "playerCountInput", "playersPerTeamInput", "groupCountInput", "targetScoreInput"].forEach((id) => {
      $(`#${id}`).addEventListener("change", updateFormatFromInputs);
    });
    $("#printButton").addEventListener("click", () => window.print());
    $("#darkModeButton").addEventListener("click", () => {
      settings.dark = !settings.dark;
      document.body.classList.toggle("dark", settings.dark);
      BeachCupStore.saveSettings(settings);
      persistAndRender();
    });
    $("#beamModeButton").addEventListener("click", () => {
      const activePanel = document.querySelector(".tab-panel.is-visible")?.id;
      settings.beam = !settings.beam;
      document.body.classList.toggle("beam", settings.beam);
      if (settings.beam && (activePanel === "setup" || activePanel === "exports")) showTab("matches");
      BeachCupStore.saveSettings(settings);
      persistAndRender();
    });
    $("#csvExportButton").addEventListener("click", exportCsv);
    $("#pdfExportButton").addEventListener("click", exportPdf);
    $("#jsonExportButton").addEventListener("click", () => {
      downloadText("wws-herren-beachcup-backup.json", JSON.stringify(active, null, 2), "application/json");
    });
    $("#jsonImportInput").addEventListener("change", importBackup);
    $("#copyShareLinkButton").addEventListener("click", copyShareLink);
    $("#copyPlayerLinkButton").addEventListener("click", copyPlayerLink);
    $("#publishLocalButton").addEventListener("click", publishLocalTournament);
    $("#leaveSharedLobbyButton").addEventListener("click", () => leaveSharedLobby(true));
  }

  async function openSharedLobbyFromUrl() {
    const hostCode = getHostCodeFromLocation();
    const shareCode = getShareCodeFromLocation();
    if (!hostCode && !shareCode) return;
    try {
      activeShared = hostCode
        ? await SharedTournamentStore.joinSharedTournamentAsHost(hostCode)
        : await SharedTournamentStore.joinSharedTournamentByCode(shareCode);
      mode = "shared";
      sharedError = "";
      resetSharedSaveQueue();
      replaceLobbyUrl(activeShared.shareCode);
      subscribeToActiveSharedLobby();
    } catch (error) {
      mode = "shared";
      activeShared = null;
      console.error("Shared lobby join failed:", error);
      sharedError = `Shared Lobby konnte nicht geoeffnet werden: ${error.message}`;
      alert(sharedError);
    }
  }

  function getShareCodeFromLocation() {
    const queryCode = new URLSearchParams(window.location.search).get("lobby");
    const hashCode = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("lobby");
    return SharedTournamentStore.normalizeShareCode(queryCode || hashCode || "");
  }

  function getHostCodeFromLocation() {
    const queryCode = new URLSearchParams(window.location.search).get("host");
    const hashCode = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("host");
    return SharedTournamentStore.normalizeShareCode(queryCode || hashCode || "", "host");
  }

  function getViewModeFromLocation() {
    const queryParams = new URLSearchParams(window.location.search);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return String(queryParams.get("role") || queryParams.get("view") || hashParams.get("role") || hashParams.get("view") || "").toLowerCase();
  }

  function subscribeToActiveSharedLobby() {
    if (!activeShared) return;
    SharedTournamentStore.subscribeToSharedTournament(
      activeShared.id,
      (shared) => {
        receiveSharedRemote(shared);
      },
      () => {
        sharedError = "Dieses geteilte Turnier wurde gelöscht.";
        leaveSharedLobby(true);
        alert(sharedError);
      }
    );
  }

  function leaveSharedLobby(updateUrl) {
    SharedTournamentStore.unsubscribeFromSharedTournament();
    resetSharedSaveQueue();
    mode = "local";
    activeShared = null;
    sharedError = "";
    active = BeachCupStore.getActiveTournament();
    if (updateUrl) {
      clearLobbyUrl();
    }
    render();
  }

  async function createNewSharedTournament() {
    const name = prompt("Name für die neue Shared Lobby:", active.name || DEFAULT_TOURNAMENT_NAME);
    if (name === null) return;
    const localCopy = {
      ...active,
      id: undefined,
      name: name.trim() || DEFAULT_TOURNAMENT_NAME,
      players: [],
      playerOwners: {},
      tournament: null,
    };
    await activateSharedFromLocalCopy(localCopy);
  }

  async function publishLocalTournament() {
    if (mode !== "local") return;
    await activateSharedFromLocalCopy(active);
  }

  async function activateSharedFromLocalCopy(localCopy, options = {}) {
    if (!SharedTournamentStore.isConfigured()) {
      alert("Supabase ist noch nicht konfiguriert. Bitte scripts/supabase-config.js anlegen.");
      return;
    }
    try {
      activeShared = await SharedTournamentStore.createSharedTournament(localCopy);
      mode = "shared";
      sharedError = "";
      resetSharedSaveQueue();
      subscribeToActiveSharedLobby();
      replaceLobbyUrl(activeShared.shareCode);
      render();
      if (options.copyLink !== false) {
        await copyShareLink();
      }
    } catch (error) {
      alert(`Shared Lobby konnte nicht erstellt werden: ${error.message}`);
    }
  }

  function replaceLobbyUrl(shareCode) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = !playerMode && activeShared?.hostShareCode
      ? `host=${encodeURIComponent(activeShared.hostShareCode)}`
      : playerMode ? `lobby=${encodeURIComponent(shareCode)}&role=player` : `lobby=${encodeURIComponent(shareCode)}`;
    window.history.replaceState({}, "", url.toString());
  }

  function clearLobbyUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("lobby");
    url.searchParams.delete("host");
    url.hash = "";
    window.history.replaceState({}, "", url.toString());
  }

  function getHostShareLink() {
    if (!activeShared) return;
    return SharedTournamentStore.getHostShareLink(activeShared);
  }

  function getPlayerShareLink() {
    if (!activeShared) return;
    const url = new URL(SharedTournamentStore.getShareLink(activeShared));
    url.hash = `lobby=${encodeURIComponent(activeShared.shareCode)}&role=player`;
    return url.toString();
  }

  async function copyShareLink() {
    const link = getHostShareLink();
    if (!link) {
      alert("Host-Link noch nicht verfügbar. Bitte die Supabase-Migration 005_host_share_links.sql erneut ausführen und danach eine neue Shared Lobby erstellen.");
      return;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      prompt("Link zum Turnier:", link);
    }
  }

  async function copyPlayerLink() {
    const link = getPlayerShareLink();
    if (!link) return;
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      prompt("Spieler-Link zum Turnier:", link);
    }
  }

  async function deleteActiveSharedTournament() {
    if (!activeShared) return;
    try {
      await SharedTournamentStore.deleteSharedTournament(activeShared.id);
      leaveSharedLobby(true);
    } catch (error) {
      alert(`Shared Lobby konnte nicht gelöscht werden: ${error.message}`);
    }
  }

  function confirmDestructive(action) {
    if (mode !== "shared") return true;
    return confirm(`Achtung: Du bist Ausrichter und kannst "${action}" fuer diese Lobby ausfuehren. Fortfahren?`);
  }

  function showTab(id) {
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) tab.click();
  }

  function persistAndRender(options = { immediate: true }) {
    saveActive(options);
    render();
  }

  function samplePlayersForFormat() {
    const totalPlayers = currentFormat().totalPlayers;
    return Array.from({ length: totalPlayers }, (_, index) => SAMPLE_PLAYERS[index] || `Spieler ${index + 1}`);
  }

  async function addPlayer(name, options = {}) {
    const trimmed = name.trim();
    const format = currentFormat();
    if (!trimmed) return;
    if (active.players.includes(trimmed)) {
      if (options.rememberPlayer) {
        localStorage.setItem(PLAYER_NAME_KEY, trimmed);
        renderPlayerView();
      }
      return;
    }
    if (active.players.length >= format.totalPlayers) return;
    if (isSharedPlayer() && active.tournament) {
      alert("Nach der Auslosung koennen Spieler keine Teilnehmerliste mehr aendern.");
      return;
    }
    if (isSharedPlayer()) {
      const currentUserId = SharedTournamentStore.getCurrentUserId?.() || "";
      if (Object.values(active.playerOwners || {}).includes(currentUserId)) {
        alert("Du hast bereits einen Namen eingetragen.");
        return;
      }
      try {
        activeShared = await SharedTournamentStore.addSharedPlayer(active.id, trimmed);
        if (options.rememberPlayer) localStorage.setItem(PLAYER_NAME_KEY, trimmed);
        $("#playerName").value = "";
        $("#playerSignupName").value = "";
        render();
      } catch (error) {
        alert(`Teilnehmer konnte nicht eingetragen werden: ${error.message}`);
      }
      return;
    }
    active.players.push(trimmed);
    active.playerOwners = active.playerOwners || {};
    if (options.rememberPlayer) localStorage.setItem(PLAYER_NAME_KEY, trimmed);
    active.tournament = null;
    $("#playerName").value = "";
    $("#playerSignupName").value = "";
    persistAndRender();
  }

  async function generateTournament() {
    const format = currentFormat();
    if (!format.hasCompleteTeams) {
      alert("Die Spielerzahl muss durch Spieler pro Team teilbar sein und mindestens zwei Teams ergeben.");
      return;
    }
    if (active.players.length !== format.totalPlayers) {
      alert(`Für die Auslosung werden genau ${format.totalPlayers} Teilnehmer benötigt.`);
      return;
    }
    if (isTournamentStarted()) {
      alert("Das Turnier wurde bereits gestartet. Neu auslosen ist nicht mehr moeglich.");
      return;
    }
    if (active.tournament && !confirmDestructive("Spielplan zurücksetzen")) return;
    active.tournament = BeachTournament.createTournament(active.players, format);
    persistAndRender();
    if (mode === "local" && SharedTournamentStore.isConfigured()) {
      await activateSharedFromLocalCopy(active, { copyLink: false });
    }
    showTab("teams");
  }

  function startTournament() {
    if (!active.tournament || !isSharedHost()) return;
    if (!confirm("Turnier starten? Danach koennen Teamnamen nicht mehr geaendert werden.")) return;
    active.tournament.startedAt = new Date().toISOString();
    persistAndRender({ immediate: true });
    showTab("matches");
  }

  function render() {
    refreshActive();
    renderHeader();
    renderAccessMode();
    renderTournamentManager();
    renderFormatControls();
    renderRoleControls();
    renderLogoManager();
    renderPlayers();
    renderPlayerView();
    renderRegistrationLink();
    renderTeams();
    renderMatches();
    renderStandings();
    renderFinals();
    renderLive();
  }

  function renderHeader() {
    const title = active.name || DEFAULT_TOURNAMENT_NAME;
    const logoSrc = active.logoSrc || DEFAULT_LOGO_SRC;
    const format = currentFormat();
    document.title = title;
    $("#formatEyebrow").textContent = `Volleyball - ${format.totalPlayers} Spieler - ${format.teamCount} Teams - ${format.courtCount} Spielfelder`;
    $("#tournamentTitle").textContent = title;
    $("#tournamentLogo").src = logoSrc;
    $("#tournamentLogo").alt = `${title} Logo`;
  }

  function renderAccessMode() {
    document.body.classList.toggle("player-mode", playerMode);
    if (!playerMode) return;
    const activePanel = document.querySelector(".tab-panel.is-visible")?.id;
    if (activePanel !== "player") showTab("player");
  }

  function currentFormat() {
    const normalized = BeachTournament.normalizeFormat(active.format || DEFAULT_FORMAT);
    active.format = normalized;
    return normalized;
  }

  function updateFormatFromInputs() {
    const next = BeachTournament.normalizeFormat({
      courtCount: $("#courtCountInput").value,
      playerCount: $("#playerCountInput").value,
      playersPerTeam: $("#playersPerTeamInput").value,
      groupCount: $("#groupCountInput").value,
      targetScore: $("#targetScoreInput").value,
    });
    const previous = currentFormat();
    active.format = next;
    if (
      active.tournament &&
      (previous.playerCount !== next.playerCount ||
        previous.teamCount !== next.teamCount ||
        previous.courtCount !== next.courtCount ||
        previous.playersPerTeam !== next.playersPerTeam ||
        previous.groupCount !== next.groupCount ||
        previous.targetScore !== next.targetScore)
    ) {
      active.tournament = null;
    }
    persistAndRender();
  }

  function renderFormatControls() {
    const format = currentFormat();
    $("#courtCountInput").value = format.courtCount;
    $("#playerCountInput").value = format.totalPlayers;
    $("#playersPerTeamInput").value = format.playersPerTeam;
    $("#groupCountInput").value = format.groupCount;
    $("#targetScoreInput").value = format.targetScore;
    $("#totalPlayersLabel").textContent = `${format.totalPlayers} Spieler, ${format.teamCount} Teams`;
    document.querySelector(".action-card p").textContent = format.hasCompleteTeams
      ? `Bereit bei genau ${format.totalPlayers} Teilnehmern auf ${format.courtCount} Spielfeldern.`
      : "Die Spielerzahl muss durch Spieler pro Team teilbar sein und mindestens zwei Teams ergeben.";
  }

  function renderTournamentManager() {
    $("#hostIdLabel").textContent = BeachCupStore.getCurrentHostId();
    const tournaments = BeachCupStore.getAllTournaments();
    $("#tournamentSelect").innerHTML = tournaments
      .map((item) => `<option value="${item.id}"${item.id === active.id ? " selected" : ""}>${escapeHtml(item.name || DEFAULT_TOURNAMENT_NAME)}</option>`)
      .join("");
    $("#tournamentNameInput").value = active.name || DEFAULT_TOURNAMENT_NAME;
    $("#modeLabel").textContent = mode === "shared"
      ? `Shared Lobby · ${isSharedHost() ? "Ausrichter" : "Spieler"}`
      : "Lokales Turnier";
    $("#tournamentSelect").disabled = mode === "shared";
    $("#newTournamentButton").disabled = mode === "shared";
    $("#newSharedTournamentButton").disabled = mode === "shared";
    $("#samplePlayersButton").disabled = !isSharedHost();
    $("#sharedLobbyBox").classList.toggle("is-hidden", mode !== "shared" && !SharedTournamentStore.isConfigured());
    $("#copyShareLinkButton").hidden = mode !== "shared" || !activeShared;
    $("#copyPlayerLinkButton").hidden = mode !== "shared" || !activeShared;
    $("#leaveSharedLobbyButton").hidden = mode !== "shared";
    $("#publishLocalButton").hidden = mode !== "local";
    $("#publishLocalButton").disabled = !SharedTournamentStore.isConfigured();
    const hostLink = getHostShareLink() || "";
    const playerLink = getPlayerShareLink() || "";
    const missingHostLink = mode === "shared" && activeShared && isSharedHost() && !hostLink;
    $("#shareLinkGrid").hidden = mode !== "shared" || !activeShared;
    $("#hostShareLink").value = hostLink;
    $("#hostShareLink").placeholder = missingHostLink ? "Supabase-Migration 005 ausführen" : "";
    $("#playerShareLink").value = playerLink;
    $("#sharedLobbyTitle").textContent = mode === "shared" ? `Shared Lobby: ${active.name || "unbekannt"}` : "Lokales Turnier online veröffentlichen";
    $("#sharedLobbyText").textContent = sharedError || (missingHostLink
      ? "Der Spieler-Link ist bereit. Für den Host-Link bitte zuerst die Supabase-Migration 005_host_share_links.sql ausführen."
      : mode === "shared"
      ? (isSharedHost()
        ? "Teile den Host-Link mit Ausrichtern und den Spieler-Link mit Teilnehmern."
        : "Du bist Spieler: Du kannst deinen Namen eintragen, vor der Auslosung wieder entfernen und nach der Auslosung den Namen deines Teams bearbeiten.")
      : "Erstellt eine Online-Kopie dieses lokalen Turniers und erzeugt einen Bearbeitungslink.");
  }

  function renderLogoManager() {
    const logoSrc = active.logoSrc || DEFAULT_LOGO_SRC;
    $("#logoUrlInput").value = logoSrc.startsWith("data:") || logoSrc === DEFAULT_LOGO_SRC ? "" : logoSrc;
  }

  function renderRoleControls() {
    const host = isSharedHost();
    [
      "#clearAllButton",
      "#generateTournamentButton",
      "#reshuffleButton",
      "#startTournamentButton",
      "#renameTournamentButton",
      "#tournamentNameInput",
      "#courtCountInput",
      "#playerCountInput",
      "#playersPerTeamInput",
      "#groupCountInput",
      "#targetScoreInput",
      "#saveLogoUrlButton",
      "#resetLogoButton",
      "#logoFileInput",
      "#saveRegistrationLinkButton",
      "#registrationLink",
      "#deleteTournamentButton",
      "#jsonImportInput",
    ].forEach((selector) => {
      const element = $(selector);
      if (element) element.disabled = !host;
    });
    $("#generateTournamentButton").disabled = !host || !currentFormat().hasCompleteTeams;
    const playerInput = $("#playerName");
    const playerSubmit = $("#playerForm button[type='submit']");
    const canEditPlayers = host || !active.tournament;
    playerInput.disabled = !canEditPlayers;
    playerSubmit.disabled = !canEditPlayers;
    renderStartControls(host);
  }

  function renderStartControls(host) {
    const hasTournament = Boolean(active.tournament);
    const started = isTournamentStarted();
    $("#startTournamentButton").disabled = !host || !hasTournament || started;
    $("#reshuffleButton").disabled = !host || !hasTournament || started;
    $("#tournamentStartStatus").textContent = !hasTournament
      ? "Noch keine Teams"
      : (started ? "Turnier gestartet" : "Teamnamen offen");
  }

  function importLogoFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Bitte eine Bilddatei auswählen.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      active.logoSrc = reader.result;
      persistAndRender();
    };
    reader.readAsDataURL(file);
  }

  function renderPlayers() {
    const format = currentFormat();
    $("#playerCount").textContent = `${active.players.length}/${format.totalPlayers}`;
    const owners = active.playerOwners || {};
    const currentUserId = SharedTournamentStore.getCurrentUserId?.() || "";
    $("#playerList").innerHTML = active.players
      .map((player, index) => {
        const canRemove = isSharedHost() || (!active.tournament && owners[player] === currentUserId);
        return `<li>${escapeHtml(player)} ${canRemove ? `<button data-remove="${index}" type="button">Entfernen</button>` : ""}</li>`;
      })
      .join("");
    document.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", async () => {
        const player = active.players[Number(button.dataset.remove)];
        if (isSharedPlayer()) {
          try {
            activeShared = await SharedTournamentStore.removeSharedPlayer(active.id, player);
            render();
          } catch (error) {
            alert(`Teilnehmer konnte nicht entfernt werden: ${error.message}`);
          }
          return;
        }
        active.players.splice(Number(button.dataset.remove), 1);
        if (active.playerOwners) delete active.playerOwners[player];
        active.tournament = null;
        persistAndRender();
      });
    });
  }

  function renderPlayerView() {
    const format = currentFormat();
    const rememberedName = localStorage.getItem(PLAYER_NAME_KEY) || "";
    $("#playerViewCount").textContent = `${active.players.length}/${format.totalPlayers} Spieler`;
    $("#publicPlayerList").innerHTML = active.players.length
      ? active.players.map((player) => `<li>${escapeHtml(player)}</li>`).join("")
      : `<li>Noch keine Spieler eingetragen</li>`;
    if (!$("#playerSignupName").value && rememberedName && !active.players.includes(rememberedName)) {
      $("#playerSignupName").value = rememberedName;
    }

    const team = active.tournament?.teams?.find((item) => item.players.includes(rememberedName));
    if (!active.tournament) {
      $("#playerTeamEditor").innerHTML = emptyMessage("Nach der Auslosung erscheint hier dein Team.");
      $("#playerTaskView").innerHTML = emptyMessage("Nach der Auslosung erscheinen hier deine Aufgaben.");
      $("#playerStandingsView").innerHTML = emptyMessage("Noch keine Tabelle verfuegbar.");
      return;
    }
    if (!rememberedName || !team) {
      $("#playerTeamEditor").innerHTML = emptyMessage("Trage dich mit deinem Namen ein, um dein Team zu bearbeiten.");
      $("#playerTaskView").innerHTML = emptyMessage("Trage dich mit deinem Namen ein, um deine Aufgaben zu sehen.");
      $("#playerStandingsView").innerHTML = emptyMessage("Trage dich mit deinem Namen ein, um deine Tabelle zu sehen.");
      return;
    }
    const canEdit = canEditTeamName(team);
    $("#playerTeamEditor").innerHTML = `<div class="player-team-card">
      <p><strong>${teamLabel(team)}</strong></p>
      <label>
        Teamname
        <input class="team-name-input" id="playerTeamNameInput" type="text" value="${escapeHtml(team.name)}" placeholder="Teamname"${canEdit ? "" : " disabled"}>
      </label>
    </div>`;
    renderPlayerTask(team);
    renderPlayerProgress(team, rememberedName);
    if (!canEdit) return;
    $("#playerTeamNameInput").addEventListener("input", (event) => {
      if (isSharedPlayer()) return;
      updateTeamName(team.id, event.target.value);
      saveActive();
      renderLive();
    });
    $("#playerTeamNameInput").addEventListener("change", async (event) => {
      const nextName = event.target.value.trim() || team.name || "Team";
      if (isDuplicateTeamName(team.id, nextName)) {
        alert("Dieser Teamname ist bereits vergeben.");
        event.target.value = team.name;
        return;
      }
      if (isSharedPlayer()) {
        try {
          activeShared = await SharedTournamentStore.setSharedTeamName(active.id, team.id, nextName);
          render();
        } catch (error) {
          alert(error.message.includes("already")
            ? "Dieser Teamname ist bereits vergeben."
            : `Teamname konnte nicht gespeichert werden: ${error.message}`);
          event.target.value = team.name;
        }
        return;
      }
      event.target.value = nextName;
      updateTeamName(team.id, nextName);
      persistAndRender({ immediate: true });
    });
  }

  function renderPlayerTask(team) {
    const tournament = active.tournament;
    const taskInfo = playerTaskInfo(team, tournament);
    if (!taskInfo.nextTask) {
      $("#playerTaskView").innerHTML = emptyMessage("Aktuell ist keine Aufgabe fuer dein Team offen.");
      return;
    }
    const label = taskLabel(taskInfo);
    const task = taskInfo.nextTask;
    $("#playerTaskView").innerHTML = `<div class="player-task-card">
      <p><strong>${label}</strong></p>
      ${taskInfo.currentMatch && task.match.id !== taskInfo.currentMatch.id ? `<p class="muted">Aktuell frei · laufend: ${escapeHtml(taskInfo.currentMatch.label)}</p>` : ""}
      <p>${escapeHtml(task.match.label)}</p>
      <p>${matchTeamName(task.match.teamA, tournament)}<br>vs<br>${matchTeamName(task.match.teamB, tournament)}</p>
      <p class="muted">${courtLabel(task.match)} - Schiri: ${refereeLabel(task.match, tournament)}</p>
    </div>`;
  }

  function playerTaskInfo(team, tournament) {
    const openMatches = [...(tournament.matches || []), ...(tournament.finals || [])]
      .filter((match) => match.teamA && match.teamB && !BeachTournament.matchResult(match));
    const currentMatch = openMatches[0] || null;
    let nextTask = null;
    for (const match of openMatches) {
      if (match.teamA === team.id || match.teamB === team.id) {
        nextTask = { kind: "play", match };
        break;
      }
      if (refereeTeamIdForMatch(match, tournament) === team.id) {
        nextTask = { kind: "referee", match };
        break;
      }
    }
    return { currentMatch, nextTask };
  }

  function taskLabel(taskInfo) {
    const { currentMatch, nextTask } = taskInfo;
    if (currentMatch && nextTask.match.id === currentMatch.id) {
      return nextTask.kind === "play" ? "Jetzt spielen" : "Jetzt Schiedsgericht";
    }
    return nextTask.kind === "play" ? "Naechstes Spiel" : "Naechstes Schiedsgericht";
  }

  function renderPlayerProgress(team, playerName) {
    const tournament = active.tournament;
    if (isTournamentComplete(tournament)) {
      renderPlayerFinalRanking(team, playerName);
      return;
    }
    renderPlayerStandings(team);
  }

  function renderPlayerStandings(team) {
    const tournament = active.tournament;
    const group = team.group || BeachTournament.groupNames(tournament).find((name) => {
      return (tournament.groups[name] || []).some((item) => item.id === team.id);
    });
    if (!group) {
      $("#playerStandingsView").innerHTML = emptyMessage("Noch keine Gruppentabelle verfuegbar.");
      return;
    }
    const rows = BeachTournament.standingsForGroup(group, tournament);
    $("#playerStandingsView").innerHTML = `<div class="player-progress-stack">
      <table class="compact-table">
      <thead><tr><th>#</th><th>Team</th><th>S</th><th>N</th><th>Diff</th><th>Punkte</th></tr></thead>
      <tbody>${rows.map((row, index) => `<tr${row.teamId === team.id ? " class=\"is-own-team\"" : ""}>
        <td>${index + 1}</td>
        <td>${teamLabel(row.team)}</td>
        <td>${row.wins}</td>
        <td>${row.losses}</td>
        <td>${row.pointDiff}</td>
        <td>${row.pointsFor}:${row.pointsAgainst}</td>
      </tr>`).join("")}</tbody>
      </table>
      ${playerFinalsOverview(team, tournament)}
    </div>`;
  }

  function playerFinalsOverview(team, tournament) {
    const finals = tournament.finals || [];
    if (!finals.length) return `<p class="muted">KO-Phase noch nicht gestartet.</p>`;
    return `<div class="player-finals-list">
      <h4>KO-Phase</h4>
      ${finals.map((match) => {
        const result = BeachTournament.matchResult(match);
        const own = match.teamA === team.id || match.teamB === team.id;
        const label = result ? setSummary(match) : "offen";
        return `<div class="referee-row${own ? " is-own-team" : ""}">
          <strong>${escapeHtml(match.label)} - ${courtLabel(match)}</strong>
          <span>${matchTeamName(match.teamA, tournament)} vs ${matchTeamName(match.teamB, tournament)} · ${escapeHtml(label)}</span>
        </div>`;
      }).join("")}
      <h4>Live-Platzierungen</h4>
      ${placementListHtml(finalPlacements(tournament), team.id)}
    </div>`;
  }

  function renderPlayerFinalRanking(team, playerName) {
    const tournament = active.tournament;
    const placements = finalPlacements(tournament);
    const ownPlacement = placements.find((item) => item.team?.id === team.id);
    const teammateText = team.players.filter((name) => name !== playerName).join(" & ") || "kein Teamkollege";
    $("#playerStandingsView").innerHTML = ownPlacement
      ? `<section class="player-result-page placement-${ownPlacement.place}">
          <p class="result-kicker">Turnier abgeschlossen</p>
          <h3>${ownPlacement.place}. Platz</h3>
          <p class="result-player">${escapeHtml(playerName)}</p>
          <p><strong>${escapeHtml(team.name)}</strong></p>
          <p class="muted">Teamkollege: ${escapeHtml(teammateText)}</p>
          <button class="primary-button wide" id="downloadCertificateButton" type="button">Urkunde als PDF herunterladen</button>
        </section>
        ${placementListHtml(placements, team.id)}`
      : emptyMessage("Endplatzierung noch nicht verfuegbar.");
    $("#downloadCertificateButton")?.addEventListener("click", () => exportCertificatePdf(playerName));
  }

  function isTournamentComplete(tournament) {
    const finals = tournament?.finals || [];
    return finals.length > 0 && finals.every((match) => BeachTournament.matchResult(match));
  }

  function setSummary(match) {
    return (match.sets || []).map(setText).filter(Boolean).join(", ") || "offen";
  }

  function renderRegistrationLink() {
    $("#registrationLink").value = active.registrationLink || "";
  }

  function copyRegistrationLink() {
    const link = $("#registrationLink").value.trim();
    if (!link) return;
    active.registrationLink = link;
    saveActive({ immediate: true });
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link);
      return;
    }
    $("#registrationLink").select();
    document.execCommand("copy");
  }

  function renderTeams() {
    const tournament = active.tournament;
    if (!tournament) {
      $("#groupsView").innerHTML = emptyMessage("Noch keine Teams ausgelost.");
      return;
    }
    $("#groupsView").innerHTML = BeachTournament.groupNames(tournament).map((group) => {
      const teams = tournament.groups[group] || [];
      return `<article class="group-card">
        <h3>Gruppe ${group}</h3>
        <ul>${teams.map(teamChip).join("")}</ul>
      </article>`;
    }).join("");
    bindTeamNameInputs();
  }

  function teamChip(team) {
    const canEdit = canEditTeamName(team);
    return `<li class="team-chip">
      <label>
        Teamname
        <input class="team-name-input" data-team-name="${team.id}" type="text" value="${escapeHtml(team.name)}" placeholder="Teamname"${canEdit ? "" : " disabled"}>
      </label>
      <span>${team.players.map(escapeHtml).join(" & ")}</span>
    </li>`;
  }

  function canEditTeamName(team) {
    if (isTournamentStarted()) return false;
    if (isSharedHost()) return true;
    if (!active.tournament || !team) return false;
    const owners = active.playerOwners || {};
    const currentUserId = SharedTournamentStore.getCurrentUserId?.() || "";
    return team.players.some((player) => owners[player] === currentUserId);
  }

  function isTournamentStarted() {
    return Boolean(active.tournament?.startedAt);
  }

  function bindTeamNameInputs() {
    document.querySelectorAll("[data-team-name]").forEach((input) => {
      input.addEventListener("input", () => {
        if (isSharedPlayer()) return;
        if (isDuplicateTeamName(input.dataset.teamName, input.value)) return;
        updateTeamName(input.dataset.teamName, input.value);
        saveActive();
        renderLive();
      });
      input.addEventListener("change", async () => {
        const team = findTeam(input.dataset.teamName);
        if (!team) return;
        const fallback = input.dataset.originalName || team.name || "Team";
        const nextName = input.value.trim() || fallback;
        if (isDuplicateTeamName(input.dataset.teamName, nextName)) {
          alert("Dieser Teamname ist bereits vergeben.");
          input.value = team.name;
          return;
        }
        if (isSharedPlayer()) {
          try {
            activeShared = await SharedTournamentStore.setSharedTeamName(active.id, input.dataset.teamName, nextName);
            render();
          } catch (error) {
            alert(error.message.includes("already")
              ? "Dieser Teamname ist bereits vergeben."
              : `Teamname konnte nicht gespeichert werden: ${error.message}`);
            input.value = team.name;
          }
          return;
        }
        input.value = nextName;
        updateTeamName(input.dataset.teamName, nextName);
        persistAndRender({ immediate: true });
      });
    });
  }

  function isDuplicateTeamName(teamId, name) {
    const normalized = name.trim().toLocaleLowerCase("de-DE");
    if (!normalized || !active.tournament) return false;
    return (active.tournament.teams || []).some((team) => {
      return team.id !== teamId && team.name.trim().toLocaleLowerCase("de-DE") === normalized;
    });
  }

  function updateTeamName(teamId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    (active.tournament?.teams || []).forEach((team) => {
      if (team.id === teamId) team.name = trimmed;
    });
    Object.values(active.tournament?.groups || {}).forEach((groupTeams) => {
      groupTeams.forEach((team) => {
        if (team.id === teamId) team.name = trimmed;
      });
    });
  }

  function findTeam(teamId) {
    if (!active.tournament) return null;
    return (active.tournament.teams || []).find((team) => team.id === teamId) || null;
  }

  function renderMatches() {
    const tournament = active.tournament;
    if (!tournament) {
      $("#matchList").innerHTML = emptyMessage("Nach der Auslosung erscheint hier die Gruppenphase.");
      $("#refereeList").innerHTML = emptyMessage("Nach der Auslosung erscheint hier die Schiedsrichter-Übersicht.");
      $("#progressPill").textContent = "0 Spiele eingetragen";
      return;
    }
    $("#matchList").innerHTML = tournament.matches.map((match) => matchCard(match, tournament)).join("");
    bindScoreInputs(tournament.matches, "#matchList");
    $("#refereeList").innerHTML = refereeOverview(tournament.matches, tournament);
    const done = tournament.matches.filter((match) => BeachTournament.matchResult(match)).length;
    $("#progressPill").textContent = `${done}/${tournament.matches.length} Gruppenspiele eingetragen`;
    if (isSharedHost() && BeachTournament.allGroupMatchesComplete(tournament) && tournament.finals.length === 0) {
      tournament.finals = BeachTournament.finalsMatches(tournament);
      saveActive({ immediate: true });
    }
  }

  function renderStandings() {
    const tournament = active.tournament;
    if (!tournament) {
      $("#standingsView").innerHTML = emptyMessage("Noch keine Tabelle verfügbar.");
      return;
    }
    $("#standingsView").innerHTML = BeachTournament.groupNames(tournament).map((group) => {
      const rows = BeachTournament.standingsForGroup(group, tournament);
      return `<article class="standing-card">
        <h3>Gruppe ${group}</h3>
        <table>
          <thead><tr><th>#</th><th>Team</th><th>S</th><th>N</th><th>Diff</th><th>Punkte</th></tr></thead>
          <tbody>${rows
            .map(
              (row, index) => `<tr>
                <td>${index + 1}</td>
                <td>${teamLabel(row.team)}</td>
                <td>${row.wins}</td>
                <td>${row.losses}</td>
                <td>${row.pointDiff}</td>
                <td>${row.pointsFor}:${row.pointsAgainst}</td>
              </tr>`
            )
            .join("")}</tbody>
        </table>
      </article>`;
    }).join("");
  }

  function renderFinals() {
    const tournament = active.tournament;
    if (!tournament) {
      $("#finalsList").innerHTML = emptyMessage("Die KO-Phase entsteht nach Abschluss der Gruppenphase.");
      $("#rankingList").innerHTML = "";
      $("#finalsRefereeList").innerHTML = "";
      return;
    }
    tournament.finals = BeachTournament.finalsMatches(tournament);
    $("#finalsList").innerHTML = tournament.finals.map((match) => matchCard(match, tournament)).join("");
    bindScoreInputs(tournament.finals, "#finalsList");
    $("#finalsRefereeList").innerHTML = refereeOverview(tournament.finals, tournament);
    renderRanking();
  }

  function renderRanking() {
    const tournament = active.tournament;
    $("#rankingList").innerHTML = placementListItemsHtml(finalPlacements(tournament));
  }

  function finalPlacements(tournament) {
    const finals = tournament?.finals || [];
    const teamMap = teamLookup(tournament);
    const bySlot = new Map(finals.map((match) => [match.slot, match]));
    const placementSlots = [
      { place: 1, slot: "final", resultKey: "winner", placeholder: "Gewinner Finale" },
      { place: 2, slot: "final", resultKey: "loser", placeholder: "Verlierer Finale" },
      { place: 3, slot: "place3", resultKey: "winner", placeholder: "Gewinner Spiel um Platz 3" },
      { place: 4, slot: "place3", resultKey: "loser", placeholder: "Verlierer Spiel um Platz 3" },
      { place: 5, slot: "place5", resultKey: "winner", placeholder: "Gewinner Spiel um Platz 5" },
      { place: 6, slot: "place5", resultKey: "loser", placeholder: "Verlierer Spiel um Platz 5" },
    ];
    return placementSlots.map((item) => {
      const match = bySlot.get(item.slot);
      const result = match ? BeachTournament.matchResult(match) : null;
      const teamId = result?.[item.resultKey] || "";
      return {
        ...item,
        teamId,
        team: teamMap.get(teamId) || null,
      };
    });
  }

  function placementListHtml(placements, ownTeamId = "") {
    return `<ol class="ranking-list placement-list">${placementListItemsHtml(placements, ownTeamId)}</ol>`;
  }

  function placementListItemsHtml(placements, ownTeamId = "") {
    return placements.map((item) => {
      const text = item.team ? teamLabel(item.team) : escapeHtml(item.placeholder);
      const classes = [
        "placement-row",
        `placement-${item.place}`,
        item.team ? "" : "is-placeholder",
        item.teamId === ownTeamId ? "is-own-team" : "",
      ].filter(Boolean).join(" ");
      return `<li class="${classes}">
        <strong>${item.place}. Platz</strong>
        <span>${text}</span>
      </li>`;
    }).join("");
  }

  function courtLabel(match) {
    return `Feld ${match?.court || 1}`;
  }

  function matchCard(match, tournament) {
    const result = BeachTournament.matchResult(match);
    const current = !result && match.teamA && match.teamB ? " is-current" : "";
    const sets = match.sets || [];
    const scoreDisabled = isSharedHost() ? "" : " disabled";
    return `<article class="match-card${current}">
      <div class="match-meta">${escapeHtml(match.label)} · bis ${match.target}${match.bestOf > 1 ? " · Best-of-3" : ""}
        <span class="match-referee">${courtLabel(match)} - Schiri: ${refereeLabel(match, tournament)}</span>
      </div>
      <div class="match-teams">${matchTeamName(match.teamA, tournament)}<br>vs<br>${matchTeamName(match.teamB, tournament)}</div>
      <div class="score-inputs">
        ${sets
          .map(
            (set, index) => `<div class="set-row">
              <span>Satz ${index + 1}</span>
              <input data-match="${match.id}" data-set="${index}" data-side="a" inputmode="numeric" pattern="[0-9]*" maxlength="2" type="text" value="${escapeHtml(set.a)}" aria-label="Team A Satz ${index + 1}"${scoreDisabled}>
              <input data-match="${match.id}" data-set="${index}" data-side="b" inputmode="numeric" pattern="[0-9]*" maxlength="2" type="text" value="${escapeHtml(set.b)}" aria-label="Team B Satz ${index + 1}"${scoreDisabled}>
            </div>`
          )
          .join("")}
      </div>
    </article>`;
  }

  function bindScoreInputs(matches, containerSelector) {
    document.querySelectorAll(`${containerSelector} [data-match]`).forEach((input) => {
      if (input.disabled) return;
      input.addEventListener("input", () => {
        updateScoreInput(input, matches);
        scheduleScoreSave();
        renderLive();
      });
      input.addEventListener("change", () => {
        updateScoreInput(input, matches);
        saveScores({ immediate: true });
      });
      input.addEventListener("blur", () => {
        updateScoreInput(input, matches);
        saveScores({ immediate: true });
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const inputs = [...document.querySelectorAll(`${containerSelector} [data-match]`)];
        const currentIndex = inputs.indexOf(input);
        updateScoreInput(input, matches);
        saveScores({ immediate: true });
        const next = inputs[currentIndex + 1];
        if (next && currentIndex >= 0) {
          next.focus();
        } else {
          input.blur();
        }
      });
    });
  }

  function updateScoreInput(input, matches) {
    const match = matches.find((item) => item.id === input.dataset.match);
    if (!match) return;
    const value = input.value.replace(/\D/g, "").slice(0, 2);
    if (input.value !== value) input.value = value;
    match.sets[Number(input.dataset.set)][input.dataset.side] = value;
  }

  function syncVisibleScoreInputs() {
    if (!active.tournament) return;
    const matches = [...(active.tournament.matches || []), ...(active.tournament.finals || [])];
    document.querySelectorAll("[data-match][data-set][data-side]").forEach((input) => {
      updateScoreInput(input, matches);
    });
  }

  function updateDerivedScores() {
    if (active.tournament) {
      active.tournament.finals = BeachTournament.finalsMatches(active.tournament);
    }
  }

  function scheduleScoreSave() {
    window.clearTimeout(scoreSaveTimer);
    scoreSaveTimer = window.setTimeout(() => saveScores(), 1000);
  }

  function saveScores(options = {}) {
    window.clearTimeout(scoreSaveTimer);
    scoreSaveTimer = null;
    syncVisibleScoreInputs();
    updateDerivedScores();
    saveActive({ immediate: Boolean(options.immediate) });
    scheduleScoreRender();
  }

  function scheduleScoreRender() {
    window.clearTimeout(scoreRenderTimer);
    scoreRenderTimer = window.setTimeout(() => {
      if (document.activeElement?.matches("[data-match]")) {
        scheduleScoreRender();
        return;
      }
      commitScores();
    }, 450);
  }

  function commitScores() {
    render();
  }

  function refereeOverview(matches, tournament) {
    const activeMatches = matches;
    if (activeMatches.length === 0) return emptyMessage("Noch keine Schiedsrichter verfügbar.");
    return activeMatches
      .map(
        (match) => `<div class="referee-row">
          <strong>${escapeHtml(match.label)}</strong>
          <span>${refereeLabel(match, tournament)}</span>
        </div>`
      )
      .join("");
  }

  function refereeLabel(match, tournament) {
    const referee = refereeForMatch(match, tournament);
    return escapeHtml(referee);
  }

  function refereeTeamIdForMatch(match, tournament) {
    if (match.phase === "group") {
      const refereeTeam = (tournament.groups[match.group] || []).find((team) => {
        return team.id !== match.teamA && team.id !== match.teamB;
      }) || (tournament.teams || []).find((team) => {
        return team.group === match.group && team.id !== match.teamA && team.id !== match.teamB;
      });
      return refereeTeam?.id || "";
    }
    const refereeText = refereeForMatch(match, tournament);
    const team = (tournament.teams || []).find((item) => plainTeamLabel(item) === refereeText);
    return team?.id || "";
  }

  function refereeForMatch(match, tournament) {
    if (match.phase === "group") {
      const refereeTeam = (tournament.groups[match.group] || []).find((team) => {
        return team.id !== match.teamA && team.id !== match.teamB;
      });
      return refereeTeam ? plainTeamLabel(refereeTeam) : "noch offen";
    }
    const groups = BeachTournament.groupNames(tournament);
    const tableA = BeachTournament.standingsForGroup(groups[0] || "A", tournament);
    const tableB = BeachTournament.standingsForGroup(groups[1] || "B", tournament);
    const semi1 = (tournament.finals || []).find((item) => item.slot === "semi1");
    const place3 = (tournament.finals || []).find((item) => item.slot === "place3");
    const place5 = (tournament.finals || []).find((item) => item.slot === "place5");
    const semi1Result = semi1 ? BeachTournament.matchResult(semi1) : null;
    const place3Result = place3 ? BeachTournament.matchResult(place3) : null;
    const place5Result = place5 ? BeachTournament.matchResult(place5) : null;
    if (!semi1 && !place5) return "noch offen";
    if (match.slot === "semi1") return tableA[2]?.team ? plainTeamLabel(tableA[2].team) : `3. Gruppe ${groups[0] || "A"}`;
    if (match.slot === "semi2") return tableB[2]?.team ? plainTeamLabel(tableB[2].team) : `3. Gruppe ${groups[1] || "B"}`;
    if (match.slot === "place5") return semi1Result?.loser ? textTeamName(semi1Result.loser, tournament) : "noch offen: Verlierer Halbfinale 1";
    if (match.slot === "place3") return place5Result?.loser ? textTeamName(place5Result.loser, tournament) : "noch offen: Verlierer Spiel um Platz 5";
    if (match.slot === "final") return place3Result?.winner ? textTeamName(place3Result.winner, tournament) : "noch offen: Sieger Spiel um Platz 3";
    return "noch offen";
  }

  function renderLive() {
    const tournament = active.tournament;
    if (!tournament) {
      $("#currentMatch").textContent = "Noch kein Spiel gestartet";
      $("#nextMatch").textContent = "Gruppenphase vorbereiten";
      return;
    }
    const all = [...tournament.matches, ...(tournament.finals || [])].filter((match) => match.teamA && match.teamB);
    const open = all.filter((match) => !BeachTournament.matchResult(match));
    $("#currentMatch").textContent = open[0] ? liveLabel(open[0], tournament) : "Alle Spiele abgeschlossen";
    $("#nextMatch").textContent = open[1] ? liveLabel(open[1], tournament) : "Kein weiteres Spiel offen";
  }

  function liveLabel(match, tournament) {
    return `${match.label} (${courtLabel(match)}): ${matchTeamName(match.teamA, tournament)} vs ${matchTeamName(match.teamB, tournament)}`;
  }

  function teamLookup(tournament) {
    return new Map((tournament?.teams || []).map((team) => [team.id, team]));
  }

  function matchTeamName(teamId, tournament) {
    if (!teamId) return "steht noch aus";
    const team = teamLookup(tournament).get(teamId);
    return team ? teamLabel(team) : "unbekannt";
  }

  function teamLabel(team) {
    if (!team) return "steht noch aus";
    return `${escapeHtml(team.name)} (${team.players.map(escapeHtml).join(" & ")})`;
  }

  function exportCsv() {
    const tournament = active.tournament;
    if (!tournament) return;
    const rows = csvReportRows(tournament);
    downloadText(reportFilename("csv"), `\uFEFFsep=;\r\n${rows.map(csvRow).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  function exportPdf() {
    const tournament = active.tournament;
    if (!tournament) return;
    const lines = reportLines(tournament);
    const pdf = buildSimplePdf(lines);
    const blob = new Blob([pdf], { type: "application/pdf" });
    downloadBlob(reportFilename("pdf"), blob);
  }

  function csvReportRows(tournament) {
    const rows = [
      ["Konfiguration"],
      ["Turnier", active.name || DEFAULT_TOURNAMENT_NAME],
      ["Exportiert am", new Date().toLocaleString("de-DE")],
      ["Modus", mode === "shared" ? "Shared Lobby" : "Lokales Turnier"],
    ];
    tournamentConfigRows(tournament).forEach((row) => rows.push(row));

    rows.push([], ["Teams"], ["Gruppe", "Team", "Spieler"]);
    teamRows(tournament).forEach((row) => rows.push([row.group, row.name, row.players]));

    rows.push([], ["Ergebnisse"], ["Phase", "Spiel", "Spielfeld", "Team A", "Team B", "Schiedsrichter", "Satz 1", "Satz 2", "Satz 3", "Sieger"]);
    matchRows(tournament).forEach((row) => rows.push([
      row.phase,
      row.label,
      row.court,
      row.teamA,
      row.teamB,
      row.referee,
      row.sets[0] || "",
      row.sets[1] || "",
      row.sets[2] || "",
      row.winner,
    ]));

    rows.push([], ["Finale Platzierungen"], ["Platz", "Team", "Spieler"]);
    finalPlacementRows(tournament).forEach((row) => rows.push([row.place, row.team, row.players]));
    return rows;
  }

  function exportCertificatePdf(playerName) {
    const tournament = active.tournament;
    if (!tournament || !playerName) return;
    const team = (tournament.teams || []).find((item) => item.players.includes(playerName));
    if (!team) return;
    const placement = finalPlacements(tournament).find((item) => item.team?.id === team.id);
    if (!placement?.team) {
      alert("Die finale Platzierung ist noch nicht verfuegbar.");
      return;
    }
    const pdf = buildCertificatePdf({
      playerName,
      team,
      placement,
      tournamentName: active.name || DEFAULT_TOURNAMENT_NAME,
      date: new Date().toLocaleDateString("de-DE"),
    });
    const safeName = playerName.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "spieler";
    downloadBlob(`urkunde-${safeName}.pdf`, new Blob([pdf], { type: "application/pdf" }));
  }

  function legacyReportLines(tournament) {
    return [];
    const lines = [`${active.name || DEFAULT_TOURNAMENT_NAME} Ergebnisse`, `Stand: ${new Date().toLocaleString("de-DE")}`, ""];
    BeachTournament.groupNames(tournament).forEach((group) => {
      lines.push(`Gruppe ${group}`);
      BeachTournament.standingsForGroup(group, tournament).forEach((row, index) => {
        lines.push(`${index + 1}. ${plainTeamLabel(row.team)} · S ${row.wins} · N ${row.losses} · Diff ${row.pointDiff} · Punkte ${row.pointsFor}:${row.pointsAgainst}`);
      });
      lines.push("");
    });
    [...tournament.matches, ...(tournament.finals || [])].forEach((match) => {
      lines.push(`${match.label} (${courtLabel(match)}): ${textTeamName(match.teamA, tournament)} vs ${textTeamName(match.teamB, tournament)} - Schiri: ${refereeForMatch(match, tournament)} - ${match.sets.map(setText).filter(Boolean).join(", ") || "offen"}`);
    });
    const placements = finalPlacements(tournament);
    if (placements.length) {
      lines.push("", "Endplatzierung");
      placements.forEach((item) => lines.push(`${item.place}. ${item.team ? plainTeamLabel(item.team) : item.placeholder}`));
    }
    return lines;
  }

  function reportLines(tournament) {
    const lines = [`${active.name || DEFAULT_TOURNAMENT_NAME}`, `Exportiert am ${new Date().toLocaleString("de-DE")}`, ""];
    lines.push("Konfiguration");
    tournamentConfigRows(tournament).forEach((row) => lines.push(`${row[0]}: ${row[1]}`));

    lines.push("", "Teams");
    teamRows(tournament).forEach((row) => lines.push(`Gruppe ${row.group}: ${row.name} - ${row.players}`));

    lines.push("", "Ergebnisse");
    matchRows(tournament).forEach((row) => {
      lines.push(`${row.phase} - ${row.label} (${row.court})`);
      lines.push(`${row.teamA || "offen"} vs ${row.teamB || "offen"}`);
      lines.push(`Schiedsrichter: ${row.referee || "offen"} - Ergebnis: ${row.resultText || "offen"} - Sieger: ${row.winner || "offen"}`);
    });

    lines.push("", "Finale Platzierungen");
    finalPlacementRows(tournament).forEach((row) => lines.push(`${row.place}. ${row.team} - ${row.players}`));
    return lines;
  }

  function tournamentConfigRows(tournament) {
    const format = BeachTournament.normalizeFormat(tournament.format || active.format || DEFAULT_FORMAT);
    return [
      ["Spieler", format.totalPlayers],
      ["Teams", format.teamCount],
      ["Spieler pro Team", format.playersPerTeam],
      ["Gruppen", format.groupCount],
      ["Spielfelder", format.courtCount],
      ["Satz bis", format.targetScore],
      ["Finale", `Best-of-${format.finalsBestOf}`],
      ["Turnier gestartet", tournament.startedAt ? new Date(tournament.startedAt).toLocaleString("de-DE") : "nein"],
    ];
  }

  function teamRows(tournament) {
    return BeachTournament.groupNames(tournament).flatMap((group) => {
      return (tournament.groups[group] || []).map((team) => ({
        group,
        name: team.name,
        players: team.players.join(" & "),
      }));
    });
  }

  function matchRows(tournament) {
    return [...(tournament.matches || []), ...(tournament.finals || [])].map((match) => {
      const result = BeachTournament.matchResult(match);
      const sets = (match.sets || []).map(setText).filter(Boolean);
      return {
        phase: match.phase === "group" ? "Gruppenphase" : "KO-Phase",
        label: match.label,
        court: courtLabel(match),
        teamA: textTeamName(match.teamA, tournament),
        teamB: textTeamName(match.teamB, tournament),
        referee: refereeForMatch(match, tournament),
        sets,
        resultText: sets.join(", "),
        winner: result ? textTeamName(result.winner, tournament) : "",
      };
    });
  }

  function finalPlacementRows(tournament) {
    return finalPlacements(tournament).map((item) => ({
      place: item.place,
      team: item.team ? item.team.name : item.placeholder,
      players: item.team ? item.team.players.join(" & ") : "",
    }));
  }

  function buildSimplePdf(lines) {
    const pages = paginateLines(lines, 92, 48);
    const fontObjectNumber = 3 + pages.length * 2;
    const boldFontObjectNumber = fontObjectNumber + 1;
    const pageObjects = [];
    const contentObjects = [];
    pages.forEach((pageLines, pageIndex) => {
      const content = ["BT", pageIndex === 0 ? "/F2 14 Tf" : "/F1 11 Tf", "50 790 Td"];
      pageLines.forEach((line, index) => {
        if (index > 0) content.push("0 -15 Td");
        content.push(`${pdfFontForLine(line)} (${pdfEscape(line)}) Tj`);
      });
      content.push("ET");
      const stream = content.join("\n");
      const contentObjectNumber = 3 + pages.length + pageIndex;
      pageObjects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectNumber} 0 R /F2 ${boldFontObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
      contentObjects.push(`<< /Length ${pdfByteLength(stream)} >>\nstream\n${stream}\nendstream`);
    });
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pageObjects.map((_, index) => `${3 + index} 0 R`).join(" ")}] /Count ${pageObjects.length} >>`,
      ...pageObjects,
      ...contentObjects,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdfByteLength(pdf));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdfByteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  function paginateLines(lines, lineLimit, linesPerPage) {
    const wrapped = wrapLines(lines, lineLimit);
    const pages = [];
    for (let index = 0; index < wrapped.length; index += linesPerPage) {
      pages.push(wrapped.slice(index, index + linesPerPage));
    }
    return pages.length ? pages : [[""]];
  }

  function pdfFontForLine(line) {
    return ["Konfiguration", "Teams", "Ergebnisse", "Finale Platzierungen"].includes(line) ? "/F2 12 Tf" : "/F1 11 Tf";
  }

  function pdfByteLength(value) {
    return new Blob([value]).size;
  }

  function buildCertificatePdf(data) {
    const theme = certificateTheme(data.placement.place);
    const teammateText = data.team.players.filter((name) => name !== data.playerName).join(" & ") || "kein Teamkollege";
    const title = data.placement.place === 1 ? "Siegerurkunde" : "Turnierurkunde";
    const subtitle = data.placement.place <= 3 ? theme.subtitle : "Starke Leistung im BeachCup";
    const content = [
      "q",
      `${theme.bg} rg 0 0 595 842 re f`,
      `${theme.border} RG 14 w 34 34 527 774 re S`,
      `${theme.accent} rg 58 706 479 58 re f`,
      `${theme.border} RG 3 w 74 118 447 516 re S`,
      `${theme.accent} RG 2 w 90 134 415 484 re S`,
      "Q",
      "BT",
      "/F2 34 Tf",
      `${theme.titleColor} rg`,
      `90 724 Td (${pdfEscape(title)}) Tj`,
      "/F1 14 Tf",
      `0 -34 Td (${pdfEscape(data.tournamentName)}) Tj`,
      "/F2 92 Tf",
      `${theme.medalColor} rg`,
      `145 -142 Td (${data.placement.place}) Tj`,
      "/F2 30 Tf",
      `${theme.titleColor} rg`,
      `-96 -54 Td (${pdfEscape(`${data.placement.place}. Platz`)}) Tj`,
      "/F2 28 Tf",
      `0 -58 Td (${pdfEscape(data.playerName)}) Tj`,
      "/F1 17 Tf",
      `0 -34 Td (${pdfEscape(data.team.name)}) Tj`,
      "/F1 13 Tf",
      `0 -26 Td (${pdfEscape(`Teamkollege: ${teammateText}`)}) Tj`,
      "/F2 16 Tf",
      `0 -58 Td (${pdfEscape(subtitle)}) Tj`,
      "/F1 12 Tf",
      `0 -118 Td (${pdfEscape(`Turnierdatum: ${data.date}`)}) Tj`,
      `0 -20 Td (${pdfEscape("1. WWS-Herren BeachCup")}) Tj`,
      "ET",
      ...certificateDecoration(data.placement.place),
    ].join("\n");
    return buildPdfFromContent(content);
  }

  function certificateTheme(place) {
    if (place === 1) {
      return { bg: "1 0.965 0.82", accent: "0.92 0.62 0.12", border: "0.74 0.46 0.08", titleColor: "0.28 0.18 0.04", medalColor: "0.9 0.55 0.06", subtitle: "Gold, Sand und Nervenstaerke" };
    }
    if (place === 2) {
      return { bg: "0.94 0.95 0.96", accent: "0.68 0.72 0.76", border: "0.46 0.5 0.55", titleColor: "0.16 0.19 0.22", medalColor: "0.62 0.66 0.7", subtitle: "Silber mit grosser Klasse" };
    }
    if (place === 3) {
      return { bg: "0.98 0.9 0.78", accent: "0.72 0.42 0.18", border: "0.95 0.68 0.12", titleColor: "0.26 0.16 0.08", medalColor: "0.66 0.34 0.12", subtitle: "Podium verdient erkaempft" };
    }
    return { bg: "0.95 0.98 0.98", accent: "0.18 0.58 0.64", border: "0.08 0.36 0.4", titleColor: "0.08 0.24 0.27", medalColor: "0.12 0.48 0.54", subtitle: "Mit Einsatz und Teamgeist" };
  }

  function certificateDecoration(place) {
    if (place === 1) {
      return ["q", "0.95 0.72 0.18 rg 462 620 36 36 re f", "0.74 0.46 0.08 RG 4 w 438 582 84 78 re S", "Q", "BT /F2 12 Tf 0.28 0.18 0.04 rg 458 604 Td (POKAL) Tj ET"];
    }
    if (place === 2) {
      return ["q", "0.78 0.8 0.82 rg 462 620 36 36 re f", "0.46 0.5 0.55 RG 4 w 438 582 84 78 re S", "Q", "BT /F2 12 Tf 0.16 0.19 0.22 rg 448 604 Td (MEDAILLE) Tj ET"];
    }
    if (place === 3) {
      return ["q", "0.76 0.43 0.18 rg 462 620 36 36 re f", "0.95 0.68 0.12 RG 5 w 438 582 84 78 re S", "Q", "BT /F2 12 Tf 0.26 0.16 0.08 rg 452 604 Td (PODIUM) Tj ET"];
    }
    return ["q", "0.18 0.58 0.64 rg 462 620 36 36 re f", "0.08 0.36 0.4 RG 3 w 438 582 84 78 re S", "Q"];
  }

  function buildPdfFromContent(stream) {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return pdf;
  }

  function wrapLines(lines, limit) {
    const output = [];
    lines.forEach((line) => {
      let rest = line;
      while (rest.length > limit) {
        output.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      output.push(rest);
    });
    return output;
  }

  function importBackup(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirmDestructive("Daten vollständig überschreiben")) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(reader.result);
        const imported = normalizeImportedTournament(backup);
        active = BeachCupStore.saveTournament(imported);
        persistAndRender();
      } catch {
        alert("Backup konnte nicht gelesen werden.");
      }
    };
    reader.readAsText(file);
  }

  function normalizeImportedTournament(backup) {
    const now = new Date().toISOString();
    if (backup && Array.isArray(backup.players) && Object.prototype.hasOwnProperty.call(backup, "tournament")) {
      return {
        id: backup.id || undefined,
        name: backup.name || `${DEFAULT_TOURNAMENT_NAME} Import`,
        players: backup.players || [],
        playerOwners: backup.playerOwners || {},
        format: BeachTournament.normalizeFormat(backup.format || DEFAULT_FORMAT),
        tournament: backup.tournament || null,
        registrationLink: backup.registrationLink || "",
        logoSrc: backup.logoSrc || DEFAULT_LOGO_SRC,
        createdAt: backup.createdAt || now,
        updatedAt: now,
      };
    }
    return {
      id: undefined,
      name: `${DEFAULT_TOURNAMENT_NAME} Import`,
      players: backup.players || [],
      playerOwners: backup.playerOwners || {},
      format: BeachTournament.normalizeFormat(backup.format || DEFAULT_FORMAT),
      tournament: backup.tournament || null,
      registrationLink: backup.registrationLink || "",
      logoSrc: backup.logoSrc || DEFAULT_LOGO_SRC,
      createdAt: now,
      updatedAt: now,
    };
  }

  function csvRow(row) {
    return row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(";");
  }

  function reportFilename(extension) {
    const safeName = (active.name || DEFAULT_TOURNAMENT_NAME).toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "beachturnier";
    return `${safeName}-export.${extension}`;
  }

  function setText(set) {
    return set && set.a !== "" && set.b !== "" ? `${set.a}:${set.b}` : "";
  }

  function textTeamName(teamId, tournament) {
    const team = teamLookup(tournament).get(teamId);
    return team ? plainTeamLabel(team) : "";
  }

  function plainTeamLabel(team) {
    return `${team.name} (${team.players.join(" & ")})`;
  }

  function downloadText(filename, text, type = "text/plain") {
    downloadBlob(filename, new Blob([text], { type }));
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function emptyMessage(message) {
    return `<p class="muted">${escapeHtml(message)}</p>`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function pdfEscape(value) {
    return String(value)
      .replaceAll("Ä", "Ae")
      .replaceAll("Ö", "Oe")
      .replaceAll("Ü", "Ue")
      .replaceAll("ä", "ae")
      .replaceAll("ö", "oe")
      .replaceAll("ü", "ue")
      .replaceAll("ß", "ss")
      .replace(/[^\x20-\x7E]/g, "?")
      .replaceAll("\\", "\\\\")
      .replaceAll("(", "\\(")
      .replaceAll(")", "\\)");
  }

  init().catch((error) => {
    console.error(error);
    alert(`Die App konnte nicht vollständig gestartet werden: ${error.message}`);
  });
})();
