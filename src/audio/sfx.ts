import type { Surface } from '../core/physics/step';

/**
 * Son de PÁDEL 86 : échantillons du kit (public/padel86/sfx) et thème musical en boucle.
 * Les impacts sans échantillon (sol, filet, grillage) restent synthétisés, discrets.
 * Le jeu reste entièrement jouable sans son. Sur iOS, rien ne démarre avant un premier
 * geste : appeler unlock() sur pointerdown, et theme() depuis ce même geste.
 *
 * Tout son passe par un petit vocabulaire de « notes » (échantillon, ton, bruit, thème). On peut
 * donc aussi les consigner dans un journal horodaté et les rejouer plus tard hors ligne : c'est
 * ce qui donne sa bande-son à la vidéo de démonstration (voir renderJournal).
 */
const SAMPLES = ['coin', 'hit', 'vitre', 'smash', 'point', 'faute', 'victoire', 'defaite'] as const;
type Sample = (typeof SAMPLES)[number];
export type ThemeMode = 'menu' | 'match' | 'off';

/** Volume du thème : plein au menu, −6 dB en match. */
const THEME_GAIN: Record<ThemeMode, number> = { menu: 0.55, match: 0.275, off: 0 };
const MASTER_GAIN = 0.6;

export type Note =
  | { kind: 'sample'; name: Sample; gain: number }
  | { kind: 'tone'; freq: number; dur: number; gain: number; type: OscillatorType; delay: number; freqEnd: number }
  | { kind: 'noise'; dur: number; gain: number; filter: BiquadFilterType; freq: number; q: number; delay: number; offset: number }
  | { kind: 'theme'; mode: ThemeMode; restart: boolean };

export interface JournalEntry {
  /** Instant de la note, en secondes depuis le début de l'enregistrement. */
  t: number;
  note: Note;
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Bruit pseudo-aléatoire à graine fixe : le même partout, donc une bande-son reproductible.
  let seed = 0x2545f491;
  for (let i = 0; i < len; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = seed / 2147483648 - 1;
  }
  return buf;
}

/** Joue une note (hors thème) sur un contexte audio, à l'instant `when` du contexte. */
function playNote(ctx: BaseAudioContext, dest: AudioNode, note: Note, when: number, buffers: Map<Sample, AudioBuffer>, noise: AudioBuffer): void {
  if (note.kind === 'sample') {
    const buf = buffers.get(note.name);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = note.gain;
    src.connect(g).connect(dest);
    src.start(when);
  } else if (note.kind === 'tone') {
    const t0 = when + note.delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = note.type;
    osc.frequency.setValueAtTime(note.freq, t0);
    if (note.freqEnd !== note.freq) osc.frequency.exponentialRampToValueAtTime(note.freqEnd, t0 + note.dur);
    g.gain.setValueAtTime(note.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    osc.connect(g).connect(dest);
    osc.start(t0);
    osc.stop(t0 + note.dur + 0.02);
  } else if (note.kind === 'noise') {
    const t0 = when + note.delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = note.filter;
    f.frequency.value = note.freq;
    f.Q.value = note.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(note.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + note.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t0, note.offset);
    src.stop(t0 + note.dur + 0.02);
  }
}

async function fetchBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const data = await (await fetch(url)).arrayBuffer();
  return ctx.decodeAudioData(data);
}

export class Sfx {
  private on = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<Sample, AudioBuffer>();
  private loading = false;
  private wanted: { note: Note; at: number } | null = null;
  private themeEl: HTMLAudioElement | null = null;
  private themeGain: GainNode | null = null;
  private themeMode: ThemeMode = 'off';
  /** Journal des notes jouées (mode démo) ; null = pas de consignation. */
  journal: JournalEntry[] | null = null;
  /** Si vrai, rien n'est joué en direct : on ne fait que consigner (capture vidéo image par image). */
  silent = false;
  /** Horloge du journal (secondes). */
  clock: () => number = () => performance.now() / 1000;

  get enabled(): boolean {
    return this.on;
  }

