// Application layer. A keyboard-driven step wizard over the core
// modules. Contains no steganography logic of its own.

import {
  encodeImage,
  decodeImage,
  capacity as imageCapacity,
  type RasterImage,
} from "./carriers/image";
import {
  encodeText,
  decodeText,
  capacity as textCapacity,
} from "./carriers/text";
import { chiSquareLsb } from "./detection/chiSquare";
import { samplePairAnalysis } from "./detection/sampleAnalysis";
import {
  sfx,
  setSoundEnabled,
  isSoundEnabled,
  resumeAmbient,
  isAmbianceOn,
  setAmbiance,
} from "./app/sound";
import { runBoot } from "./app/boot";
type Operation = "hide" | "reveal" | "capacity" | "detect";
type Kind = "image" | "text";
type Step = "operation" | "carrier" | "cover" | "payload" | "secure" | "run";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const $ = <T extends HTMLElement>(id: string) =>
  document.querySelector(`#${id}`) as T;

// Input is ignored until the boot sequence hands off to the program.
let appReady = false;

const state = {
  step: "operation" as Step,
  cursor: 0,
  operation: null as Operation | null,
  carrier: null as Kind | null,
  coverImage: null as RasterImage | null,
  coverText: "",
  payload: "",
  password: "",
  output: "",
  error: "",
  busy: false,
  stego: null as RasterImage | null,
  stegoText: "",
};

// Which steps a given operation needs. Detect is image-only, so it
// skips the carrier choice entirely.
function stepsFor(op: Operation | null): Step[] {
  switch (op) {
    case "hide":
      return ["operation", "carrier", "cover", "payload", "secure", "run"];
    case "reveal":
      return ["operation", "carrier", "cover", "secure", "run"];
    case "capacity":
      return ["operation", "carrier", "cover", "run"];
    case "detect":
      return ["operation", "cover", "run"];
    default:
      return ["operation", "carrier", "cover", "payload", "secure", "run"];
  }
}

const OPERATIONS: { id: Operation; label: string; blurb: string }[] = [
  { id: "hide", label: "hide", blurb: "embed an encrypted payload inside a cover" },
  { id: "reveal", label: "reveal", blurb: "extract a hidden payload from a carrier" },
  { id: "capacity", label: "capacity", blurb: "measure how much a cover can hold" },
  { id: "detect", label: "detect", blurb: "run steganalysis against an image" },
];

const CARRIERS: { id: Kind; label: string; blurb: string }[] = [
  { id: "image", label: "image", blurb: "least significant bits of PNG or BMP pixels" },
  { id: "text", label: "text", blurb: "zero-width unicode between visible characters" },
];

