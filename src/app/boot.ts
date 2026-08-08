// Cold-boot sequence. A full-screen terminal crawl of (mostly real) project
// code with a little sci-fi flavour streams over startup.mp3; the music then
// fades and the main program lands with a clunk.
//
// The whole thing runs automatically. Audio autoplay may be blocked until the
// user has interacted with the page; if so the crawl still runs (silently)
// rather than waiting for a key press.

import { clunk } from "./sound";

type LineClass = "dim" | "ok" | "warn";
interface BootLine {
  t: string;
  c?: LineClass;
}

const PRE_ROLL_MS = 1000; // pause on the blinking cursor before the crawl begins
const REVEAL_MS = 5000; // time to stream the entire crawl
const HOLD_MS = 180; // brief beat on the last line before handoff
const FADE_MS = 750; // audio fade-out at the end
const STEP_PX = 30; // how far the view ratchets up per step on handoff
const STEP_MS = 40; // delay between steps — a stepped scroll, not a slide

// A mix of genuine lines lifted from the codebase and boot-log fluff.
const LINES: BootLine[] = [
  { t: "STEGANOS BIOS  v2.31   phosphor terminal", c: "dim" },
  { t: "(c) crypto division — covert channel subsystem", c: "dim" },
  { t: " " },
  { t: "[    0.000000] cold boot: power-on self test" },
  { t: "[    0.000914] cpu0: harvesting thermal entropy ...... 4096 bits", c: "ok" },
  { t: "[    0.003210] mounting /dev/carrier0 (image)" },
  { t: "[    0.003887] mounting /dev/carrier1 (text)" },
  { t: " " },
  { t: "loading core/header.ts", c: "dim" },
  { t: "  const MAGIC = 0x53544732; // 'STG2'" },
  { t: "  view.setUint32(0, header.magic, false);" },
  { t: "  view.setUint32(6, header.length, false);" },
  { t: "[    0.014402] header codec ..................... OK", c: "ok" },
  { t: " " },
  { t: "loading core/position.ts", c: "dim" },
  { t: "  hash = Math.imul(hash, 16777619) >>> 0;" },
  { t: "  [p[i], p[j]] = [p[j], p[i]]; // fisher-yates" },
  { t: "[    0.021755] password-seeded scatter ......... OK", c: "ok" },
  { t: " " },
  { t: "> calibrating carrier lattice ............ aligned" },
  { t: "> phase-conjugate mirrors ........... locked" },
  { t: "> spooling covert channel 0x7f .......... ready" },
  { t: " " },
  { t: "loading core/security.ts", c: "dim" },
  { t: "  pbkdf2(pw, salt, { iterations: 600000, hash: 'SHA-256' })" },
  { t: "  aes-256-gcm :: nonce = randomBytes(12)" },
  { t: "[    0.402913] key schedule derived ............ OK", c: "ok" },
  { t: " " },
  { t: "loading carriers/image.ts", c: "dim" },
  { t: "  pixel = (pixel & ~1) | bit; // LSB embed" },
  { t: "loading carriers/text.ts", c: "dim" },
  { t: "  out += ch + ZW[bit]; // U+200B / U+200C" },
  { t: " " },
  { t: "loading detection/chiSquare.ts", c: "dim" },
  { t: "  chi += (obs - exp) ** 2 / exp;" },
  { t: "[    0.518044] steganalysis suite .............. OK", c: "ok" },
  { t: " " },
  { t: "> engaging photonic scrambler .......... 100%" },
  { t: "> warming phosphor array ........... 3000K" },
  { t: "[    5.104881] entropy pool: HEALTHY", c: "ok" },
  { t: "[    5.271330] all subsystems nominal", c: "ok" },
  { t: " " },
  { t: "handoff to userspace ...", c: "dim" },
  { t: "STEGANOS READY.", c: "ok" },
];

// Reveal the crawl one line at a time, then invoke `onComplete`.
function streamLines(scroll: HTMLElement, onComplete: () => void): void {
  const interval = REVEAL_MS / LINES.length;
  let i = 0;
  const step = () => {
    if (i >= LINES.length) {
      onComplete();
      return;
    }
    const line = LINES[i++];
    const el = document.createElement("div");
    el.className = line.c ? `boot-line ${line.c}` : "boot-line";
    el.textContent = line.t.trim() === "" ? " " : line.t;
    scroll.appendChild(el);
    window.setTimeout(step, interval);
  };
  step();
}

// Ramp the element volume down to silence, then pause and report done.
function fadeAudio(audioEl: HTMLAudioElement, done: () => void): void {
  const steps = 24;
  const startVol = audioEl.volume;
  let i = 0;
  const id = window.setInterval(() => {
    i += 1;
    audioEl.volume = Math.max(0, startVol * (1 - i / steps));
    if (i >= steps) {
      window.clearInterval(id);
      audioEl.pause();
      done();
    }
  }, FADE_MS / steps);
}

// Ratchet the boot overlay up and off while the program is pushed up into view
// beneath it, one discrete step at a time — a stepped scroll rather than a
// smooth slide, as if fresh lines were shoving the screen upward.
function stepUp(root: HTMLElement, frame: HTMLElement | null, done: () => void): void {
  const total = window.innerHeight;
  root.style.transition = "none";
  if (frame) frame.style.transition = "none";
  let traveled = 0;
  const id = window.setInterval(() => {
    traveled = Math.min(total, traveled + STEP_PX);
    root.style.transform = `translateY(${-traveled}px)`;
    if (frame) frame.style.transform = `translateY(${total - traveled}px)`;
    if (traveled >= total) {
      window.clearInterval(id);
      done();
    }
  }, STEP_MS);
}

export function runBoot(onDone: () => void): void {
  const root = document.createElement("div");
  root.className = "boot";
  const scroll = document.createElement("div");
  scroll.className = "boot-scroll";
  const cursor = document.createElement("div");
  cursor.className = "boot-line boot-cursor";
  cursor.textContent = "█"; // █
  root.append(scroll, cursor);
  document.body.appendChild(root);

  // Stage the program (app window + assistant box) one screen below so the
  // whole thing can scroll up into view at the end rather than fading in.
  const stage = document.querySelector<HTMLElement>(".stage");
  if (stage) stage.style.transform = "translateY(100vh)";

  const audioEl = new Audio(`${import.meta.env.BASE_URL}startup.mp3`);
  audioEl.preload = "auto";
  audioEl.volume = 0.9;

  // Fade the music out, and scroll the boot log up and off while the program
  // is pushed up into view beneath it — as if the terminal kept printing and
  // the app is simply the next thing on screen.
  const finish = () => {
    fadeAudio(audioEl, () => {});
    stepUp(root, stage, () => {
      root.remove();
      if (stage) {
        stage.style.transition = "";
        stage.style.transform = "";
      }
      clunk();
      onDone();
    });
  };

  let started = false;
  const begin = () => {
    if (started) return;
    started = true;
    // Hold on the blinking cursor for a beat, then start the crawl.
    window.setTimeout(() => {
      streamLines(scroll, () => window.setTimeout(finish, HOLD_MS));
    }, PRE_ROLL_MS);
  };

  // Best-effort: start the music. Browsers may block autoplay until the user
  // has interacted with the page; if so the crawl still runs (silently) rather
  // than waiting for a key press.
  void audioEl.play().catch(() => {});
  begin();
}
