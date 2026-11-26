"""PÁDEL 86 — thème électro old school (chiptune + boîte à rythmes 808-like) et bruitages."""
import numpy as np, wave, subprocess, os

SR = 44100
BPM = 120
STEP = 60 / BPM / 4          # double-croche
BAR = STEP * 16
rng = np.random.default_rng(86)

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def freq(n):
    name, octv = n[:-1], int(n[-1])
    midi = 12 * (octv + 1) + NOTE[name]
    return 440 * 2 ** ((midi - 69) / 12)


def pulse(f, dur, duty=0.5, vib=0.0, vib_delay=0.12):
    t = np.arange(int(dur * SR)) / SR
    fm = f * (1 + vib * np.sin(2 * np.pi * 5.5 * t) * (t > vib_delay))
    ph = np.cumsum(fm) / SR
    return np.where((ph % 1) < duty, 1.0, -1.0)


def tri(f, dur):
    t = np.arange(int(dur * SR)) / SR
    ph = (f * t) % 1
    return 4 * np.abs(ph - 0.5) - 1


def env(n, a=0.003, d=0.08, s=0.6, r=0.03):
    e = np.ones(n) * s
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    A = min(A, n); e[:A] = np.linspace(0, 1, A)
    D2 = min(D, n - A)
    if D2 > 0:
        e[A:A + D2] = np.linspace(1, s, D2)
    if R < n:
        e[-R:] *= np.linspace(1, 0, R)
    return e


def kick(dur=0.38):
    n = int(dur * SR); t = np.arange(n) / SR
    f = 45 + 120 * np.exp(-t * 28)
    ph = np.cumsum(f) / SR
    return np.sin(2 * np.pi * ph) * np.exp(-t * 7.5) * 1.1 + rng.normal(0, 1, n) * np.exp(-t * 300) * 0.25


def clap(dur=0.22):
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = nz - np.concatenate([[0], nz[:-1]]) * 0.6  # léger passe-haut
    e = np.exp(-t * 18) * 0.7
    for off in (0.0, 0.011, 0.022):
        i = int(off * SR); e[i:i + 300] += np.linspace(1, 0, min(300, n - i))
    return nz * e * 0.45


def hat(dur=0.045, open_=False):
    if open_:
        dur = 0.22
    n = int(dur * SR); t = np.arange(n) / SR
    nz = rng.normal(0, 1, n)
    nz = nz - np.concatenate([[0], nz[:-1]])
    return nz * np.exp(-t * (14 if open_ else 90)) * 0.12


def cowbell(dur=0.18):
    t = np.arange(int(dur * SR)) / SR
    s = pulse(540, dur, 0.5) + pulse(800, dur, 0.5)
    return s * np.exp(-t * 16) * 0.08


class Track:
    def __init__(self, bars):
        self.buf = np.zeros(int(bars * BAR * SR) + SR * 2)

    def add(self, sig, t, gain=1.0):
        i = int(t * SR)
        j = min(len(self.buf), i + len(sig))
        self.buf[i:j] += sig[:j - i] * gain


def seq_tokens(s):
    """'E5 - . A5 ...' -> liste de (step, note, longueur en steps)"""
    toks = s.split()
    out = []
    i = 0
    while i < len(toks):
        tk = toks[i]
        if tk not in ('-', '.'):
            L = 1
            while i + L < len(toks) and toks[i + L] == '-':
                L += 1
            out.append((i, tk, L))
            i += L
        else:
            i += 1
    return out


CH = {  # accords
    'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C'], 'C': ['C', 'E', 'G'], 'G': ['G', 'B', 'D'],
    'E': ['E', 'G#', 'B'], 'Dm': ['D', 'F', 'A'], 'Em': ['E', 'G', 'B'],
}
ROOT = {'Am': 'A', 'F': 'F', 'C': 'C', 'G': 'G', 'E': 'E', 'Dm': 'D', 'Em': 'E'}

PROG_A = ['Am', 'F', 'C', 'G', 'Am', 'F', 'C', 'E']
PROG_B = ['Dm', 'Am', 'F', 'E', 'Dm', 'Am', 'F', 'E']

MEL_A = [
    "E5 - . E5 A5 - G5 - E5 - D5 - C5 - D5 -",
    "C5 - A4 - C5 - F5 - E5 - C5 - A4 - . .",
    "G4 - C5 - E5 - G5 - A5 - G5 - E5 - C5 -",
    "D5 - - - B4 - D5 - G5 - - - . . B4 -",
    "E5 - . E5 A5 - G5 - E5 - D5 - C5 - E5 -",
    "F5 - E5 - C5 - A4 - C5 - F5 - A5 - . .",
    "G5 - E5 - C5 - E5 - G5 - C6 - B5 - G5 -",
    "B4 - - - E5 - G#5 - B5 - - - G#5 - E5 -",
]
MEL_B = [
    "F5 . F5 . A5 . F5 . D5 - - - . . E5 -",
    "E5 . E5 . A5 . E5 . C5 - - - . . A4 -",
    "A4 - C5 - F5 - A5 - G5 - F5 - E5 - C5 -",
    "B4 - - - G#4 - B4 - E5 - - - - - - -",
    "F5 . F5 . A5 . F5 . D5 - - - . . E5 -",
    "E5 . E5 . A5 . C6 . B5 - - - . . A5 -",
    "A5 - G5 - F5 - E5 - D5 - C5 - B4 - C5 -",
    "B4 - D5 - E5 - G#5 - B5 - - - - - - -",
]
BASS_PAT = "R . R O . R . R R . O . R . O R"   # électro syncopé
KICK = [0, 7, 10]
KICK_B = [0, 3, 7, 10]
CLAP = [4, 12]