// Explanatory copy for the assistant panel — a friendly, slightly overeager
// office-helper voice. Keyed by helper-text ID. Entries with a blank-line
// break carry a second, deeper paragraph that is only revealed on `?`.
const HELP: Record<string, string> = {
  hide: `It looks like you're trying to keep a secret! Hiding works in two moves: first your message gets scrambled into gibberish that only your password can unscramble, then that gibberish gets tucked into a cover file so nobody knows there's anything to unscramble in the first place. Encryption hides what you said. Steganography hides that you said anything. Doing both means someone has to notice the message exists before they can start failing to read it.`,

  reveal: `Reversing the trick! I'll walk through the cover file in the exact same order I originally wrote to, pull the bits back out, and check the first ten bytes for a little signature that says "yes, something's here." No signature means either there's nothing hidden or you've got the wrong password — and I genuinely can't tell you which, because with a wrong password I'm reading the right file in the wrong order. Same file, different treasure map.`,

  capacity: `Let's do some math before you get your hopes up! Every carrier has a hard ceiling on how much it can swallow. I'll measure yours and report back in bytes. Worth checking first, because "your message doesn't fit" is a much nicer thing to learn now than after you've written three paragraphs.`,

  detect: `Time to play the other side! Hiding data leaves statistical fingerprints, even when you can't see a thing with your eyes. I'll run two different tests looking for those traces. Fair warning: I'm looking for patterns, not certainties. I can tell you an image looks unusual. I can't tell you what's in it, or promise I'm right.`,

  "carrier.image": `Every pixel is three numbers — how red, how green, how blue, each from 0 to 255. Here's the fun part: changing 200 to 201 is a difference so small your eyes will never file a complaint. So I take the very last, least important bit of each color number and quietly overwrite it with a bit of your message. Three bits per pixel, invisible to you, perfectly readable to me. A modest photo can swallow a small novel this way.

One catch! JPEG files compress by throwing away details it thinks you won't miss — and those tiny bits are exactly the details it throws away. So: PNG or BMP only. JPEG will shred your message and cheerfully tell you nothing went wrong.`,

  "carrier.text": `Unicode contains characters that render as absolutely nothing. Not a space — genuinely zero pixels wide. I slip these between your visible letters, using one kind for a 0 and another for a 1, and your text looks completely untouched while quietly carrying a payload. Paste it into an email, a chat, a document; it travels as ordinary words.

The catch here is appetite. One character of cover per bit means eight characters of cover per byte of secret. You'll want several paragraphs to hide a sentence. Images are far roomier — but images can't be pasted into a text message, so pick your tradeoff.`,

  secure: `Two jobs, one password! First, it becomes an encryption key — though not directly, because "hunter2" makes a terrible key. I run it through 600,000 rounds of a stretching function, which is slow for you (a moment) and agonizing for anyone trying to guess their way in (a very long time). Second, it decides the order I visit hiding spots. Without a password I go straight through, start to finish — tidy, and a detector spots it immediately. With one, I scatter your bits across the whole file in an order only your password can reproduce.

Leave it blank and you get the deliberately weak version. That mode exists so you can watch the detection tools catch it.`,

  "encryption.detail": `The cipher is AES-256 in GCM mode, which is the same family of math protecting your bank login. GCM's party trick is that it doesn't just scramble your message, it seals it — flip a single bit anywhere in the hidden data and decryption fails outright instead of handing you convincing-looking nonsense. Loud failure beats quiet corruption every time.

I also mix in fresh randomness on every single run, so encrypting the same message twice with the same password produces two completely different results. Nobody gets to notice you sent the same thing twice.`,

  "detection.chiSquare": `Here's a lovely quirk: hiding data by flipping last bits can only ever swap 100 with 101, or 202 with 203 — it can never nudge a value across those pair boundaries. So the total for each pair stays put while the split between the two members drifts toward an even 50/50. Real photographs are lumpy and uneven. Fifty-fifty everywhere is unnatural. I count up all 128 pairs and measure how suspiciously balanced things look.`,

  "detection.samplePair": `A second opinion, using a completely different angle! This one ignores the big picture and looks at neighbors. In an untouched photo, side-by-side pixels within the same pair are usually identical — smooth gradients, gentle transitions. After hiding, that neighborliness breaks down into a coin-flip. Two tests agreeing is real evidence. Two tests disagreeing is interesting in its own right, which is why I run both.`,

  "detection.caveat": `Full honesty: the line between "fine" and "suspicious" was worked out on paper, not calibrated against a pile of real photographs. Treat it as a nudge, not a verdict. There's also a genuine limit here — the less of a file you fill, the quieter the fingerprint. A short note in a large photo may be effectively invisible to these tests. That's not a bug in the detector; it's the fundamental shape of the problem.`,
};

// Whether the assistant's deeper (`?`) note is currently expanded.
let helpExpanded = false;

function helpParas(text: string): string[] {
  return text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
}

// Resolve the helper copy for the current step: a `body` shown by default and
// an optional `more` block revealed on `?`. Steps with no copy return null.
function helperFor(): { body: string[]; more: string[] } | null {
  switch (state.step) {
    case "operation": {
      const op = OPERATIONS[state.cursor]?.id;
      return op ? { body: helpParas(HELP[op]), more: [] } : null;
    }
    case "carrier": {
      const p = helpParas(HELP[`carrier.${CARRIERS[state.cursor]?.id ?? "image"}`]);
      return { body: p.slice(0, 1), more: p.slice(1) };
    }
    case "cover": {
      const p = helpParas(HELP[`carrier.${state.carrier ?? "image"}`]);
      return { body: p.slice(0, 1), more: p.slice(1) };
    }
    case "secure":
      return { body: helpParas(HELP.secure), more: helpParas(HELP["encryption.detail"]) };
    case "run":
      if (state.operation === "detect") {
        return {
          body: [
            ...helpParas(HELP["detection.chiSquare"]),
            ...helpParas(HELP["detection.samplePair"]),
          ],
          more: helpParas(HELP["detection.caveat"]),
        };
      }
      return state.operation ? { body: helpParas(HELP[state.operation]), more: [] } : null;
    default:
      return null; // payload has no helper copy
  }
}

