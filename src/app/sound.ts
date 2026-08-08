// Synthesised terminal beeps. No audio files: every sound is generated
// from an oscillator, which keeps the bundle small and matches the
// single-tone beeper real terminals actually had.

type Wave = OscillatorType;

let ctx: AudioContext | null = null;
let enabled = true;

// Browsers block audio until the user interacts with the page, so the
// context is created lazily on the first sound rather than at load.
function context(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

interface ToneOptions {
  freq: number;
  ms: number;
  wave?: Wave;
  volume?: number;
  delay?: number;
  slideTo?: number;
}

function tone({
  freq,
  ms,
  wave = "square",
  volume = 0.04,
  delay = 0,
  slideTo,
}: ToneOptions) {
  if (!enabled) return;

  const audio = context();
  const start = audio.currentTime + delay;
  const end = start + ms / 1000;

  const osc = audio.createOscillator();
  const gain = audio.createGain();

  osc.type = wave;
  osc.frequency.setValueAtTime(freq, start);

  if (slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(slideTo, end);
  }

  // Short attack and release. Without these the abrupt start and stop
  // produce an audible click on top of the intended tone.
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain).connect(audio.destination);
  osc.start(start);
  osc.stop(end + 0.01);
}

export const sfx = {
  // Cursor moving up or down a menu.
  move: () => tone({ freq: 1200, ms: 18, volume: 0.03 }),

  // Confirming a choice: a short rising two-note figure.
  select: () => {
    tone({ freq: 700, ms: 30 });
    tone({ freq: 1050, ms: 45, delay: 0.035 });
  },

  // Going back a step: the same figure inverted.
  back: () => {
    tone({ freq: 900, ms: 26, volume: 0.03 });
    tone({ freq: 620, ms: 38, delay: 0.03, volume: 0.03 });
  },

  // Typing into a field.
  key: () => tone({ freq: 2000, ms: 8, volume: 0.015 }),

  // Long operation started.
  working: () => tone({ freq: 400, ms: 90, wave: "sine", slideTo: 700 }),

  // Operation succeeded: rising three-note arpeggio.
  success: () => {
    tone({ freq: 660, ms: 55 });
    tone({ freq: 880, ms: 55, delay: 0.06 });
    tone({ freq: 1320, ms: 110, delay: 0.12 });
  },

  // Operation failed: low dissonant buzz. The two sawtooths sit 10Hz
  // apart, which produces an audible beating wobble.
  error: () => {
    tone({ freq: 180, ms: 140, wave: "sawtooth", volume: 0.05 });
    tone({ freq: 190, ms: 140, wave: "sawtooth", volume: 0.05 });
  },

  // Application start.
  boot: () => {
    tone({ freq: 300, ms: 70, wave: "sine", slideTo: 900, volume: 0.03 });
  },
};

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

export function isSoundEnabled() {
  return enabled;
}

// Create/resume the shared AudioContext from within a user gesture so every
// later synthesized sound (the boot clunk, the ambient bed, the UI beeps) is
// audible. Browsers keep audio suspended until the first interaction.
export function unlockAudio(): void {
  context();
}

// A heavy mechanical impact — a pitch-dropping low body plus a short contact
// transient — for the moment the program drops into place after boot.
export function clunk() {
  if (!enabled) return;
  const audio = context();
  const now = audio.currentTime;

  const osc = audio.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(120, now);
  osc.frequency.exponentialRampToValueAtTime(46, now + 0.18);
  const body = audio.createGain();
  body.gain.setValueAtTime(0.0001, now);
  body.gain.exponentialRampToValueAtTime(0.38, now + 0.006);
  body.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  osc.connect(body).connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.26);

  const len = Math.floor(audio.sampleRate * 0.03);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const lp = audio.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  const hit = audio.createGain();
  hit.gain.value = 0.22;
  src.connect(lp).connect(hit).connect(audio.destination);
  src.start(now);
  src.stop(now + 0.05);
}

// ---------------------------------------------------------------------------
// Ambient bed — a synthesized "machine room": fan motor, moving air, coil
// whine, and random processing chatter, layered through one master gain and
// sharing the single AudioContext. Toggled independently of the beeps above.

let ambianceOn = true;
try {
  const stored = localStorage.getItem("sfx-ambiance");
  if (stored !== null) ambianceOn = stored === "1";
} catch {
  // localStorage can throw in private mode — keep the default.
}

let ambientMaster: GainNode | null = null;
let ambientSources: AudioScheduledSourceNode[] = [];
let chatterTimer: number | null = null;
let ambientRunning = false;
let clickBuf: AudioBuffer | null = null;

