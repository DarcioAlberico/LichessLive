import type { TournamentSession } from '../application/session/tournamentSession';
import { deltaLabel } from '../domain/ranking/progress';
import { formatTime } from '../shared/time';

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Relatório simples da sessão (SPEC 3.3): jogadores acompanhados, posição, pontos e progresso. */
export function buildSessionReportCsv(s: TournamentSession, timezone: string): string {
  const snap = s.snapshot;
  const rows: unknown[][] = [
    ['Torneio', s.tournament?.name ?? s.tournamentId],
    ['ID', s.tournamentId],
    ['Formato', s.tournament?.format ?? 'desconhecido'],
    ['Classificação', snap ? (snap.provisional ? 'provisória (observada)' : 'final') : 'indisponível'],
    [
      'Cobertura',
      snap ? `${snap.coverage.kind} ${snap.coverage.received}/${snap.coverage.total ?? '?'}` : '',
    ],
    ['Atualizada às', snap ? formatTime(snap.endedAt, timezone, true) : ''],
    ['Referência', s.record.referenceMode],
    [],
    ['Jogador', 'Posição', 'Pontos', 'Progresso', 'Team no torneio'],
  ];
  const progress = new Map((s.progress.get('general') ?? []).map((r) => [r.userId, r]));
  for (const userId of s.trackedUserIds()) {
    const e = snap?.byUser.get(userId);
    const p = progress.get(userId);
    rows.push([
      e?.username ?? s.profiles.get(userId)?.usernameDisplay ?? userId,
      e?.rank ?? '',
      e?.score ?? '',
      p ? deltaLabel(p) : '',
      e?.teamId ?? '',
    ]);
  }
  if (s.teamStandings) {
    rows.push([], ['Team', 'Posição', 'Pontos (oficial)']);
    for (const t of s.teamStandings) rows.push([t.name, t.rank, t.score]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
}