function advance() {
  const seq = stepsFor(state.operation);
  const i = seq.indexOf(state.step);
  if (i < seq.length - 1) state.step = seq[i + 1];
  state.cursor = 0;
  state.error = "";
  // Drop any previous run's result so the run step shows "execute" again
  // instead of a stale message (e.g. a hide's confirmation during a reveal).
  state.output = "";
  state.stego = null;
  state.stegoText = "";
  helpExpanded = false;
  render();
}

function back() {
  const seq = stepsFor(state.operation);
  const i = seq.indexOf(state.step);
  if (i > 0) state.step = seq[i - 1];
  state.cursor = 0;
  state.error = "";
  // Drop any previous run's result so the run step shows "execute" again
  // instead of a stale message (e.g. a hide's confirmation during a reveal).
  state.output = "";
  state.stego = null;
  state.stegoText = "";
  helpExpanded = false;
  render();
}

function reset() {
  Object.assign(state, {
    step: "operation" as Step,
    cursor: 0,
    operation: null,
    carrier: null,
    coverImage: null,
    coverText: "",
    payload: "",
    password: "",
    output: "",
    error: "",
    busy: false,
    stego: null,
    stegoText: "",
  });
  helpExpanded = false;
  render();
}

async function fileToImage(file: File): Promise<RasterImage> {
  // LSB steganography needs the pixel bytes to survive a PNG save and reload
  // unchanged. Two browser behaviours quietly corrupt the low bits, so both
  // are switched off here:
  //   • colour management — the loaded cover may carry an ICC/gamma profile
  //     the exported stego PNG won't, which shifts RGB between hide and reveal;
  //   • alpha premultiplication — rounds the colour channels of any pixel that
  //     is not fully opaque.
  const bitmap = await createImageBitmap(file, {
    premultiplyAlpha: "none",
    colorSpaceConversion: "none",
  });
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

  // Flatten to fully opaque so the exported stego PNG reloads bit-for-bit.
  // The payload only ever lives in the RGB channels, so alpha is free to set.
  const data = image.data;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  return image;
}

function pickFile() {
  const input = $<HTMLInputElement>("file-input");
  input.value = "";
  input.click();
}

$<HTMLInputElement>("file-input").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    state.coverImage = await fileToImage(file);
    state.error = "";
    advance();
  } catch (err) {
    state.error = `could not read image: ${(err as Error).message}`;
    sfx.error();
    render();
  }
});

async function run() {
  state.busy = true;
  state.error = "";
  state.output = "";
  sfx.working();
  render();

  const password = state.password || undefined;

  try {
    if (state.operation === "capacity") {
      state.output =
        state.carrier === "image"
          ? `${imageCapacity(state.coverImage!)} bytes available`
          : `${textCapacity(state.coverText)} bytes available`;
    } else if (state.operation === "detect") {
      state.output = "detect";
    } else if (state.operation === "hide") {
      if (state.carrier === "image") {
        state.stego = await encodeImage(state.coverImage!, enc(state.payload), { password });
        state.output = "payload embedded";
      } else {
        state.stegoText = await encodeText(state.coverText, enc(state.payload), { password });
        state.output = "payload embedded";
      }
    } else if (state.operation === "reveal") {
      const bytes =
        state.carrier === "image"
          ? await decodeImage(state.coverImage!, { password })
          : await decodeText(state.coverText, { password });
      state.output = dec(bytes);
    }
  } catch (err) {
    state.error = (err as Error).message;
  }

  state.busy = false;
  if (state.error) sfx.error();
  else sfx.success();
  render();
}

