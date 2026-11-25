import { createDefaultTuning, type Tuning } from '../core/constants';

interface Slider {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SECTIONS: { title: string; sliders: Slider[] }[] = [
  {
    title: 'Physique',
    sliders: [
      { path: 'physics.timeScale', label: 'Ralenti global', min: 0.3, max: 1.5, step: 0.05 },
      { path: 'physics.gravity', label: 'Gravité (m/s²)', min: 4, max: 15, step: 0.1 },
      { path: 'physics.airDrag', label: 'Freinage air (1/s)', min: 0, max: 1, step: 0.01 },
      { path: 'physics.ground.restitution', label: 'Sol — rebond', min: 0.3, max: 0.95, step: 0.01 },
      { path: 'physics.ground.tangentialKeep', label: 'Sol — glisse', min: 0.3, max: 1, step: 0.01 },
      { path: 'physics.glass.restitution', label: 'Vitre — rebond', min: 0.3, max: 0.95, step: 0.01 },
      { path: 'physics.glass.tangentialKeep', label: 'Vitre — glisse', min: 0.3, max: 1, step: 0.01 },
      { path: 'physics.fence.restitution', label: 'Grillage — rebond', min: 0, max: 0.8, step: 0.01 },
      { path: 'physics.fence.tangentialKeep', label: 'Grillage — glisse', min: 0, max: 1, step: 0.01 },
      { path: 'physics.net.restitution', label: 'Filet — rebond', min: 0, max: 0.5, step: 0.01 },
      { path: 'physics.rollThreshold', label: 'Seuil de roulement (m/s)', min: 0.1, max: 2, step: 0.05 },
      { path: 'physics.rollFriction', label: 'Freinage roulement (1/s)', min: 0.2, max: 5, step: 0.1 },
    ],
  },
  {
    title: 'Frappe',
    sliders: [
      { path: 'shot.minSwipeSpeed', label: 'Geste lent (écrans/s)', min: 0.1, max: 2, step: 0.05 },
      { path: 'shot.maxSwipeSpeed', label: 'Geste rapide (écrans/s)', min: 1, max: 8, step: 0.1 },
      { path: 'shot.driveMinSpeed', label: 'Tendu — vitesse min (m/s)', min: 6, max: 25, step: 0.5 },
      { path: 'shot.driveMaxSpeed', label: 'Tendu — vitesse max (m/s)', min: 12, max: 40, step: 0.5 },
      { path: 'shot.netClearance', label: 'Tendu — marge filet (m)', min: 0, max: 1.5, step: 0.05 },
      { path: 'shot.lobThreshold', label: 'Mode vitesse — seuil lob', min: 0, max: 0.8, step: 0.01 },
      { path: 'shot.hookCurvature', label: 'Mode crochet — courbure lob', min: 0.03, max: 0.4, step: 0.01 },
      { path: 'shot.lobMinSpeed', label: 'Lob — vitesse min (m/s)', min: 6, max: 18, step: 0.5 },
      { path: 'shot.lobMaxSpeed', label: 'Lob — vitesse max (m/s)', min: 8, max: 22, step: 0.5 },
      { path: 'shot.lobElevationDeg', label: 'Lob — angle (°)', min: 20, max: 65, step: 1 },
      { path: 'shot.aimGain', label: 'Visée — amplification', min: 0.5, max: 3, step: 0.05 },
      { path: 'shot.maxAimDeg', label: 'Visée — angle max (°)', min: 10, max: 70, step: 1 },
    ],
  },
  {
    title: 'Jeu',
    sliders: [
      { path: 'play.reach', label: 'Portée de frappe (m)', min: 0.6, max: 2.5, step: 0.05 },
      { path: 'play.moveSpeed', label: 'Vitesse de déplacement (m/s)', min: 2, max: 9, step: 0.1 },
      { path: 'play.swipeBufferMs', label: 'Tolérance swipe en avance (ms)', min: 0, max: 500, step: 10 },
      { path: 'play.maxTimingAimErrorDeg', label: 'Erreur de direction max (°)', min: 0, max: 30, step: 1 },
      { path: 'play.maxTimingPowerError', label: 'Erreur de puissance max', min: 0, max: 0.6, step: 0.01 },
      { path: 'play.idealContactZ', label: 'Hauteur de frappe idéale (m)', min: 0.4, max: 1.8, step: 0.05 },
      { path: 'play.volleyPenalty', label: 'Réticence à la volée', min: 0, max: 2, step: 0.05 },
      { path: 'play.assist', label: 'Duo — aide latérale (0 = aucune)', min: 0, max: 1, step: 0.05 },
      { path: 'play.overheadZ', label: 'Duo — hauteur max au-dessus de la tête (m)', min: 2.2, max: 3.2, step: 0.05 },
      { path: 'play.smashMinZ', label: 'Duo — hauteur min pour smasher (m)', min: 1.2, max: 2.2, step: 0.05 },
      { path: 'shot.smashMaxSpeed', label: 'Smash — vitesse max (m/s)', min: 20, max: 40, step: 0.5 },
      { path: 'match.gamesToWin', label: 'Jeux gagnants pour le match', min: 1, max: 5, step: 1 },
    ],
  },
  {
    title: 'Vue',
    sliders: [
      { path: 'view.camDistance', label: 'Recul caméra (m)', min: 15, max: 100, step: 1 },
      { path: 'view.camHeight', label: 'Hauteur caméra (m)', min: 10, max: 120, step: 1 },
      { path: 'view.ballVisualRadius', label: 'Taille balle (m)', min: 0.04, max: 0.2, step: 0.005 },
      { path: 'view.playerScale', label: 'Taille des joueurs', min: 0.8, max: 1.8, step: 0.05 },
      { path: 'view.heightSizeGain', label: 'Grossissement / hauteur', min: 0, max: 0.4, step: 0.01 },
      { path: 'view.shadowOffsetX', label: 'Décalage ombre X', min: -0.5, max: 0.5, step: 0.01 },
      { path: 'view.shadowOffsetY', label: 'Décalage ombre Y', min: -0.5, max: 0.5, step: 0.01 },
    ],
  },
];

const STORAGE_KEY = 'rebote.tuning.v1';

function getPath(obj: unknown, path: string): number {
  return path.split('.').reduce<any>((o, k) => o?.[k], obj) as number;
}

function setPath(obj: unknown, path: string, value: number): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<any>((o, k) => o[k], obj);
  target[last] = value;
}