def bass_bar(tr, t0, chord, gain=0.22):
    r = ROOT[chord]
    for i, tk in enumerate(BASS_PAT.split()):
        if tk == '.':
            continue
        n = r + ('1' if tk == 'R' else '2')
        f = freq(n)
        s = pulse(f, STEP * 0.9, 0.5) * 0.55 + tri(f, STEP * 0.9) * 0.45
        tr.add(s * env(len(s), 0.002, 0.06, 0.5, 0.02), t0 + i * STEP, gain)


def arp_bar(tr, t0, chord, gain=0.085, oct_=5, duty=0.125):
    notes = CH[chord]
    seq = [notes[0], notes[1], notes[2], notes[1]]
    for i in range(16):
        n = seq[i % 4] + str(oct_ + (1 if i % 8 >= 4 and seq[i % 4] == notes[0] else 0))
        s = pulse(freq(n), STEP * 0.7, duty)
        tr.add(s * env(len(s), 0.001, 0.05, 0.3, 0.01), t0 + i * STEP, gain)


def lead_bar(tr, t0, line, gain=0.18, duty=0.25, echo=True):
    for (st, n, L) in seq_tokens(line):
        dur = L * STEP * 0.95
        s = pulse(freq(n), dur, duty, vib=0.012)
        s = s * env(len(s), 0.004, 0.1, 0.7, 0.04)
        tr.add(s, t0 + st * STEP, gain)
        if echo:  # écho pointé façon 80s
            tr.add(s, t0 + st * STEP + STEP * 3, gain * 0.32)
            tr.add(s, t0 + st * STEP + STEP * 6, gain * 0.12)


def drums_bar(tr, t0, kicks=KICK, clap_on=True, hats=True, open_hat=True, bell=False, fill=False):
    K, Cp = kick(), clap()
    for k in kicks:
        tr.add(K, t0 + k * STEP, 0.62)
    if clap_on:
        for c in CLAP:
            tr.add(Cp, t0 + c * STEP, 1.0)
    if hats:
        for i in range(16):
            if open_hat and i == 14:
                tr.add(hat(open_=True), t0 + i * STEP, 1.0)
            else:
                tr.add(hat(), t0 + i * STEP, 1.0 if i % 2 == 0 else 0.55)
    if bell:
        for i in (3, 6, 11):
            tr.add(cowbell(), t0 + i * STEP, 1.0)
    if fill:
        for i in (12, 13, 14, 15):
            tr.add(Cp, t0 + i * STEP, 0.6 + 0.1 * (i - 12))


def theme():
    bars = 4 + 8 + 8 + 4 + 8
    tr = Track(bars)
    b = 0
    # Intro : arpège + charleston, kick à partir de la mesure 3
    for i in range(4):
        t0 = b * BAR
        ch = ['Am', 'F', 'C', 'E'][i]
        arp_bar(tr, t0, ch, gain=0.04 + 0.012 * i)
        drums_bar(tr, t0, kicks=KICK if i >= 2 else [], clap_on=i == 3, open_hat=i >= 1, fill=i == 3)
        if i >= 2:
            bass_bar(tr, t0, ch, 0.16)
        b += 1
    # A
    for i, ch in enumerate(PROG_A):
        t0 = b * BAR
        arp_bar(tr, t0, ch)
        bass_bar(tr, t0, ch)
        drums_bar(tr, t0, fill=i == 7)
        lead_bar(tr, t0, MEL_A[i])
        b += 1
    # B
    for i, ch in enumerate(PROG_B):
        t0 = b * BAR
        arp_bar(tr, t0, ch, duty=0.25, gain=0.06)
        bass_bar(tr, t0, ch)
        drums_bar(tr, t0, kicks=KICK_B, bell=True, fill=i == 7)
        lead_bar(tr, t0, MEL_B[i], duty=0.5, gain=0.15)
        b += 1
    # Break : basse + arpège + « vitres »
    for i, ch in enumerate(['Am', 'F', 'Dm', 'E']):
        t0 = b * BAR
        arp_bar(tr, t0, ch, gain=0.08, oct_=6)
        bass_bar(tr, t0, ch, 0.2)
        drums_bar(tr, t0, kicks=[0, 8] if i < 3 else KICK, clap_on=i == 3, hats=i >= 2, fill=i == 3)
        tr.add(sfx_glass() * 0.5, t0 + 8 * STEP)
        b += 1
    # A' final : lead doublé à l'octave
    for i, ch in enumerate(PROG_A):
        t0 = b * BAR
        arp_bar(tr, t0, ch)
        bass_bar(tr, t0, ch)
        drums_bar(tr, t0, kicks=KICK_B if i % 2 else KICK, bell=i % 2 == 1)
        lead_bar(tr, t0, MEL_A[i])
        up_line = " ".join(t if t in '-.' else t[:-1] + str(int(t[-1]) + 1) for t in MEL_A[i].split())
        lead_bar(tr, t0, up_line, gain=0.045, duty=0.125, echo=False)
        b += 1
    out = tr.buf[:int(bars * BAR * SR)]
    # repli de la queue d'écho sur le début pour une boucle propre
    tail = tr.buf[int(bars * BAR * SR):]
    out[:len(tail)] += tail
    return master(out)


