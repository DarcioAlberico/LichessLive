import type { BrowserContext, Route } from '@playwright/test';

/**
 * Lichess sintético para E2E repetível (dados fictícios). Os formatos seguem os contratos reais
 * conferidos em tests/fixtures/lichess. Nenhuma requisição sai para o serviço público.
 */

export const TOUR = 'E2Etour1';
export const SWISS = 'E2Eswis1';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const PLAYERS = [
  'Magnus_Ficticio',
  'Hikaru_Ficticio',
  'Alireza_Ficticio',
  'EnxadristaHeterodoxo',
  'Jogadora_Quatro',
  'DarcioAlberico',
  'Um_Nome_De_Jogador_Muito_Longo_X',
  'Sete_Fic',
  'Oito_Fic',
  'Nove_Fic',
  'Dez_Fic',
  'Onze_Fic',
];

export const GAMES: Record<string, { white: string; black: string; moves: [string, string][] }> = {
  GameAAA1: {
    white: 'Magnus_Ficticio',
    black: 'Hikaru_Ficticio',
    moves: [['rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'e2e4']],
  },
  GameBBB2: {
    white: 'Alireza_Ficticio',
    black: 'EnxadristaHeterodoxo',
    moves: [['rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1', 'd2d4']],
  },
  GameCCC3: {
    white: 'Um_Nome_De_Jogador_Muito_Longo_X',
    black: 'DarcioAlberico',
    moves: [
      ['rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1', 'c2c4'],
      ['rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w KQkq - 0 2', 'e7e5'],
    ],
  },
};

const id = (n: string) => n.toLowerCase();

function tournamentJson() {
  return {
    id: TOUR,
    createdBy: 'ficticio',
    startsAt: new Date(Date.now() - 600_000).toISOString(),
    system: 'arena',
    fullName: 'Arena Fictícia de Homologação',
    minutes: 60,
    perf: { key: 'blitz', name: 'Blitz' },
    clock: { limit: 180, increment: 0 },
    variant: 'standard',
    rated: true,
    nbPlayers: PLAYERS.length,
    isStarted: true,
    secondsToFinish: 3000,
    duels: [
      {
        id: 'GameAAA1',
        p: [
          { n: 'Magnus_Ficticio', r: 2800, k: 1 },
          { n: 'Hikaru_Ficticio', r: 2790, k: 2 },
        ],
      },
      {
        id: 'GameBBB2',
        p: [
          { n: 'Alireza_Ficticio', r: 2700, k: 3 },
          { n: 'EnxadristaHeterodoxo', r: 1900, k: 4 },
        ],
      },
    ],
    featured: {
      id: 'GameAAA1',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b',
      lastMove: 'e2e4',
      white: { name: 'Magnus_Ficticio', id: 'magnus_ficticio', rating: 2800 },
      black: { name: 'Hikaru_Ficticio', id: 'hikaru_ficticio', rating: 2790 },
      c: { white: 170, black: 175 },
    },
    standing: { page: 1, players: [] },
  };
}

function resultsNdjson(nb: number) {
  return (
    PLAYERS.slice(0, nb)
      .map((name, i) =>
        JSON.stringify({ rank: i + 1, score: 40 - i * 3, rating: 2000, username: name, performance: 2100 }),
      )
      .join('\n') + '\n'
  );
}

function playerJson(name: string) {
  return { user: { name, id: id(name) }, rating: 2000 };
}

function streamNdjson(gameId: string) {
  const g = GAMES[gameId];
  if (!g) return null;
  const lines = [
    {
      id: gameId,
      variant: { key: 'standard', name: 'Standard', short: 'Std' },
      speed: 'blitz',
      perf: 'blitz',
      rated: true,
      source: 'arena',
      createdAt: Date.now() - 60_000,
      tournamentId: TOUR,
      players: { white: playerJson(g.white), black: playerJson(g.black) },
    },
    { fen: START, wc: 180, bc: 180 },
    ...g.moves.map(([fen, lm], i) => ({ fen, lm, wc: 180 - i * 3, bc: 178 - i * 4 })),
  ];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function currentGame(username: string) {
  const entry = Object.entries(GAMES).find(
    ([, g]) => id(g.white) === id(username) || id(g.black) === id(username),
  );
  if (!entry) return null;
  const [gameId, g] = entry;
  return {
    id: gameId,
    rated: true,
    variant: 'standard',
    speed: 'blitz',
    perf: 'blitz',
    status: 'started',
    source: 'arena',
    players: { white: playerJson(g.white), black: playerJson(g.black) },
    arenaTour: { id: TOUR, name: 'Arena Fictícia' },
  };
}

const PAGE = (main: string, title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><header id="top">Lichess (simulado)</header>${main}<footer>rodapé nativo</footer></body></html>`;

export interface FakeStats {
  requests: string[];
}

export async function installFakeLichess(context: BrowserContext): Promise<FakeStats> {
  const stats: FakeStats = { requests: [] };
  await context.route('https://lichess.org/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    stats.requests.push(path + url.search);
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
        headers: { 'access-control-allow-origin': '*' },
      });
    const ndjson = (body: string) =>
      route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body,
        headers: { 'access-control-allow-origin': '*' },
      });

    if (path === `/tournament/${TOUR}`)
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PAGE('<main class="tour"><div id="native-board">Tabuleiro nativo</div></main>', 'Arena'),
      });
    if (path === `/swiss/${SWISS}`)
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PAGE('<main class="swiss">Swiss</main>', 'Swiss'),
      });
    if (path === `/api/tournament/${TOUR}`) return json(tournamentJson());
    if (path === `/api/tournament/${TOUR}/results`)
      return ndjson(resultsNdjson(Number(url.searchParams.get('nb') ?? 10)));
    const cg = /^\/api\/user\/([^/]+)\/current-game$/.exec(path);
    if (cg) {
      const g = currentGame(decodeURIComponent(cg[1]!));
      return g
        ? json(g)
        : route.fulfill({ status: 404, body: '', headers: { 'access-control-allow-origin': '*' } });
    }
    const user = /^\/api\/user\/([^/]+)$/.exec(path);
    if (user) {
      const name = PLAYERS.find((p) => id(p) === id(decodeURIComponent(user[1]!)));
      return name ? json({ id: id(name), username: name }) : route.fulfill({ status: 404, body: '' });
    }
    const st = /^\/api\/stream\/game\/([^/]+)$/.exec(path);
    if (st) {
      const body = streamNdjson(st[1]!);
      return body ? ndjson(body) : route.fulfill({ status: 404, body: '' });
    }
    if (path === '/api/team/time-ficticio')
      return json({ id: 'time-ficticio', name: 'Time Fictício', nbMembers: 3 });
    if (path === '/api/team/time-ficticio/users')
      return ndjson(
        ['DarcioAlberico', 'EnxadristaHeterodoxo', 'Jogadora_Quatro']
          .map((n, i) => JSON.stringify({ name: n, id: id(n), joinedTeamAt: 1_700_000_000_000 + i }))
          .join('\n') + '\n',
      );
    if (path === '/api/team/time-privado')
      return json({ id: 'time-privado', name: 'Time Privado', nbMembers: 40 });
    if (path === '/api/team/time-privado/users')
      return route.fulfill({ status: 403, body: '', headers: { 'access-control-allow-origin': '*' } });
    if (path === '/')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: PAGE('<main>Início</main>', 'Lichess'),
      });
    return route.fulfill({ status: 404, body: '' });
  });
  return stats;
}