  set enabled(v: boolean) {
    this.on = v;
    this.applyTheme();
  }

  unlock(): void {
    if (!this.on || this.silent) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = MASTER_GAIN;
        this.master.connect(this.ctx.destination);
        this.noise = noiseBuffer(this.ctx);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      this.loadSamples();
    } catch {
      // Pas d'audio sur cet appareil : le jeu continue sans.
      this.ctx = null;
    }
  }

  private loadSamples(): void {
    const ctx = this.ctx;
    if (!ctx || this.loading) return;
    this.loading = true;
    for (const name of SAMPLES) {
      fetchBuffer(ctx, `./padel86/sfx/${name}.mp3`)
        .then((buf) => {
          this.buffers.set(name, buf);
          // Tout premier toucher : l'échantillon demandé n'était pas encore décodé, on le joue maintenant.
          const w = this.wanted;
          if (w && w.note.kind === 'sample' && w.note.name === name && performance.now() - w.at < 1500) this.live(w.note);
        })
        .catch(() => {
          // Échantillon indisponible : le son correspondant est simplement muet.
        });
    }
  }

  private emit(note: Note): void {
    if (!this.on) return;
    this.journal?.push({ t: this.clock(), note });
    if (!this.silent) this.live(note);
  }

  private live(note: Note): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise) return;
    if (note.kind === 'sample' && !this.buffers.has(note.name)) {
      this.wanted = { note, at: performance.now() };
      return;
    }
    const go = () => playNote(ctx, this.master!, note, ctx.currentTime, this.buffers, this.noise!);
    if (ctx.state === 'running') go();
    else void ctx.resume().then(go, () => undefined);
  }

  private sample(name: Sample, gain = 1): void {
    this.emit({ kind: 'sample', name, gain });
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, freqEnd = freq): void {
    this.emit({ kind: 'tone', freq, dur, gain, type, delay, freqEnd });
  }

  private hiss(dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 1, delay = 0): void {
    this.emit({ kind: 'noise', dur, gain, filter, freq, q, delay, offset: 0.05 + 0.03 * ((freq / 100) % 7) });
  }

  // ——— Thème musical ———

  /** Choisit l'ambiance. À appeler depuis un geste de l'utilisateur la première fois. */
  theme(mode: ThemeMode): void {
    this.themeMode = mode;
    if (this.on) this.journal?.push({ t: this.clock(), note: { kind: 'theme', mode, restart: false } });
    this.applyTheme();
  }

  private applyTheme(): void {
    if (this.silent) return;
    const play = this.on && this.themeMode !== 'off';
    if (!play) {
      this.themeEl?.pause();
      return;
    }
    try {
      if (!this.themeEl) {
        this.themeEl = new Audio('./padel86/padel86-theme.mp3');
        this.themeEl.loop = true;
        this.themeEl.preload = 'auto';
      }
      // Le volume d'un <audio> est figé sur iOS : on passe par un gain WebAudio.
      if (this.ctx && this.master && !this.themeGain) {
        this.themeGain = this.ctx.createGain();
        this.ctx.createMediaElementSource(this.themeEl).connect(this.themeGain).connect(this.master);
      }
      if (this.themeGain) this.themeGain.gain.value = THEME_GAIN[this.themeMode] / MASTER_GAIN;
      else this.themeEl.volume = THEME_GAIN[this.themeMode];
      void this.themeEl.play().catch(() => {
        // Lecture refusée (pas encore de geste) : elle repartira au prochain toucher.
      });
    } catch {
      // Musique indisponible : sans conséquence pour le jeu.
    }
  }

  /** Coupe le thème et le remet au début (fin de match). */
  stopTheme(): void {
    this.themeMode = 'off';
    if (this.on) this.journal?.push({ t: this.clock(), note: { kind: 'theme', mode: 'off', restart: true } });
    if (this.themeEl) {
      this.themeEl.pause();
      this.themeEl.currentTime = 0;
    }
  }

  // ——— Événements du jeu ———

  coin(): void {
    this.sample('coin');
  }

  hit(power: number): void {
    this.sample('hit', 0.55 + 0.45 * power);
  }

  smash(): void {
    this.sample('smash');
  }

  /** Impact sur une surface ; `speed` = vitesse perpendiculaire en m/s. */
  contact(surface: Surface, speed: number): void {
    const v = Math.min(1, 0.2 + speed / 14);
    if (surface === 'glass') {
      this.sample('vitre', 0.5 + 0.5 * v);
    } else if (surface === 'ground') {
      this.tone(170, 0.07, 0.3 * v, 'square', 0, 70);
    } else if (surface === 'fence') {
      for (let i = 0; i < 3; i++) this.hiss(0.05, 0.25 * v, 'bandpass', 2600 + i * 500, 3, i * 0.035);
    } else {
      this.hiss(0.16, 0.35 * v, 'lowpass', 420);
    }
  }

  perfect(): void {
    this.tone(1320, 0.08, 0.1, 'square', 0.02);
  }

  fault(): void {
    this.sample('faute');
  }

  pointWon(): void {
    this.sample('point');
  }

  pointLost(): void {
    this.sample('faute', 0.8);
  }

  /** Coup gagnant via les vitres : arpège 8 bits pendant le ralenti. */
  rebote(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.3, 0.12, 'square', i * 0.09));
  }

  matchWon(): void {
    this.sample('victoire');
  }

  matchLost(): void {
    this.sample('defaite');
  }
}