/** Recharge les réglages sauvegardés sur ce téléphone, par-dessus les valeurs par défaut. */
export function loadTuning(): Tuning {
  const t = createDefaultTuning();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return t;
    const saved = JSON.parse(raw) as Record<string, number | string>;
    for (const [path, v] of Object.entries(saved)) {
      if (path === 'shot.lobMode' && (v === 'speed' || v === 'hook')) t.shot.lobMode = v;
      else if (typeof v === 'number' && typeof getPath(t, path) === 'number') setPath(t, path, v);
    }
  } catch {
    // Stockage indisponible (navigation privée…) : valeurs par défaut.
  }
  return t;
}

export function saveTuning(t: Tuning): void {
  const flat: Record<string, number | string> = { 'shot.lobMode': t.shot.lobMode };
  for (const sec of SECTIONS) for (const s of sec.sliders) flat[s.path] = getPath(t, s.path);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flat));
  } catch {
    // Pas grave : les réglages valent pour la session.
  }
}

/** Panneau ⚙ : curseurs reliés en direct à l'objet `tuning`. */
export function mountTuningPanel(root: HTMLElement, tuning: Tuning, onChange: (path: string) => void): void {
  const build = () => {
    root.innerHTML = '';
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.innerHTML = `<strong>Réglages</strong>`;
    const close = button('Fermer', () => root.classList.add('hidden'));
    header.append(close);
    root.append(header);

    for (const sec of SECTIONS) {
      const h = document.createElement('h3');
      h.textContent = sec.title;
      root.append(h);
      for (const s of sec.sliders) root.append(sliderRow(s));
    }

    const actions = document.createElement('div');
    actions.className = 'panel-actions';
    actions.append(
      button('Copier JSON', async () => {
        const json = JSON.stringify(tuning, null, 2);
        try {
          await navigator.clipboard.writeText(json);
          flash('Copié — à coller dans src/core/constants.ts');
        } catch {
          const ta = document.createElement('textarea');
          ta.value = json;
          ta.rows = 10;
          actions.append(ta);
          ta.select();
        }
      }),
      button('Valeurs par défaut', () => {
        const d = createDefaultTuning();
        Object.assign(tuning.physics, d.physics);
        Object.assign(tuning.shot, d.shot);
        Object.assign(tuning.view, d.view);
        Object.assign(tuning.play, d.play);
        Object.assign(tuning.match, d.match);
        saveTuning(tuning);
        onChange('*');
        build();
      }),
    );
    root.append(actions);
  };

  const sliderRow = (s: Slider): HTMLElement => {
    const row = document.createElement('label');
    row.className = 'slider-row';
    const name = document.createElement('span');
    name.textContent = s.label;
    const value = document.createElement('output');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(s.min);
    input.max = String(s.max);
    input.step = String(s.step);
    input.value = String(getPath(tuning, s.path));
    value.textContent = input.value;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      setPath(tuning, s.path, v);
      value.textContent = input.value;
      saveTuning(tuning);
      onChange(s.path);
    });
    row.append(name, value, input);
    return row;
  };

  const flash = (msg: string) => {
    const el = document.createElement('div');
    el.className = 'panel-flash';
    el.textContent = msg;
    root.append(el);
    setTimeout(() => el.remove(), 2000);
  };

  build();
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
