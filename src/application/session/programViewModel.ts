import { formatClock } from '../../domain/entities/clock';
import { coverageLabel } from '../../domain/entities/coverage';
import type { GamePlayer, GameState } from '../../domain/entities/game';
import { isFinishedStatus, resultText, statusDescription } from '../../domain/entities/game';
import type { TeamId, UserId } from '../../domain/entities/ids';
import { initialsOf, LOCAL_LIST_ID } from '../../domain/entities/ids';
import type { LayoutPreset, PlayerProfile } from '../../domain/entities/profiles';
import { formatLabel } from '../../domain/entities/tournament';
import { deltaLabel, referenceModeLabel } from '../../domain/ranking/progress';
import { resolveTournamentTeam } from '../../domain/ranking/teamBattle';
import { resultVisibility } from '../../domain/selection/spoiler';
import type { ProgramTab } from '../../shared/protocol/messages';
import { formatHourLabel, formatTime } from '../../shared/time';
import type {
  BannerVM,
  GamePlayerVM,
  GameRowVM,
  MainGameVM,
  PlayerCardVM,
  ProgramViewModel,
  ProgressRowVM,
  RankingRowVM,
  TeamRowVM,
} from '../../presentation/viewModels/types';
import type { TournamentSession } from './tournamentSession';

export interface ViewContext {
  timezone: string;
  preset: LayoutPreset;
  now: number;
  reducedMotion: boolean;
}

function displayName(userId: UserId | null, fallback: string, profiles: Map<UserId, PlayerProfile>): string {
  if (!userId) return fallback;
  const p = profiles.get(userId);
  return p?.displayName?.trim() || p?.usernameDisplay || fallback;
}

function playerCard(
  s: TournamentSession,
  game: GameState,
  color: 'white' | 'black',
  hideResults: boolean,
): PlayerCardVM {
  const player: GamePlayer = game.identity[color];
  const name = displayName(player.userId, player.name, s.profiles);
  const profile = player.userId ? s.profiles.get(player.userId) : undefined;
  const clockMs =
    color === 'white' ? (game.position?.clocks.whiteMs ?? null) : (game.position?.clocks.blackMs ?? null);
  const entry = player.userId ? s.snapshot?.byUser.get(player.userId) : undefined;
  let teamName: string | null = null;
  if (s.tournament?.format === 'teamBattle' && player.userId) {
    const link = resolveTournamentTeam(player.userId, s.snapshot, s.tournament.duelTeams, []);
    teamName = link.teamId ? (s.teamNames.get(link.teamId) ?? link.teamId) : null;
  }
  const turn = game.position?.fen.split(' ')[1];
  return {
    color,
    userId: player.userId,
    name,
    title: player.title,
    rating: player.rating,
    photoId: profile?.photoId ?? null,
    initials: initialsOf(name),
    teamName,
    clockText: formatClock(clockMs),
    clockAvailable: clockMs !== null,
    toMove: !isFinishedStatus(game.status) && turn === (color === 'white' ? 'w' : 'b'),
    rankText: entry && !hideResults ? `${entry.rank}º` : null,
  };
}