/**
 * Rejoue un journal de notes hors ligne et renvoie la bande-son en WAV 16 bits stéréo.
 * Les notes tombent exactement à l'instant où le jeu les a demandées : image et son sont
 * synchrones par construction, sans rien enregistrer en temps réel.
 */
export async function renderJournal(journal: readonly JournalEntry[], seconds: number, sampleRate = 48000): Promise<ArrayBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  // Un fichier ne pardonne pas la saturation comme le fait un haut-parleur : on garde de la marge.
  const headroom = ctx.createGain();
  headroom.gain.value = 0.7;
  master.connect(headroom).connect(ctx.destination);
  const buffers = new Map<Sample, AudioBuffer>();
  await Promise.all(SAMPLES.map(async (name) => buffers.set(name, await fetchBuffer(ctx, `./padel86/sfx/${name}.mp3`))));
  const noise = noiseBuffer(ctx);

  // Thème : une source en boucle, dont le volume suit les changements d'ambiance du journal.
  const themeNotes = journal.filter((e) => e.note.kind === 'theme');
  if (themeNotes.length) {
    const themeGain = ctx.createGain();
    themeGain.gain.value = 0;
    themeGain.connect(master);
    const themeBuffer = await fetchBuffer(ctx, './padel86/padel86-theme.mp3');
    const start = (when: number) => {
      const src = ctx.createBufferSource();
      src.buffer = themeBuffer;
      src.loop = true;
      src.connect(themeGain);
      src.start(when);
      return src;
    };
    let current: AudioBufferSourceNode | null = null;
    for (const e of themeNotes) {
      if (e.note.kind !== 'theme') continue;
      const mode = e.note.mode;
      themeGain.gain.setValueAtTime(THEME_GAIN[mode] / MASTER_GAIN, e.t);
      if (mode !== 'off' && !current) current = start(e.t);
      if (e.note.restart && current) {
        current.stop(e.t);
        current = null;
      }
    }
  }
  for (const e of journal) if (e.note.kind !== 'theme' && e.t < seconds) playNote(ctx, master, e.note, e.t, buffers, noise);

  const rendered = await ctx.startRendering();
  return encodeWav(rendered);
}

function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const channels = buf.numberOfChannels;
  const frames = buf.length;
  const out = new ArrayBuffer(44 + frames * channels * 2);
  const view = new DataView(out);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * channels * 2, true);
  ascii(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buf.sampleRate, true);
  view.setUint32(28, buf.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buf.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}

/** Vibration courte. Sans effet sur iPhone : Safari n'implémente pas l'API Vibration. */
export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Non supporté : ignoré.
  }
}

export function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}