function renderBreadcrumb() {
  const seq = stepsFor(state.operation);
  const here = seq.indexOf(state.step);
  $("breadcrumb").innerHTML = seq
    .map((s, i) => {
      const cls = i === here ? "here" : i < here ? "done" : "";
      return `<span class="crumb ${cls}">${s}</span>`;
    })
    .join(`<span class="sep">—</span>`);
}

function menu(prompt: string, items: { label: string; blurb: string }[]) {
  return `
    <div class="prompt">${prompt}</div>
    <ul class="menu">
      ${items
        .map((it, i) => `<li class="${i === state.cursor ? "sel" : ""}">${it.label}</li>`)
        .join("")}
    </ul>
    <p class="hint">${items[state.cursor]?.blurb ?? ""}</p>
  `;
}

function detectionMarkup(image: RasterImage) {
  const checks = [
    { name: "chi-square / pairs of values", r: chiSquareLsb(image.data) },
    { name: "sample pair analysis", r: samplePairAnalysis(image.data) },
  ];
  return checks
    .map(
      ({ name, r }) => `
      <div class="gauge">
        <h3>${name}</h3>
        <div class="bar ${r.suspicious ? "high" : ""}">
          <span style="width:${(r.score * 100).toFixed(0)}%"></span>
        </div>
        <p class="meta">score ${r.score.toFixed(3)} — ${r.detail}${
        r.suspicious ? " — SUSPICIOUS" : ""
      }</p>
      </div>`
    )
    .join("");
}

// Turn the ambient bed on or off. Independent of the ctrl+m beep mute; the
// select blip here is just feedback for the press.
function toggleAmbiance() {
  setAmbiance(!isAmbianceOn());
  sfx.select();
  render();
}

// Update only Clippy's dialogue. He and his box are permanent in the markup,
// so switching steps never re-creates the mascot or reflows the app frame.
function renderAssistant(help: { body: string[]; more: string[] } | null) {
  const bubble = $("assistant-body");
  if (!help) {
    bubble.innerHTML = `<p>All set — I'm right here whenever you need me.</p>`;
    return;
  }
  const main = help.body.map((p) => `<p>${p}</p>`).join("");
  const extra =
    helpExpanded && help.more.length > 0
      ? `<div class="assistant-extra">${help.more.map((p) => `<p>${p}</p>`).join("")}</div>`
      : "";
  bubble.innerHTML = `${main}${extra}`;
}

