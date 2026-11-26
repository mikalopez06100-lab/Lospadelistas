/**
 * Cherche une graine pour le mode démo (?demo=1) : les quatre joueurs sont des IA, et on veut
 * un premier échange spectaculaire (vitres, lob, smash) qui tienne dans la durée de la vidéo.
 * Lancer : REBOTE_DEMO_SEEDS=1 npx vitest run scripts/demo-seed.test.ts
 * puis reporter la graine dans DEMO_SEED (src/core/constants.ts).
 */
import { it } from 'vitest';
import { COURT, createDefaultTuning } from '../src/core/constants';
import { createMatch, tickMatch, type MatchEvent } from '../src/core/play/match';

// Recherche longue (plusieurs milliers de matchs) : elle ne tourne que sur demande.
it.skipIf(!process.env.REBOTE_DEMO_SEEDS)('graines de démo', () => {
  const t = createDefaultTuning();
  const found: { seed: number; score: number; text: string }[] = [];
  const tally: Record<string, number> = {};
  for (let seed = 1; seed <= 6000; seed++) {
    const m = createMatch(seed, 'fort', COURT, 3, 'demo');
    const ev: MatchEvent[] = [];
    let glass = 0, lobs = 0, smashes = 0, drops = 0, hits = 0, endTick = -1, par: number | null = null, winner = -1, reason = '';
    const kinds: string[] = [];
    let lastTeam = -1;
    while (m.tick < 120 * 26 && endTick < 0) {
      ev.length = 0;
      tickMatch(m, [], t, COURT, ev);
      for (const e of ev) {
        if (e.type === 'contact' && e.contact.surface === 'glass') glass++;
        if (e.type === 'hit') { hits++; lastTeam = e.team; kinds.push(e.kind[0]); if (e.kind === 'lob') lobs++; if (e.kind === 'smash') smashes++; if (e.kind === 'drop') drops++; }
        if (e.type === 'fault' || e.type === 'let') endTick = -2;
        if (e.type === 'point') { endTick = m.tick; par = e.par; winner = e.result.winner; reason = e.result.reason; }
      }
      if (endTick === -2) break;
    }
    if (endTick < 0) continue;
    if (seed <= 800) { const k = `${kinds[kinds.length - 1] ?? '-'}/T${lastTeam} → ${reason} (T${winner})${par ? ' PAR' + par : ''}`; tally[k] = (tally[k] ?? 0) + 1; }
    const secs = endTick / 120;
    // Échange de 14 à 21 s, conclu par un smash de ta paire, avec vitres et lob.
    if (secs < 12 || secs > 20 || winner !== 0 || lastTeam !== 0 || lobs < 1 || glass < 3) continue;
    // Le dernier coup est un smash de ta paire, et c'est lui qui fait le point.
    if (kinds[kinds.length - 1] !== 's' || (reason !== 'double-rebond' && reason !== 'sortie-apres-rebond')) continue;
    const score = glass * 2 + lobs * 3 + smashes * 4 + drops + (par ? 30 : 0) + (reason === 'double-rebond' ? 5 : 0);
    found.push({ seed, score, text: `graine ${seed} · ${secs.toFixed(1)} s · ${hits} frappes [${kinds.join('')}] · vitres ${glass} · lobs ${lobs} · smashs ${smashes} · fin ${reason}${par ? ` PAR ${par}` : ''}` });
  }
  found.sort((a, b) => b.score - a.score);
  for (const f of found.slice(0, 12)) console.log('DEMO', f.text);
  console.log('DEMO', found.length, 'graines retenues');
  console.log('DEMO fins (800 graines) : ' + Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${v}× ${k}`).join(' | '));
}, 600000);
