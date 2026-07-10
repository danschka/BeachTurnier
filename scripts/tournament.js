(function () {
  const DEFAULT_FORMAT = {
    teamCount: 6,
    playersPerTeam: 2,
    groupCount: 2,
    targetScore: 15,
    finalsBestOf: 3,
  };

  function uid(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function clampInt(value, fallback, min, max) {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function normalizeFormat(format = {}) {
    const teamCount = clampInt(format.teamCount, DEFAULT_FORMAT.teamCount, 2, 32);
    const playersPerTeam = clampInt(format.playersPerTeam, DEFAULT_FORMAT.playersPerTeam, 1, 8);
    const groupCount = clampInt(format.groupCount, DEFAULT_FORMAT.groupCount, 1, Math.min(8, teamCount));
    const targetScore = clampInt(format.targetScore, DEFAULT_FORMAT.targetScore, 5, 99);
    const finalsBestOf = clampInt(format.finalsBestOf, DEFAULT_FORMAT.finalsBestOf, 1, 5);
    return {
      teamCount,
      playersPerTeam,
      groupCount,
      targetScore,
      finalsBestOf: finalsBestOf % 2 === 0 ? finalsBestOf + 1 : finalsBestOf,
      totalPlayers: teamCount * playersPerTeam,
    };
  }

  function groupName(index) {
    return String.fromCharCode(65 + index);
  }

  function groupNames(tournamentOrFormat) {
    if (tournamentOrFormat?.groups) return Object.keys(tournamentOrFormat.groups);
    const format = normalizeFormat(tournamentOrFormat);
    return Array.from({ length: format.groupCount }, (_, index) => groupName(index));
  }

  function shuffle(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function makeTeams(players, format) {
    const shuffled = shuffle(players).slice(0, format.totalPlayers);
    return Array.from({ length: format.teamCount }, (_, teamIndex) => {
      const start = teamIndex * format.playersPerTeam;
      return {
        id: uid("team"),
        name: `Team ${teamIndex + 1}`,
        players: shuffled.slice(start, start + format.playersPerTeam),
      };
    });
  }

  function assignGroups(teams, format) {
    const names = groupNames(format);
    const groups = Object.fromEntries(names.map((name) => [name, []]));
    shuffle(teams).forEach((team, index) => {
      const group = names[index % names.length];
      groups[group].push({ ...team, group });
    });
    return groups;
  }

  function roundRobinMatches(groups, format) {
    const matches = [];
    groupNames({ groups }).forEach((group) => {
      const teams = groups[group] || [];
      let game = 1;
      for (let left = 0; left < teams.length; left += 1) {
        for (let right = left + 1; right < teams.length; right += 1) {
          matches.push({
            id: uid("group"),
            phase: "group",
            group,
            label: `Gruppe ${group} · Spiel ${game}`,
            bestOf: 1,
            target: format.targetScore,
            teamA: teams[left]?.id,
            teamB: teams[right]?.id,
            sets: [{ a: "", b: "" }],
          });
          game += 1;
        }
      }
    });
    return matches;
  }

  function createTournament(players, requestedFormat) {
    const format = normalizeFormat(requestedFormat);
    const teams = makeTeams(players, format);
    const groups = assignGroups(teams, format);
    return {
      players,
      format,
      teams: groupNames({ groups }).flatMap((group) => groups[group]),
      groups,
      matches: roundRobinMatches(groups, format),
      finals: [],
      createdAt: new Date().toISOString(),
    };
  }

  function parseScore(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function completedSets(match) {
    return (match.sets || [])
      .map((set) => ({ a: parseScore(set.a), b: parseScore(set.b) }))
      .filter((set) => set.a !== null && set.b !== null && set.a !== set.b);
  }

  function matchResult(match) {
    if (!match?.teamA || !match?.teamB) return null;
    const sets = completedSets(match);
    if (sets.length === 0) return null;
    const winsA = sets.filter((set) => set.a > set.b).length;
    const winsB = sets.filter((set) => set.b > set.a).length;
    const needed = Math.ceil((match.bestOf || 1) / 2);
    if (winsA < needed && winsB < needed) return null;
    const pointsA = sets.reduce((sum, set) => sum + set.a, 0);
    const pointsB = sets.reduce((sum, set) => sum + set.b, 0);
    return {
      winner: winsA > winsB ? match.teamA : match.teamB,
      loser: winsA > winsB ? match.teamB : match.teamA,
      pointsA,
      pointsB,
      diffA: pointsA - pointsB,
      diffB: pointsB - pointsA,
      setsA: winsA,
      setsB: winsB,
    };
  }

  function standingsForGroup(group, tournament) {
    const rows = (tournament.groups[group] || []).map((team) => ({
      teamId: team.id,
      team,
      group,
      wins: 0,
      losses: 0,
      pointDiff: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    }));
    const byId = new Map(rows.map((row) => [row.teamId, row]));
    tournament.matches
      .filter((match) => match.phase === "group" && match.group === group)
      .forEach((match) => {
        const result = matchResult(match);
        if (!result) return;
        const a = byId.get(match.teamA);
        const b = byId.get(match.teamB);
        if (!a || !b) return;
        a.pointsFor += result.pointsA;
        a.pointsAgainst += result.pointsB;
        a.pointDiff += result.diffA;
        b.pointsFor += result.pointsB;
        b.pointsAgainst += result.pointsA;
        b.pointDiff += result.diffB;
        if (result.winner === match.teamA) {
          a.wins += 1;
          b.losses += 1;
        } else {
          b.wins += 1;
          a.losses += 1;
        }
      });

    return rows.sort((left, right) => compareRows(left, right, tournament.matches));
  }

  function compareRows(left, right, matches) {
    const main =
      right.wins - left.wins ||
      right.pointDiff - left.pointDiff ||
      right.pointsFor - left.pointsFor;
    if (main !== 0) return main;
    const directMatch = matches.find((match) => {
      return (
        match.phase === "group" &&
        ((match.teamA === left.teamId && match.teamB === right.teamId) ||
          (match.teamA === right.teamId && match.teamB === left.teamId))
      );
    });
    const directResult = directMatch ? matchResult(directMatch) : null;
    if (directResult?.winner === left.teamId) return -1;
    if (directResult?.winner === right.teamId) return 1;
    return left.team.name.localeCompare(right.team.name, "de");
  }

  function allGroupMatchesComplete(tournament) {
    return tournament.matches.length > 0 && tournament.matches.every((match) => matchResult(match));
  }

  function allGroupStandings(tournament) {
    return groupNames(tournament)
      .flatMap((group) => standingsForGroup(group, tournament).map((row, index) => ({ ...row, groupRank: index + 1 })))
      .sort((left, right) => {
        return (
          left.groupRank - right.groupRank ||
          right.wins - left.wins ||
          right.pointDiff - left.pointDiff ||
          right.pointsFor - left.pointsFor ||
          left.team.name.localeCompare(right.team.name, "de")
        );
      });
  }

  function finalsMatches(tournament) {
    const format = normalizeFormat(tournament.format);
    const groups = groupNames(tournament);
    const existing = new Map((tournament.finals || []).map((match) => [match.slot, match]));
    const fromExisting = (slot, fallback) => {
      const current = existing.get(slot);
      return current ? { ...fallback, id: current.id, sets: current.sets || fallback.sets } : fallback;
    };

    if (groups.length === 2 && (tournament.groups[groups[0]] || []).length >= 3 && (tournament.groups[groups[1]] || []).length >= 3) {
      const tableA = standingsForGroup(groups[0], tournament);
      const tableB = standingsForGroup(groups[1], tournament);
      return [
        fromExisting("semi1", makeFinal("semi1", "Halbfinale 1", tableA[0].teamId, tableB[1].teamId, 1, format)),
        fromExisting("semi2", makeFinal("semi2", "Halbfinale 2", tableB[0].teamId, tableA[1].teamId, 1, format)),
        fromExisting("place5", makeFinal("place5", "Spiel um Platz 5", tableA[2].teamId, tableB[2].teamId, 1, format)),
        fromExisting("place3", makeFinal("place3", "Spiel um Platz 3", null, null, 1, format)),
        fromExisting("final", makeFinal("final", "Finale", null, null, format.finalsBestOf, format)),
      ].map((match, index, finals) => hydrateFinalTeams(match, finals));
    }

    const ranked = allGroupStandings(tournament);
    const matches = [];
    if (ranked.length >= 2) {
      matches.push(fromExisting("final", makeFinal("final", "Finale", ranked[0].teamId, ranked[1].teamId, format.finalsBestOf, format)));
    }
    if (ranked.length >= 4) {
      matches.push(fromExisting("place3", makeFinal("place3", "Spiel um Platz 3", ranked[2].teamId, ranked[3].teamId, 1, format)));
    }
    return matches;
  }

  function makeFinal(slot, label, teamA, teamB, bestOf, format) {
    return {
      id: uid("final"),
      phase: "final",
      slot,
      group: "",
      label,
      bestOf,
      target: format.targetScore,
      teamA,
      teamB,
      sets: Array.from({ length: bestOf }, () => ({ a: "", b: "" })),
    };
  }

  function hydrateFinalTeams(match, finals) {
    const semi1 = finals.find((item) => item.slot === "semi1");
    const semi2 = finals.find((item) => item.slot === "semi2");
    const result1 = semi1 ? matchResult(semi1) : null;
    const result2 = semi2 ? matchResult(semi2) : null;
    if (match.slot === "place3") {
      return { ...match, teamA: result1?.loser || match.teamA || null, teamB: result2?.loser || match.teamB || null };
    }
    if (match.slot === "final") {
      return { ...match, teamA: result1?.winner || match.teamA || null, teamB: result2?.winner || match.teamB || null };
    }
    return match;
  }

  function ranking(tournament) {
    const finals = tournament.finals || [];
    const final = finals.find((match) => match.slot === "final");
    const place3 = finals.find((match) => match.slot === "place3");
    const place5 = finals.find((match) => match.slot === "place5");
    const finalResult = final ? matchResult(final) : null;
    const place3Result = place3 ? matchResult(place3) : null;
    const place5Result = place5 ? matchResult(place5) : null;
    const ranked = [
      finalResult?.winner,
      finalResult?.loser,
      place3Result?.winner,
      place3Result?.loser,
      place5Result?.winner,
      place5Result?.loser,
    ].filter(Boolean);
    if (ranked.length) return ranked;
    return finals.length ? [] : allGroupStandings(tournament).map((row) => row.teamId);
  }

  window.BeachTournament = {
    DEFAULT_FORMAT,
    normalizeFormat,
    groupNames,
    createTournament,
    standingsForGroup,
    matchResult,
    allGroupMatchesComplete,
    finalsMatches,
    ranking,
  };
})();
