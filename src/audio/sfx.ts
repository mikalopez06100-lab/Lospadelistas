import type { Surface } from '../core/physics/step';

/**
 * Sons synthétisés en WebAudio : aucun fichier à charger, donc rien à télécharger ni à mettre
 * en cache. Le jeu reste entièrement jouable sans son (tout a un retour visuel).
 * Sur iOS, le son ne démarre qu'après un premier geste : appeler unlock() sur pointerdown.
 */
export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  unlock(): void {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.ctx.destination);
        const len = Math.floor(this.ctx.sampleRate * 0.5);
        this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // Pas d'audio sur cet appareil : le jeu continue sans.
      this.ctx = null;
    }
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.ctx.state === 'running' ? this.ctx : null;
  }

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

  /** Frappe de pala : claquement sec, plus grave et plus fort avec la puissance. */
  hit(power: number): void {
    const v = 0.35 + 0.65 * power;
    this.noise(0.05, 0.7 * v, 'bandpass', 1500 + 900 * power, 1.2);
    this.tone(240, 0.08, 0.5 * v, 'sine', 0, 110);
  }

  /** Impact sur une surface ; `speed` = vitesse perpendiculaire en m/s. */
  contact(surface: Surface, speed: number): void {
    const v = Math.min(1, 0.2 + speed / 14);
    if (surface === 'ground') {
      this.tone(170, 0.09, 0.55 * v, 'sine', 0, 70);
      this.noise(0.03, 0.2 * v, 'lowpass', 900);
    } else if (surface === 'glass') {
      // Le son vedette : un « tonk » de verre, corps grave + partiels clairs désaccordés.
      const detune = 0.97 + Math.random() * 0.06;
      this.tone(130, 0.12, 0.5 * v, 'sine', 0, 80);
      this.tone(1180 * detune, 0.28, 0.28 * v, 'triangle');
      this.tone(1790 * detune, 0.2, 0.16 * v, 'sine');
      this.tone(2710 * detune, 0.12, 0.08 * v, 'sine');
      this.noise(0.025, 0.35 * v, 'highpass', 3500);
    } else if (surface === 'fence') {
      for (let i = 0; i < 3; i++) this.noise(0.05, 0.3 * v, 'bandpass', 2600 + i * 500, 3, i * 0.035);
    } else {
      this.noise(0.16, 0.4 * v, 'lowpass', 420);
    }
  }

  perfect(): void {
    this.tone(1320, 0.09, 0.12, 'sine', 0.02);
  }

  fault(): void {
    this.tone(196, 0.16, 0.22, 'square', 0, 150);
  }

  pointWon(): void {
    this.tone(660, 0.12, 0.25, 'triangle');
    this.tone(880, 0.2, 0.25, 'triangle', 0.1);
  }

  pointLost(): void {
    this.tone(330, 0.14, 0.2, 'triangle');
    this.tone(247, 0.24, 0.2, 'triangle', 0.12);
  }

  /** Coup gagnant via les vitres : montée scintillante pendant le ralenti. */
  rebote(): void {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.35, 0.16, 'triangle', i * 0.09));
  }

  matchWon(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i === 3 ? 0.5 : 0.16, 0.26, 'triangle', i * 0.14));
  }

  matchLost(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, i === 2 ? 0.5 : 0.2, 0.22, 'triangle', i * 0.18));
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