export function isAmbianceOn(): boolean {
  return ambianceOn;
}

export function setAmbiance(on: boolean): void {
  ambianceOn = on;
  try {
    localStorage.setItem("sfx-ambiance", on ? "1" : "0");
  } catch {
    // Persistence is best-effort; ignore failures.
  }
  if (on) resumeAmbient();
  else stopAmbient();
}

// Start the bed if ambiance is enabled. Idempotent; safe to call from any
// keydown so the first user gesture unlocks the AudioContext.
export function resumeAmbient(): void {
  if (ambianceOn) startAmbient();
}

// Pink noise (Paul Kellet's approximation) — warmer and more air-like than
// white noise, and cheap to loop forever.
function pinkNoise(audio: AudioContext, seconds = 2): AudioBuffer {
  const length = Math.floor(audio.sampleRate * seconds);
  const buffer = audio.createBuffer(1, length, audio.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

function startAmbient(): void {
  if (ambientRunning) return;
  const audio = context();
  ambientRunning = true;

  const master = audio.createGain();
  master.gain.value = 0;
  master.connect(audio.destination);
  ambientMaster = master;

  // Fan motor: three low sines, slightly detuned so they beat into a throb.
  for (const [freq, level] of [[56, 0.32], [59, 0.28], [118, 0.12]] as const) {
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    const g = audio.createGain();
    g.gain.value = level;
    osc.connect(g).connect(master);
    osc.start();
    ambientSources.push(osc);
  }

  // Moving air: looping pink noise through a low-pass whose cutoff drifts.
  const air = audio.createBufferSource();
  air.buffer = pinkNoise(audio);
  air.loop = true;
  const airFilter = audio.createBiquadFilter();
  airFilter.type = "lowpass";
  airFilter.frequency.value = 620;
  airFilter.Q.value = 0.6;
  const airGain = audio.createGain();
  airGain.gain.value = 0.6;
  air.connect(airFilter).connect(airGain).connect(master);
  air.start();
  ambientSources.push(air);

  const airLfo = audio.createOscillator();
  airLfo.frequency.value = 0.08;
  const airLfoDepth = audio.createGain();
  airLfoDepth.gain.value = 180;
  airLfo.connect(airLfoDepth).connect(airFilter.frequency);
  airLfo.start();
  ambientSources.push(airLfo);

  // Coil whine: a faint, drifting high tone.
  const whine = audio.createOscillator();
  whine.type = "sine";
  whine.frequency.value = 9200;
  const whineGain = audio.createGain();
  whineGain.gain.value = 0.0015;
  whine.connect(whineGain).connect(master);
  whine.start();
  ambientSources.push(whine);

  const whineLfo = audio.createOscillator();
  whineLfo.frequency.value = 0.27;
  const whineLfoDepth = audio.createGain();
  whineLfoDepth.gain.value = 140;
  whineLfo.connect(whineLfoDepth).connect(whine.frequency);
  whineLfo.start();
  ambientSources.push(whineLfo);

  // Processing chatter: short band-passed noise ticks at random intervals.
  scheduleChatter(audio, master);

  const now = audio.currentTime;
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(0.06, now + 1.2);
}

function scheduleChatter(audio: AudioContext, dest: AudioNode): void {
  if (!clickBuf) {
    const len = Math.floor(audio.sampleRate * 0.03);
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    clickBuf = buf;
  }

  const tick = () => {
    if (!ambientRunning) return;
    const src = audio.createBufferSource();
    src.buffer = clickBuf;
    const bp = audio.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800 + Math.random() * 4200;
    bp.Q.value = 9;
    const g = audio.createGain();
    const now = audio.currentTime;
    const peak = 0.035 + Math.random() * 0.055;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    src.connect(bp).connect(g).connect(dest);
    src.start(now);
    src.stop(now + 0.05);
    chatterTimer = window.setTimeout(tick, 45 + Math.random() * 300);
  };

  chatterTimer = window.setTimeout(tick, 250);
}

function stopAmbient(): void {
  if (!ambientRunning) return;
  ambientRunning = false;

  if (chatterTimer !== null) {
    clearTimeout(chatterTimer);
    chatterTimer = null;
  }

  const audio = ctx;
  const master = ambientMaster;
  const sources = ambientSources;
  ambientMaster = null;
  ambientSources = [];

  if (audio && master) {
    const now = audio.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(0, now + 0.4);
  }

  window.setTimeout(() => {
    for (const src of sources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    try {
      master?.disconnect();
    } catch {
      // already disconnected
    }
  }, 500);
}