function buildMain(s: TournamentSession): MainGameVM {
  const sel = s.selection;
  const game = s.game;
  const notice = sel.notice;
  let noticeText: string | null = null;
  if (notice) {
    switch (notice.kind) {
      case 'unlinked':
        noticeText = 'Partida sem vínculo confirmado com este torneio';
        break;
      case 'noCurrentGame':
        noticeText = 'Sem partida atual confirmada';
        break;
      case 'unsupportedVariant':
        noticeText = `Variante não suportada: ${notice.variant}`;
        break;
      default:
        noticeText = null;
    }
  }
  const loadingLabel = sel.pending || notice?.kind === 'resolving' ? 'Carregando partida…' : null;
  if (!game || !game.position) {
    return {
      state: notice?.kind === 'unsupportedVariant' ? 'unsupported' : loadingLabel ? 'loading' : 'empty',
      board: null,
      white: null,
      black: null,
      resultBanner: null,
      loadingLabel,
      notice: noticeText,
      modeLabel: null,
      isReplay: false,
    };
  }
  const vis = resultVisibility(game.outcome, null);
  const outcome = vis.programOutcome;
  let resultBanner: string | null = null;
  if (outcome && !s.hideResults) {
    const r = resultText(outcome);
    resultBanner = r
      ? `${r} · ${statusDescription(outcome.status, outcome.winner)}`
      : statusDescription(outcome.status, outcome.winner);
  } else if (outcome && s.hideResults) {
    resultBanner = 'Partida encerrada';
  }
  const followedName = sel.followedUserId
    ? displayName(sel.followedUserId, sel.followedUserId, s.profiles)
    : null;
  const modeLabel =
    sel.mode === 'replay'
      ? 'Replay da última partida'
      : sel.mode === 'follow' && followedName
        ? `Acompanhando ${followedName}`
        : 'Partida fixada';
  return {
    state: 'ready',
    board: {
      packageId: `${game.identity.gameId}:${game.generation}`,
      gameId: game.identity.gameId,
      fen: game.position.fen,
      lastMove: game.position.lastMove,
      orientation: sel.orientation,
    },
    white: playerCard(s, game, 'white', s.hideResults),
    black: playerCard(s, game, 'black', s.hideResults),
    resultBanner,
    loadingLabel,
    notice: noticeText,
    modeLabel,
    isReplay: sel.mode === 'replay',
  };
}

function teamNameOf(s: TournamentSession, teamId: TeamId | null): string | null {
  return teamId ? (s.teamNames.get(teamId) ?? teamId) : null;
}

