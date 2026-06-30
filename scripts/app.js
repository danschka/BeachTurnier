(function () {
  const DEFAULT_TOURNAMENT_NAME = "1. WWS-Herren BeachCup";
  const DEFAULT_LOGO_SRC = BeachCupStore.DEFAULT_LOGO_SRC || "assets/wilde-wespen-logo.jpeg";
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
  let activeShared = null;
  let sharedError = "";
  const $ = (selector) => document.querySelector(selector);
  let scoreRenderTimer = null;
  let sharedSaveTimer = null;
  let sharedSaveInFlight = false;
  let sharedSaveQueued = false;
  let sharedSaveGeneration = 0;

  function refreshActive() {
    if (mode === "shared" && activeShared) {
      active = SharedTournamentStore.sharedToActiveTournament(activeShared);
    } else if (mode === "shared") {
      active = {
        id: "",
        name: "Shared Lobby",
        players: [],
        tournament: null,
        registrationLink: "",
        logoSrc: DEFAULT_LOGO_SRC,
      };
    } else if (mode === "local") {
      active = BeachCupStore.getActiveTournament();
    }
    settings = BeachCupStore.getSettings();
  }

  function saveActive(options = {}) {
    if (mode === "shared") {
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
    window.clearTimeout(sharedSaveTimer);
    sharedSaveTimer = null;
    sharedSaveInFlight = false;
    sharedSaveQueued = false;
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
          }
        }
      })
      .catch((error) => {
        if (saveGeneration !== sharedSaveGeneration) return;
        alert(`Shared Lobby konnte nicht gespeichert werden: ${error.message}`);
      })
      .finally(() => {
        if (saveGeneration !== sharedSaveGeneration) return;
        sharedSaveInFlight = false;
        if (sharedSaveQueued && mode === "shared") {
          sharedSaveQueued = false;
          scheduleSharedSave(true);
        }
      });
  }

  function cloneTournament(tournament) {
    return JSON.parse(JSON.stringify(tournament));
  }

  function snapshotActiveForShared() {
    return {
      id: active.id,
      name: active.name || DEFAULT_TOURNAMENT_NAME,
      players: active.players || [],
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
      $("#playerName").value = "";
    });
    $("#samplePlayersButton").addEventListener("click", () => {
      active.players = [...SAMPLE_PLAYERS];
      active.tournament = null;
      persistAndRender();
    });
    $("#clearAllButton").addEventListener("click", () => {
      if (!confirmDestructive("alle Teilnehmer löschen")) return;
      if (!confirm("Alle Daten dieses Turniers löschen?")) return;
      active.players = [];
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
    $("#generateTournamentButton").addEventListener("click", generateTournament);
    $("#reshuffleButton").addEventListener("click", generateTournament);
    $("#buildFinalsButton").addEventListener("click", () => {
      if (!active.tournament) return;
      active.tournament.finals = BeachTournament.finalsMatches(active.tournament);
      persistAndRender();
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
    $("#publishLocalButton").addEventListener("click", publishLocalTournament);
    $("#leaveSharedLobbyButton").addEventListener("click", () => leaveSharedLobby(true));
  }

  async function openSharedLobbyFromUrl() {
    const shareCode = getShareCodeFromLocation();
    if (!shareCode) return;
    try {
      activeShared = await SharedTournamentStore.joinSharedTournamentByCode(shareCode);
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

  function subscribeToActiveSharedLobby() {
    if (!activeShared) return;
    SharedTournamentStore.subscribeToSharedTournament(
      activeShared.id,
      (shared) => {
        if (mode !== "shared" || shared.id !== activeShared?.id) return;
        activeShared = shared;
        render();
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
      tournament: null,
    };
    await activateSharedFromLocalCopy(localCopy);
  }

  async function publishLocalTournament() {
    if (mode !== "local") return;
    await activateSharedFromLocalCopy(active);
  }

  async function activateSharedFromLocalCopy(localCopy) {
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
      await copyShareLink();
    } catch (error) {
      alert(`Shared Lobby konnte nicht erstellt werden: ${error.message}`);
    }
  }

  function replaceLobbyUrl(shareCode) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = `lobby=${encodeURIComponent(shareCode)}`;
    window.history.replaceState({}, "", url.toString());
  }

  function clearLobbyUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete("lobby");
    url.hash = "";
    window.history.replaceState({}, "", url.toString());
  }

  async function copyShareLink() {
    if (!activeShared) return;
    const link = SharedTournamentStore.getShareLink(activeShared);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(link);
    } else {
      prompt("Link zum Turnier:", link);
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
    return confirm(`Achtung: Alle Personen mit diesem Link können "${action}" ausführen. Fortfahren?`);
  }

  function showTab(id) {
    const tab = document.querySelector(`.tab[data-tab="${id}"]`);
    if (tab) tab.click();
  }

  function persistAndRender(options = { immediate: true }) {
    saveActive(options);
    render();
  }

  function addPlayer(name) {
    const trimmed = name.trim();
    if (!trimmed || active.players.includes(trimmed) || active.players.length >= 12) return;
    active.players.push(trimmed);
    active.tournament = null;
    persistAndRender();
  }

  function generateTournament() {
    if (active.players.length !== 12) {
      alert("Für die Auslosung werden genau 12 Teilnehmer benötigt.");
      return;
    }
    if (active.tournament && !confirmDestructive("Spielplan zurücksetzen")) return;
    active.tournament = BeachTournament.createTournament(active.players);
    persistAndRender();
    showTab("teams");
  }

  function render() {
    refreshActive();
    renderHeader();
    renderTournamentManager();
    renderLogoManager();
    renderPlayers();
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
    document.title = title;
    $("#tournamentTitle").textContent = title;
    $("#tournamentLogo").src = logoSrc;
    $("#tournamentLogo").alt = `${title} Logo`;
  }

  function renderTournamentManager() {
    $("#hostIdLabel").textContent = BeachCupStore.getCurrentHostId();
    const tournaments = BeachCupStore.getAllTournaments();
    $("#tournamentSelect").innerHTML = tournaments
      .map((item) => `<option value="${item.id}"${item.id === active.id ? " selected" : ""}>${escapeHtml(item.name || DEFAULT_TOURNAMENT_NAME)}</option>`)
      .join("");
    $("#tournamentNameInput").value = active.name || DEFAULT_TOURNAMENT_NAME;
    $("#modeLabel").textContent = mode === "shared" ? "Shared Lobby · gemeinsam bearbeitbar" : "Lokales Turnier";
    $("#tournamentSelect").disabled = mode === "shared";
    $("#newTournamentButton").disabled = mode === "shared";
    $("#newSharedTournamentButton").disabled = mode === "shared";
    $("#sharedLobbyBox").classList.toggle("is-hidden", mode !== "shared" && !SharedTournamentStore.isConfigured());
    $("#copyShareLinkButton").hidden = mode !== "shared" || !activeShared;
    $("#leaveSharedLobbyButton").hidden = mode !== "shared";
    $("#publishLocalButton").hidden = mode !== "local";
    $("#publishLocalButton").disabled = !SharedTournamentStore.isConfigured();
    $("#sharedLobbyTitle").textContent = mode === "shared" ? `Shared Lobby: ${active.name || "unbekannt"}` : "Lokales Turnier online veröffentlichen";
    $("#sharedLobbyText").textContent = sharedError || (mode === "shared"
      ? "Alle Personen mit dem Link können dieses Turnier vollständig bearbeiten."
      : "Erstellt eine Online-Kopie dieses lokalen Turniers und erzeugt einen Bearbeitungslink.");
  }

  function renderLogoManager() {
    const logoSrc = active.logoSrc || DEFAULT_LOGO_SRC;
    $("#logoUrlInput").value = logoSrc.startsWith("data:") || logoSrc === DEFAULT_LOGO_SRC ? "" : logoSrc;
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
    $("#playerCount").textContent = `${active.players.length}/12`;
    $("#playerList").innerHTML = active.players
      .map((player, index) => `<li>${escapeHtml(player)} <button data-remove="${index}" type="button">Entfernen</button></li>`)
      .join("");
    document.querySelectorAll("[data-remove]").forEach((button) => {
      button.addEventListener("click", () => {
        active.players.splice(Number(button.dataset.remove), 1);
        active.tournament = null;
        persistAndRender();
      });
    });
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
    $("#groupsView").innerHTML = BeachTournament.GROUPS.map((group) => {
      const teams = tournament.groups[group] || [];
      return `<article class="group-card">
        <h3>Gruppe ${group}</h3>
        <ul>${teams.map(teamChip).join("")}</ul>
      </article>`;
    }).join("");
    bindTeamNameInputs();
  }

  function teamChip(team) {
    return `<li class="team-chip">
      <label>
        Teamname
        <input class="team-name-input" data-team-name="${team.id}" type="text" value="${escapeHtml(team.name)}" placeholder="Teamname">
      </label>
      <span>${team.players.map(escapeHtml).join(" & ")}</span>
    </li>`;
  }

  function bindTeamNameInputs() {
    document.querySelectorAll("[data-team-name]").forEach((input) => {
      input.addEventListener("input", () => {
        updateTeamName(input.dataset.teamName, input.value);
        saveActive();
        renderLive();
      });
      input.addEventListener("change", () => {
        const team = findTeam(input.dataset.teamName);
        if (!team) return;
        const fallback = input.dataset.originalName || team.name || "Team";
        const nextName = input.value.trim() || fallback;
        input.value = nextName;
        updateTeamName(input.dataset.teamName, nextName);
        persistAndRender({ immediate: true });
      });
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
    if (BeachTournament.allGroupMatchesComplete(tournament) && tournament.finals.length === 0) {
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
    $("#standingsView").innerHTML = BeachTournament.GROUPS.map((group) => {
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
    const teamMap = teamLookup(tournament);
    const ranked = BeachTournament.ranking(tournament);
    $("#rankingList").innerHTML = ranked.length
      ? ranked.map((teamId) => `<li>${teamLabel(teamMap.get(teamId))}</li>`).join("")
      : `<li>Finalspiele noch offen</li>`;
  }

  function matchCard(match, tournament) {
    const result = BeachTournament.matchResult(match);
    const current = !result && match.teamA && match.teamB ? " is-current" : "";
    const sets = match.sets || [];
    return `<article class="match-card${current}">
      <div class="match-meta">${escapeHtml(match.label)} · bis ${match.target}${match.bestOf > 1 ? " · Best-of-3" : ""}
        <span class="match-referee">Schiri: ${refereeLabel(match, tournament)}</span>
      </div>
      <div class="match-teams">${matchTeamName(match.teamA, tournament)}<br>vs<br>${matchTeamName(match.teamB, tournament)}</div>
      <div class="score-inputs">
        ${sets
          .map(
            (set, index) => `<div class="set-row">
              <span>Satz ${index + 1}</span>
              <input data-match="${match.id}" data-set="${index}" data-side="a" inputmode="numeric" type="number" min="0" max="99" value="${escapeHtml(set.a)}" aria-label="Team A Satz ${index + 1}">
              <input data-match="${match.id}" data-set="${index}" data-side="b" inputmode="numeric" type="number" min="0" max="99" value="${escapeHtml(set.b)}" aria-label="Team B Satz ${index + 1}">
            </div>`
          )
          .join("")}
      </div>
    </article>`;
  }

  function bindScoreInputs(matches, containerSelector) {
    document.querySelectorAll(`${containerSelector} [data-match]`).forEach((input) => {
      input.addEventListener("input", () => {
        updateScoreInput(input, matches);
        saveActive();
        scheduleScoreRender();
      });
      input.addEventListener("change", () => {
        updateScoreInput(input, matches);
        saveActive({ immediate: true });
        scheduleScoreRender();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        const inputs = [...document.querySelectorAll(`${containerSelector} [data-match]`)];
        const currentIndex = inputs.indexOf(input);
        updateScoreInput(input, matches);
        saveActive({ immediate: true });
        const next = inputs[currentIndex + 1];
        if (next && currentIndex >= 0) {
          next.focus();
        } else {
          input.blur();
        }
        scheduleScoreRender();
      });
    });
  }

  function updateScoreInput(input, matches) {
    const match = matches.find((item) => item.id === input.dataset.match);
    if (!match) return;
    match.sets[Number(input.dataset.set)][input.dataset.side] = input.value;
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
    if (active.tournament) {
      active.tournament.finals = BeachTournament.finalsMatches(active.tournament);
    }
    persistAndRender();
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

  function refereeForMatch(match, tournament) {
    if (match.phase === "group") {
      const refereeTeam = (tournament.groups[match.group] || []).find((team) => {
        return team.id !== match.teamA && team.id !== match.teamB;
      });
      return refereeTeam ? plainTeamLabel(refereeTeam) : "noch offen";
    }
    const tableA = BeachTournament.standingsForGroup("A", tournament);
    const tableB = BeachTournament.standingsForGroup("B", tournament);
    const semi1 = (tournament.finals || []).find((item) => item.slot === "semi1");
    const place3 = (tournament.finals || []).find((item) => item.slot === "place3");
    const place5 = (tournament.finals || []).find((item) => item.slot === "place5");
    const semi1Result = semi1 ? BeachTournament.matchResult(semi1) : null;
    const place3Result = place3 ? BeachTournament.matchResult(place3) : null;
    const place5Result = place5 ? BeachTournament.matchResult(place5) : null;
    if (match.slot === "semi1") return tableA[2]?.team ? plainTeamLabel(tableA[2].team) : "3. Gruppe A";
    if (match.slot === "semi2") return tableB[2]?.team ? plainTeamLabel(tableB[2].team) : "3. Gruppe B";
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
    return `${match.label}: ${matchTeamName(match.teamA, tournament)} vs ${matchTeamName(match.teamB, tournament)}`;
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
    const rows = [["Phase", "Spiel", "Team A", "Team B", "Schiedsrichter", "Satz 1", "Satz 2", "Satz 3", "Sieger"]];
    [...tournament.matches, ...(tournament.finals || [])].forEach((match) => {
      const result = BeachTournament.matchResult(match);
      rows.push([
        match.phase,
        match.label,
        textTeamName(match.teamA, tournament),
        textTeamName(match.teamB, tournament),
        refereeForMatch(match, tournament),
        setText(match.sets[0]),
        setText(match.sets[1]),
        setText(match.sets[2]),
        result ? textTeamName(result.winner, tournament) : "",
      ]);
    });
    downloadText("wws-herren-beachcup-ergebnisse.csv", rows.map(csvRow).join("\n"), "text/csv");
  }

  function exportPdf() {
    const tournament = active.tournament;
    if (!tournament) return;
    const lines = reportLines(tournament);
    const pdf = buildSimplePdf(lines);
    const blob = new Blob([pdf], { type: "application/pdf" });
    downloadBlob("wws-herren-beachcup-ergebnisse.pdf", blob);
  }

  function reportLines(tournament) {
    const lines = [`${active.name || DEFAULT_TOURNAMENT_NAME} Ergebnisse`, `Stand: ${new Date().toLocaleString("de-DE")}`, ""];
    BeachTournament.GROUPS.forEach((group) => {
      lines.push(`Gruppe ${group}`);
      BeachTournament.standingsForGroup(group, tournament).forEach((row, index) => {
        lines.push(`${index + 1}. ${plainTeamLabel(row.team)} · S ${row.wins} · N ${row.losses} · Diff ${row.pointDiff} · Punkte ${row.pointsFor}:${row.pointsAgainst}`);
      });
      lines.push("");
    });
    [...tournament.matches, ...(tournament.finals || [])].forEach((match) => {
      lines.push(`${match.label}: ${textTeamName(match.teamA, tournament)} vs ${textTeamName(match.teamB, tournament)} · Schiri: ${refereeForMatch(match, tournament)} · ${match.sets.map(setText).filter(Boolean).join(", ") || "offen"}`);
    });
    const ranked = BeachTournament.ranking(tournament);
    if (ranked.length) {
      lines.push("", "Endplatzierung");
      ranked.forEach((teamId, index) => lines.push(`${index + 1}. ${textTeamName(teamId, tournament)}`));
    }
    return lines;
  }

  function buildSimplePdf(lines) {
    const pageLines = wrapLines(lines, 92);
    const content = ["BT", "/F1 11 Tf", "50 790 Td"];
    pageLines.forEach((line, index) => {
      if (index > 0) content.push("0 -15 Td");
      content.push(`(${pdfEscape(line)}) Tj`);
    });
    content.push("ET");
    const stream = content.join("\n");
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
    return output.slice(0, 48);
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
      tournament: backup.tournament || null,
      registrationLink: backup.registrationLink || "",
      logoSrc: backup.logoSrc || DEFAULT_LOGO_SRC,
      createdAt: now,
      updatedAt: now,
    };
  }

  function csvRow(row) {
    return row.map((cell) => `"${String(cell || "").replaceAll('"', '""')}"`).join(",");
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
    link.click();
    URL.revokeObjectURL(url);
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
    return String(value).replace(/[^\x20-\x7E]/g, "?").replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  }

  init().catch((error) => {
    console.error(error);
    alert(`Die App konnte nicht vollständig gestartet werden: ${error.message}`);
  });
})();
