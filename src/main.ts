// Application layer. A keyboard-driven step wizard over the core
// modules. Contains no steganography logic of its own.
import { sfx, setSoundEnabled, isSoundEnabled } from "./app/sound";

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

type Operation = "hide" | "reveal" | "capacity" | "detect";
type Kind = "image" | "text";
type Step = "operation" | "carrier" | "cover" | "payload" | "secure" | "run";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const $ = <T extends HTMLElement>(id: string) =>
  document.querySelector(`#${id}`) as T;

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

function advance() {
  const seq = stepsFor(state.operation);
  const i = seq.indexOf(state.step);
  if (i < seq.length - 1) state.step = seq[i + 1];
  state.cursor = 0;
  state.error = "";
  render();
}

function back() {
  const seq = stepsFor(state.operation);
  const i = seq.indexOf(state.step);
  if (i > 0) state.step = seq[i - 1];
  state.cursor = 0;
  state.error = "";
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
  render();
}

async function fileToImage(file: File): Promise<RasterImage> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
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
    render();
  }
});

async function run() {
  state.busy = true;
  state.error = "";
  state.output = "";
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

function render() {
  renderBreadcrumb();
  const body = $("body");
  let html = "";
  let keys =
    "<b>↑/↓</b> move &nbsp;|&nbsp; <b>enter</b> select &nbsp;|&nbsp; <b>esc</b> back &nbsp;|&nbsp; <b>ctrl+r</b> restart";

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
  $("keys").innerHTML = keys;

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
  if (e.ctrlKey && e.key === "r") {
    e.preventDefault();
    return reset();
  }

  if (e.key === "Escape") {
    e.preventDefault();
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
    if (!confirm) return;
    e.preventDefault();

    if (field.id === "cover-input") state.coverText = field.value;
    if (field.id === "payload-input") state.payload = field.value;
    if (field.id === "pass-input") state.password = field.value;
    return advance();
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
    return render();
  }

  if (e.key === "ArrowUp") {
    e.preventDefault();
    state.cursor = (state.cursor - 1 + listLength) % listLength;
    return render();
  }

  if (e.key === "Enter") {
    e.preventDefault();

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
});

function tick() {
  $("clock").textContent = new Date().toLocaleTimeString("en-GB");
}
tick();
setInterval(tick, 1000);

render();