export function buildProgramViewModel(s: TournamentSession, vc: ViewContext): ProgramViewModel {
  const t = s.tournament;
  const tz = vc.timezone;
  const hide = s.hideResults;
  const isTB = t?.format === 'teamBattle';
  const snapshot = s.snapshot;
  const tracked = s.trackedUserIds();
  const trackedSet = new Set(tracked);
  const favorites = new Set(s.favorites);

  // Progresso geral indexado por jogador (usado em várias abas).
  const generalRows = s.progress.get('general') ?? [];
  const progressByUser = new Map(generalRows.map((r) => [r.userId, r]));
  const directionOf = (userId: string): 'up' | 'down' | 'none' => {
    const st = progressByUser.get(userId as UserId)?.status;
    return st === 'up' ? 'up' : st === 'down' ? 'down' : 'none';
  };
  const deltaOf = (userId: string): string | null => {
    const r = progressByUser.get(userId as UserId);
    return r && (r.status === 'up' || r.status === 'down') ? deltaLabel(r) : null;
  };
  const onAirGameId = s.game?.identity.gameId ?? null;

  // ---------------- Partidas
  const gamePlayer = (
    p: { userId: UserId; name: string; rating: number | null; rank: number | null } | undefined,
  ): GamePlayerVM => {
    if (!p) return { name: '?', rank: null, rating: null, photoId: null, initials: '?', ours: false };
    const name = displayName(p.userId, p.name, s.profiles);
    return {
      name,
      rank: snapshot?.byUser.get(p.userId)?.rank ?? p.rank,
      rating: p.rating,
      photoId: s.profiles.get(p.userId)?.photoId ?? null,
      initials: initialsOf(name),
      ours: trackedSet.has(p.userId) || favorites.has(p.userId),
    };
  };
  const games: GameRowVM[] = [...s.identifiedGames.values()]
    .filter((g) => g.status !== 'finished' || g.gameId === onAirGameId)
    .map((g) => {
      const [a, b] = g.players;
      const white = gamePlayer(a);
      const black = gamePlayer(b);
      return {
        gameId: g.gameId,
        white: white.name,
        black: black.name,
        whiteRank: white.rank,
        blackRank: black.rank,
        statusText:
          g.status === 'playing' ? 'Em andamento' : g.status === 'finished' ? 'Encerrada' : 'Desconhecido',
        favorite: white.ours || black.ours,
        whitePlayer: white,
        blackPlayer: black,
        onAir: g.gameId === onAirGameId,
        live: g.status === 'playing',
      };
    })
    .sort(
      (x, y) =>
        Number(y.favorite) - Number(x.favorite) ||
        Math.min(x.whiteRank ?? 1e9, x.blackRank ?? 1e9) - Math.min(y.whiteRank ?? 1e9, y.blackRank ?? 1e9),
    );

  // ---------------- Nosso team
  const relative = s.progress.get('watched') ?? [];
  const relMap = new Map(relative.map((r) => [r.userId, r.currentRank]));
  const teamRows: TeamRowVM[] = tracked
    .map((userId) => {
      const entry = snapshot?.byUser.get(userId);
      const profile = s.profiles.get(userId);
      const name = profile?.displayName?.trim() || entry?.username || profile?.usernameDisplay || userId;
      const playing = s.findPlayingGame(userId);
      let linkNote: string | null = null;
      if (isTB && s.record.teamId && entry && entry.teamId && entry.teamId !== s.record.teamId) {
        linkNote = `No torneio pelo team ${teamNameOf(s, entry.teamId)}`;
      }
      let statusText = 'Desconhecido';
      if (playing) statusText = 'Jogando';
      else if (snapshot && !entry)
        statusText = snapshot.coverage.kind === 'complete' ? 'Não inscrito' : 'Fora do recorte';
      const rel = relMap.get(userId);
      const opp = playing?.players.find((p) => p.userId !== userId);
      const oppRank = opp ? (snapshot?.byUser.get(opp.userId)?.rank ?? opp.rank) : null;
      const opponentText = opp
        ? `vs ${displayName(opp.userId, opp.name, s.profiles)}${oppRank ? ` (${oppRank}º)` : ''}`
        : null;
      return {
        userId,
        name,
        title: entry?.title ?? null,
        photoId: profile?.photoId ?? null,
        initials: initialsOf(name),
        rankText: entry ? `${entry.rank}º` : '—',
        scoreText: entry && !hide ? `${entry.score} pts` : '',
        statusText,
        relativeText: rel ? `${rel}º entre acompanhados` : null,
        gameId: playing?.gameId ?? null,
        linkNote,
        playing: !!playing,
        opponentText,
        deltaText: deltaOf(userId),
        direction: directionOf(userId),
        onAir: !!playing && playing.gameId === onAirGameId,
        sortRank: entry?.rank ?? 1e9,
      };
    })
    .sort((a, b) => a.sortRank - b.sortRank || a.name.localeCompare(b.name))
    .map(({ sortRank: _s, ...row }) => row);

  // ---------------- Classificação
  const rankingRows: RankingRowVM[] = (snapshot?.entries ?? []).map((e) => {
    const name = displayName(e.userId, e.username, s.profiles);
    const watched = trackedSet.has(e.userId);
    return {
      userId: e.userId,
      rank: e.rank,
      name,
      title: e.title,
      scoreText: hide ? '' : `${e.score}`,
      teamName: isTB ? teamNameOf(s, e.teamId) : null,
      watched,
      photoId: watched ? (s.profiles.get(e.userId)?.photoId ?? null) : null,
      initials: initialsOf(name),
      deltaText: watched ? deltaOf(e.userId) : null,
      direction: watched ? directionOf(e.userId) : 'none',
      podium: e.rank <= 3 ? (e.rank as 1 | 2 | 3) : 0,
    };
  });
  const watchedInCut = rankingRows.filter((r) => r.watched);
  const bestWatched = watchedInCut[0];
  const rankingSummary =
    tracked.length > 0 && snapshot
      ? `${watchedInCut.length} de ${tracked.length} acompanhados no recorte${bestWatched ? ` · melhor: ${bestWatched.rank}º ${bestWatched.name}` : ''}`
      : null;

  // ---------------- Progresso
  const general = generalRows;
  const progressRows: ProgressRowVM[] = general
    .map((r) => {
      const profile = s.profiles.get(r.userId);
      const entry = snapshot?.byUser.get(r.userId);
      const name = profile?.displayName?.trim() || entry?.username || profile?.usernameDisplay || r.userId;
      const direction: ProgressRowVM['direction'] =
        r.status === 'up' ? 'up' : r.status === 'down' ? 'down' : 'none';
      return {
        userId: r.userId,
        name,
        photoId: profile?.photoId ?? null,
        initials: initialsOf(name),
        rankText: r.currentRank !== null ? `${r.currentRank}º` : '—',
        deltaText: deltaLabel(r),
        direction,
        confirmed: r.confirmed,
        scoreDeltaText:
          !hide && r.deltaScore !== null && r.deltaScore !== 0
            ? `${r.deltaScore > 0 ? '+' : ''}${r.deltaScore} pts`
            : null,
        transitionText:
          r.referenceRank !== null && r.currentRank !== null && r.referenceRank !== r.currentRank
            ? `${r.referenceRank}º → ${r.currentRank}º`
            : null,
        stale: r.stale,
        sortRank: r.currentRank ?? 1e9,
      };
    })
    .sort((a, b) => a.sortRank - b.sortRank)
    .map(({ sortRank: _s, ...row }) => row);

  const mode = s.record.referenceMode;
  let referenceText = referenceModeLabel(mode);
  if (mode === 'sessionStart' && s.referenceStartAt)
    referenceText = `Progresso desde ${formatHourLabel(s.referenceStartAt, tz)}`;
  if (mode === 'manualMark' && s.record.referenceMarkedAt)
    referenceText = `Progresso desde ${formatHourLabel(s.record.referenceMarkedAt, tz)} (marcação)`;
  if (mode === 'lastUpdate') referenceText = 'Progresso desde a última atualização';

  const stale = s.isRankingStale();
  const rankingUpdated = snapshot ? formatTime(snapshot.endedAt, tz) : null;
  const ups = general.filter((r) => r.status === 'up').length;
  const downs = general.filter((r) => r.status === 'down').length;
  const same = general.filter((r) => r.status === 'unchanged').length;
  const progressSummary =
    general.length > 0 ? `${ups} subiram · ${downs} desceram · ${same} mantiveram` : 'Aguardando observações';
  const playingCount = teamRows.filter((r) => r.playing).length;
  const teamSummary = `${teamRows.length} acompanhados · ${playingCount} jogando agora`;
  const gamesWithOurs = games.filter((g) => g.favorite).length;

  // ---------------- Teams
  const teamsRows = (s.teamStandings ?? []).map((ts) => ({
    teamId: ts.teamId,
    rank: ts.rank,
    name: ts.name,
    scoreText: hide ? '' : `${ts.score} pts`,
    isOurs: ts.teamId === s.record.teamId,
  }));

  const available: ProgramTab[] = ['games', 'team', 'ranking', 'progress'];
  if (isTB) available.push('teams');

  const ourTeamName = s.record.teamId === LOCAL_LIST_ID ? null : teamNameOf(s, s.record.teamId);

  // ---------------- Rodapé e avisos
  const banners: BannerVM[] = [];
  const st = s.streamState;
  let boardUpdatedText: string | null = null;
  if (s.lastStreamMessageAt)
    boardUpdatedText = `Última posição recebida às ${formatTime(s.lastStreamMessageAt, tz, true)}`;
  if (st.kind === 'reconnecting')
    banners.push({
      kind: 'noConnection',
      text: `Sem conexão com a partida · nova tentativa às ${formatTime(st.retryAt, tz, true)}`,
    });
  const restPause = s.restPausedUntil();
  if (st.kind === 'paused' || restPause > vc.now) {
    const until = Math.max(restPause, st.kind === 'paused' ? st.until : 0);
    banners.push({
      kind: 'rateLimited',
      text: `Limitação de acesso · atualização pausada até ${formatTime(until, tz)}`,
    });
  }
  if (s.lastCollection && !s.lastCollection.ok && snapshot) {
    banners.push({
      kind: 'noConnection',
      text: `Classificação sem atualização desde ${formatTime(snapshot.endedAt, tz)}`,
    });
  }
  if (snapshot && snapshot.coverage.kind === 'partial')
    banners.push({
      kind: 'partialData',
      text: `Classificação parcial: ${snapshot.coverage.received} de ${snapshot.coverage.total}`,
    });
  if (t?.status === 'finished')
    banners.push({
      kind: 'tournamentFinished',
      text:
        snapshot && !snapshot.provisional ? 'Torneio encerrado · classificação final' : 'Torneio encerrado',
    });

  const finishesAt =
    t && t.secondsToFinish !== null && t.status === 'started' ? t.fetchedAt + t.secondsToFinish * 1000 : null;

  return {
    top: {
      tournamentName: t?.name ?? 'Carregando torneio…',
      formatText: t ? formatLabel(t.format) : '',
      teamName: ourTeamName,
      statusText: t
        ? t.status === 'finished'
          ? 'Encerrado'
          : t.status === 'created'
            ? 'Aguardando início'
            : 'Ao vivo'
        : '',
      finishesAt,
    },
    main: buildMain(s),
    tabs: {
      available,
      games: {
        title: 'Partidas identificadas',
        coverageText: 'A lista não inclui todas as partidas do torneio',
        summaryText: `${games.length} partidas conhecidas · ${gamesWithOurs} com acompanhados`,
        rows: games.slice(0, 200),
      },
      team: {
        title: ourTeamName ? `Nosso team · ${ourTeamName}` : 'Jogadores acompanhados',
        subtitle: snapshot
          ? `Posição geral ${snapshot.provisional ? 'provisória' : 'final'} · ${rankingUpdated}`
          : 'Aguardando classificação',
        summaryText: teamSummary,
        rows: teamRows,
      },
      ranking: {
        title: snapshot && !snapshot.provisional ? 'Classificação final' : 'Classificação provisória',
        coverageText: snapshot ? `Cobertura: ${coverageLabel(snapshot.coverage)}` : 'Cobertura: indisponível',
        provisional: snapshot?.provisional ?? true,
        updatedText: rankingUpdated ? `Atualizada às ${rankingUpdated}` : 'Sem dados',
        summaryText: rankingSummary,
        rows: rankingRows,
      },
      progress: {
        title: 'Progresso',
        referenceText,
        scopeText: `Posições observadas na classificação geral · ${progressSummary}`,
        staleText: stale && snapshot ? `Sem atualização desde ${formatTime(snapshot.endedAt, tz)}` : null,
        rows: progressRows,
      },
      teams: {
        title: 'Teams',
        note: 'Placar oficial do Team Battle (apenas pontuadores contam)',
        rows: teamsRows,
      },
    },
    footer: {
      sourceText: 'Fonte: API pública do Lichess',
      delayText: s.game ? 'Lances com atraso da API (3 lances)' : null,
      boardUpdatedText,
      rankingText: snapshot
        ? `Classificação ${snapshot.provisional ? 'provisória' : 'final'} · ${rankingUpdated}`
        : null,
    },
    banners,
    layout: {
      preset: vc.preset,
      activeTab: available.includes(s.activeTab) ? s.activeTab : 'team',
      hideResults: hide,
      reducedMotion: vc.reducedMotion,
      inPageShortcuts: s.inPageShortcuts,
    },
    selection: { gameId: s.selection.gameId, userId: s.selection.followedUserId },
  };
}