def master(x, ceiling=0.89):
    x = np.tanh(x * 1.3) / np.tanh(1.3)
    return x / np.max(np.abs(x)) * ceiling


# ---------------------------------------------------------------- bruitages
def sweep(f0, f1, dur, duty=0.5):
    n = int(dur * SR); t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    ph = np.cumsum(f) / SR
    return np.where((ph % 1) < duty, 1.0, -1.0)


def sfx_hit():
    s = sweep(1100, 380, 0.09, 0.5) * np.exp(-np.arange(int(0.09 * SR)) / SR * 30)
    nz = rng.normal(0, 1, len(s)) * np.exp(-np.arange(len(s)) / SR * 120) * 0.6
    return master(s * 0.6 + nz, 0.8)


def sfx_glass():
    dur = 0.45; n = int(dur * SR); t = np.arange(n) / SR
    s = 0
    for f, a in ((1760, 1), (2637, 0.6), (3520, 0.35), (4186, 0.2)):
        s = s + np.sin(2 * np.pi * f * t * (1 + 0.002 * np.sin(2 * np.pi * 30 * t))) * a * np.exp(-t * (9 + f / 600))
    tink = rng.normal(0, 1, n) * np.exp(-t * 200) * 0.4
    return master(s + tink, 0.75)


def sfx_smash():
    dur = 0.28; n = int(dur * SR); t = np.arange(n) / SR
    s = sweep(700, 90, dur, 0.5) * np.exp(-t * 9)
    nz = rng.normal(0, 1, n) * np.exp(-t * 18)
    return master(s * 0.6 + nz * 0.7 + kick(dur) * 0.6, 0.9)


def jingle(notes, step=0.075, duty=0.25, last_hold=3):
    tr = Track(1.2)
    for i, n in enumerate(notes):
        L = step * (last_hold if i == len(notes) - 1 else 1)
        s = pulse(freq(n), L, duty, vib=0.01 if i == len(notes) - 1 else 0)
        tr.add(s * env(len(s), 0.002, 0.05, 0.6, 0.03), i * step, 0.5)
        f = freq(n) / 2
        b = tri(f, L)
        tr.add(b * env(len(b)), i * step, 0.35)
    x = tr.buf
    nz = np.nonzero(np.abs(x) > 1e-4)[0]
    return master(x[:nz[-1] + 1000], 0.8)


def sfx_point():
    return jingle(['C5', 'E5', 'G5', 'C6'], 0.07)


def sfx_fault():
    return jingle(['E4', 'C4'], 0.12, 0.5, 2)


def sfx_coin():
    return jingle(['B5', 'E6'], 0.07, 0.5, 5)


def sfx_win():
    return jingle(['C5', 'E5', 'G5', 'C6', 'G5', 'C6', 'E6', 'G6'], 0.09, 0.25, 6)


def sfx_lose():
    return jingle(['G4', 'F#4', 'F4', 'E4'], 0.16, 0.5, 4)


def save_wav(path, x):
    x16 = (np.clip(x, -1, 1) * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(x16.tobytes())


def to_mp3(wav, mp3, br='160k'):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', br, mp3], check=True)


if __name__ == '__main__':
    os.makedirs('out/sfx', exist_ok=True)
    th = theme()
    save_wav('out/padel86-theme.wav', th)
    to_mp3('out/padel86-theme.wav', 'out/padel86-theme.mp3', '192k')
    for name, fn in (('hit', sfx_hit), ('vitre', sfx_glass), ('smash', sfx_smash), ('point', sfx_point),
                     ('faute', sfx_fault), ('coin', sfx_coin), ('victoire', sfx_win), ('defaite', sfx_lose)):
        save_wav(f'out/sfx/{name}.wav', fn())
        to_mp3(f'out/sfx/{name}.wav', f'out/sfx/{name}.mp3', '128k')
    print('durée thème', len(th) / SR)