function render() {
  renderBreadcrumb();
  const body = $("body");
  let html = "";
  const mute = isSoundEnabled() ? "mute" : "unmute";
  let keys =
    `<b>↑/↓</b> move &nbsp;|&nbsp; <b>enter</b> select &nbsp;|&nbsp; <b>esc</b> back &nbsp;|&nbsp; <b>ctrl+r</b> restart &nbsp;|&nbsp; <b>ctrl+m</b> ${mute}`;

  switch (state.step) {
    case "operation":
      html = menu("choose an operation", OPERATIONS);
      break;

    case "carrier":
      html = menu("choose a carrier", CARRIERS);
      break;

    case "cover":
      if (state.carrier === "text" && state.operation !== "detect") {
        html = `
          <div class="prompt">paste the cover text</div>
          <p class="hint">needs at least 79 visible characters before it can hold a single byte</p>
          <textarea class="field" id="cover-input" rows="8">${state.coverText}</textarea>
        `;
        keys = "<b>ctrl+enter</b> confirm &nbsp;|&nbsp; <b>esc</b> back";
      } else {
        html = `
          <div class="prompt">select a carrier file</div>
          <p class="hint">png or bmp only — jpeg compression destroys embedded bits</p>
          <ul class="menu"><li class="sel">open file picker</li></ul>
          ${state.coverImage ? `<p class="hint">loaded ${state.coverImage.width}×${state.coverImage.height}</p>` : ""}
        `;
      }
      break;

    case "payload":
      html = `
        <div class="prompt">enter the secret message</div>
        <textarea class="field" id="payload-input" rows="6">${state.payload}</textarea>
      `;
      keys = "<b>ctrl+enter</b> confirm &nbsp;|&nbsp; <b>esc</b> back";
      break;

    case "secure":
      html = `
        <div class="prompt">password</div>
        <p class="hint">optional — leave blank for sequential, unencrypted embedding</p>
        <input type="password" class="field" id="pass-input" value="${state.password}" />
      `;
      keys = "<b>enter</b> confirm &nbsp;|&nbsp; <b>esc</b> back";
      break;

    case "run":
      if (state.busy) {
        html = `<div class="prompt">working…</div><p class="hint">deriving key — 600,000 pbkdf2 iterations</p>`;
      } else if (!state.output && !state.error) {
        html = `
          <div class="prompt">ready</div>
          <p class="hint">${state.operation} · ${state.carrier ?? "image"}</p>
          <ul class="menu"><li class="sel">execute</li></ul>
        `;
      } else if (state.error) {
        html = `<div class="prompt err">failed</div><p class="out err">${state.error}</p>`;
        keys = "<b>esc</b> back &nbsp;|&nbsp; <b>ctrl+r</b> restart";
      } else if (state.operation === "detect") {
        html = `<div class="prompt">analysis</div>${detectionMarkup(state.coverImage!)}`;
        keys = "<b>ctrl+r</b> restart";
      } else if (state.operation === "hide" && state.carrier === "image") {
        html = `<div class="prompt ok">embedded</div><canvas id="preview"></canvas><a class="dl" id="dl" download="stego.png">download stego.png</a>`;
        keys = "<b>ctrl+r</b> restart";
      } else if (state.operation === "hide") {
        html = `<div class="prompt ok">embedded</div><p class="hint">select all and copy — the payload is invisible</p><textarea class="field" rows="8" id="stego-out">${state.stegoText}</textarea>`;
        keys = "<b>ctrl+r</b> restart";
      } else {
        html = `<div class="prompt ok">${state.operation === "capacity" ? "capacity" : "revealed"}</div><p class="out">${state.output}</p>`;
        keys = "<b>ctrl+r</b> restart";
      }
      break;
  }

  body.innerHTML = html;

  const help = helperFor();
  const moreHint =
    help && help.more.length > 0
      ? ` &nbsp;|&nbsp; <b>?</b> ${helpExpanded ? "less" : "more"}`
      : "";
  const ambiance =
    ` &nbsp;|&nbsp; <span class="toggle" id="ambiance-toggle" role="button" title="ambient hum on/off (a)">` +
    `<b>a</b> ambiance ${isAmbianceOn() ? "on" : "off"}</span>`;
  $("keys").innerHTML = `${keys}${ambiance}${moreHint}`;
  const ambianceBtn = document.querySelector<HTMLElement>("#ambiance-toggle");
  if (ambianceBtn) ambianceBtn.onclick = toggleAmbiance;
  renderAssistant(help);

  const preview = document.querySelector<HTMLCanvasElement>("#preview");
  if (preview && state.stego) {
    preview.width = state.stego.width;
    preview.height = state.stego.height;
    preview
      .getContext("2d")!
      .putImageData(
        new ImageData(state.stego.data, state.stego.width, state.stego.height),
        0,
        0
      );
    $<HTMLAnchorElement>("dl").href = preview.toDataURL("image/png");
  }

  document.querySelector<HTMLTextAreaElement>("#cover-input")?.focus();
  document.querySelector<HTMLTextAreaElement>("#payload-input")?.focus();
  document.querySelector<HTMLInputElement>("#pass-input")?.focus();
}

