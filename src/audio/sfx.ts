import type { Surface } from '../core/physics/step';

/**
 * Son de PÁDEL 86 : échantillons du kit (public/padel86/sfx) et thème musical en boucle.
 * Les impacts sans échantillon (sol, filet, grillage) restent synthétisés, discrets.
 * Le jeu reste entièrement jouable sans son. Sur iOS, rien ne démarre avant un premier
 * geste : appeler unlock() sur pointerdown, et theme() depuis ce même geste.
 */
const SAMPLES = ['coin', 'hit', 'vitre', 'smash', 'point', 'faute', 'victoire', 'defaite'] as const;
type Sample = (typeof SAMPLES)[number];
export type ThemeMode = 'menu' | 'match' | 'off';

/** Volume du thème : plein au menu, −6 dB en match. */
const THEME_GAIN: Record<ThemeMode, number> = { menu: 0.55, match: 0.275, off: 0 };

export class Sfx {
  private on = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private buffers = new Map<Sample, AudioBuffer>();
  private loading = false;
  private wanted: { name: Sample; at: number } | null = null;
  private themeEl: HTMLAudioElement | null = null;
  private themeGain: GainNode | null = null;
  private themeMode: ThemeMode = 'off';

  get enabled(): boolean {
    return this.on;
  }

  set enabled(v: boolean) {
    this.on = v;
    this.applyTheme();
  }

  unlock(): void {
    if (!this.on) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.6;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
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
      fetch(`./padel86/sfx/${name}.mp3`)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => {
          this.buffers.set(name, buf);
          if (this.wanted?.name === name && performance.now() - this.wanted.at < 1500) this.sample(name);
        })
        .catch(() => {
          // Échantillon indisponible : le son correspondant est simplement muet.
        });
    }
  }

  private ready(): AudioContext | null {
    return this.on && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

  private sample(name: Sample, gain = 1): void {
    const ctx = this.ctx;
    if (!this.on || !ctx) return;
    const buf = this.buffers.get(name);
    if (!buf) {
      // Tout premier toucher : l'échantillon n'est pas encore décodé, on le jouera dès qu'il l'est.
      this.wanted = { name, at: performance.now() };
      return;
    }
    const go = () => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(this.master!);
      src.start();
    };
    if (ctx.state === 'running') go();
    else void ctx.resume().then(go, () => undefined);
  }

  // ——— Thème musical ———

  /** Choisit l'ambiance. À appeler depuis un geste de l'utilisateur la première fois. */
  theme(mode: ThemeMode): void {
    this.themeMode = mode;
    this.applyTheme();
  }

  private applyTheme(): void {
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
      if (this.themeGain) this.themeGain.gain.value = THEME_GAIN[this.themeMode] / 0.6;
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
    if (this.themeEl) {
      this.themeEl.pause();
      this.themeEl.currentTime = 0;
    }
  }

  // ——— Synthèse, pour les impacts sans échantillon ———

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0, freqEnd = freq): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filter: BiquadFilterType, freq: number, q = 1, delay = 0): void {
    const ctx = this.ready();
    if (!ctx || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0, Math.random() * 0.3);
    src.stop(t0 + dur + 0.02);
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
      for (let i = 0; i < 3; i++) this.noise(0.05, 0.25 * v, 'bandpass', 2600 + i * 500, 3, i * 0.035);
    } else {
      this.noise(0.16, 0.35 * v, 'lowpass', 420);
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
