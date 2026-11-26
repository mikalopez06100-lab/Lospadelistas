/**
 * Enregistre la démo du jeu (?demo=1) en vidéo verticale 1080×1920, 30 images/s, avec le son.
 *
 *   npm run demo:video            → demo.mp4 à la racine du dépôt
 *   npm run demo:video -- 45      → 45 secondes au lieu de 30
 *
 * Principe : rien n'est capturé en temps réel.
 *  - L'horloge de la page est pilotée par Playwright : on avance de 1/30 s, on photographie,
 *    et ainsi de suite. Chaque image est exacte, quelle que soit la vitesse de la machine.
 *  - Le jeu consigne chaque son avec son instant ; à la fin, la page rejoue ce journal dans un
 *    contexte audio hors ligne et rend un WAV. Image et son sont donc synchrones par construction.
 *  - ffmpeg assemble le tout en H.264 + AAC.
 *
 * Prérequis : ffmpeg dans le PATH, et un Chromium pour Playwright (CHROMIUM_PATH pour en imposer un).
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SECONDS = Number(process.argv[2] ?? 30);
const FPS = 30;
const OUT = resolve(ROOT, process.argv[3] ?? 'demo.mp4');
const PORT = 4188;
// 360×640 px CSS à densité 3 = 1080×1920 pixels réels : le jeu y tourne à sa résolution native ×6.
const VIEWPORT = { width: 360, height: 640 };
const SCALE = 3;

function run(cmd, args, opts = {}) {
  return new Promise((ok, ko) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    p.on('error', ko);
    p.on('exit', (code) => (code === 0 ? ok() : ko(new Error(`${cmd} a échoué (code ${code})`))));
  });
}

async function waitForServer(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Pas encore prêt.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`le serveur ne répond pas sur ${url}`);
}

const work = mkdtempSync(join(tmpdir(), 'padel86-demo-'));
let server;
let browser;
try {
  console.log('1/4 build du jeu…');
  await run('npx', ['vite', 'build', '--logLevel', 'error']);
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  const base = `http://localhost:${PORT}/`;
  await waitForServer(base);

  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined),
    args: ['--headless=new', '--hide-scrollbars'],
  });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Horloge factice : setTimeout, setInterval, requestAnimationFrame et performance.now n'avancent
  // plus que sur ordre.
  await page.clock.install({ time: 0 });
  await page.goto(`${base}?demo=1&capture=1`);
  await page.waitForFunction(() => typeof window.padel86Demo === 'object' && document.fonts.status === 'loaded');
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode().catch(() => undefined))));
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await page.evaluate(() => window.padel86Demo.start());

  console.log(`2/4 capture de ${SECONDS * FPS} images…`);
  const silent = join(work, 'video.mp4');
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), silent],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const encoded = new Promise((ok, ko) => ffmpeg.on('exit', (code) => (code === 0 ? ok() : ko(new Error(`ffmpeg vidéo : code ${code}`)))));
  const total = SECONDS * FPS;
  for (let i = 0; i < total; i++) {
    // 33 + 33 + 34 ms : exactement 100 ms toutes les trois images, donc 30 images/s sans dérive.
    await page.clock.runFor(i % 3 === 2 ? 34 : 33);
    const png = await page.screenshot({ type: 'png' });
    if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
    if ((i + 1) % 150 === 0) console.log(`    ${i + 1} / ${total}`);
  }
  ffmpeg.stdin.end();
  await encoded;

  console.log('3/4 rendu de la bande-son…');
  const wavBase64 = await page.evaluate((s) => window.padel86Demo.renderAudio(s), SECONDS);
  const wav = join(work, 'audio.wav');
  writeFileSync(wav, Buffer.from(wavBase64, 'base64'));

  console.log('4/4 assemblage…');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
    '-t', String(SECONDS), '-movflags', '+faststart', OUT]);
  if (errors.length) console.warn('Erreurs dans la page pendant la capture :', errors);
  console.log(`Terminé : ${OUT}`);
} finally {
  await browser?.close();
  server?.kill();
  rmSync(work, { recursive: true, force: true });
}