document.addEventListener("keydown", (e) => {
  // Swallow everything while the boot sequence is still on screen.
  if (!appReady) return;

  // The first keystroke is a user gesture, which the browser needs before the
  // ambient AudioContext will produce sound.
  resumeAmbient();

  if (e.ctrlKey && e.key === "m") {
    e.preventDefault();
    setSoundEnabled(!isSoundEnabled());
    if (isSoundEnabled()) sfx.select();
    return render();
  }

  if (e.ctrlKey && e.key === "r") {
    e.preventDefault();
    sfx.back();
    return reset();
  }

  if (e.key === "Escape") {
    e.preventDefault();
    sfx.back();
    return back();
  }

  const field = document.querySelector<HTMLTextAreaElement>(
    "#cover-input, #payload-input, #pass-input"
  );

  if (field) {
    const confirm =
      field.id === "pass-input"
        ? e.key === "Enter"
        : e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (!confirm) {
      if (e.key.length === 1) sfx.key();
      return;
    }
    e.preventDefault();
    sfx.select();

    if (field.id === "cover-input") state.coverText = field.value;
    if (field.id === "payload-input") state.payload = field.value;
    if (field.id === "pass-input") state.password = field.value;
    return advance();
  }

  // Toggle the assistant's deeper note, on steps that have one.
  if (e.key === "?") {
    e.preventDefault();
    const help = helperFor();
    if (help && help.more.length > 0) {
      helpExpanded = !helpExpanded;
      sfx.select();
      render();
    }
    return;
  }

  // Toggle the ambient bed. The beeps are left alone.
  if ((e.key === "a" || e.key === "A") && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    return toggleAmbiance();
  }

  const listLength =
    state.step === "operation"
      ? OPERATIONS.length
      : state.step === "carrier"
      ? CARRIERS.length
      : 1;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    state.cursor = (state.cursor + 1) % listLength;
    helpExpanded = false;
    sfx.move();
    return render();
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    state.cursor = (state.cursor - 1 + listLength) % listLength;
    helpExpanded = false;
    sfx.move();
    return render();
  }

  if (e.key === "Enter") {
    e.preventDefault();
    return activateSelection();
  }
});

// Confirm the highlighted menu option — shared by Enter and mouse clicks.
function activateSelection() {
  sfx.select();
  if (state.step === "operation") {
    state.operation = OPERATIONS[state.cursor].id;
    if (state.operation === "detect") state.carrier = "image";
    return advance();
  }
  if (state.step === "carrier") {
    state.carrier = CARRIERS[state.cursor].id;
    return advance();
  }
  if (state.step === "cover") return pickFile();
  if (state.step === "run" && !state.output && !state.error) return run();
}

// Mouse support for the menus: hovering an option highlights it (with the move
// beep) and clicking it selects it (with the select beep). Only menu steps
// render a <ul class="menu">, so this is inert on the input/result steps.
function menuIndexFromEvent(e: MouseEvent): number | null {
  const li = (e.target as HTMLElement | null)?.closest("#body .menu li");
  if (!li || !li.parentElement) return null;
  return Array.from(li.parentElement.children).indexOf(li);
}

document.addEventListener("mouseover", (e) => {
  if (!appReady) return;
  const i = menuIndexFromEvent(e);
  if (i === null || i === state.cursor) return;
  state.cursor = i;
  helpExpanded = false;
  sfx.move();
  // Update the highlight, blurb and assistant copy in place. Rebuilding #body
  // here would replace the <li> mid-click and swallow the following click.
  document
    .querySelectorAll("#body .menu li")
    .forEach((li, idx) => li.classList.toggle("sel", idx === i));
  const list =
    state.step === "operation" ? OPERATIONS : state.step === "carrier" ? CARRIERS : null;
  const hint = document.querySelector("#body .hint");
  if (hint && list) hint.textContent = list[i]?.blurb ?? "";
  renderAssistant(helperFor());
});

document.addEventListener("click", (e) => {
  if (!appReady) return;
  const i = menuIndexFromEvent(e);
  if (i === null) return;
  resumeAmbient();
  state.cursor = i;
  activateSelection();
});

// Disable mouse-wheel scrolling of the page; elements that scroll their own
// content (textareas, the output box) keep working.
window.addEventListener(
  "wheel",
  (e) => {
    let el = e.target as HTMLElement | null;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) return;
      el = el.parentElement;
    }
    e.preventDefault();
  },
  { passive: false }
);

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString("en-GB");
}
tick();
setInterval(tick, 1000);

// Render the program underneath, then run the boot overlay on top. When the
// music has faded and the clunk has landed, hand control to the user.
render();
runBoot(() => {
  appReady = true;
  resumeAmbient();
});