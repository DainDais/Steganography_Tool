import "./style.css";
import { encodeImage, decodeImage, capacity as imageCapacity } from "./carriers/image";
import { encodeText, decodeText, capacity as textCapacity } from "./carriers/text";
import { chiSquareLsb } from "./detection/chiSquare";
import { samplePairAnalysis } from "./detection/sampleAnalysis";
import type { RasterImage } from "./carriers/image";
import type { DetectionResult } from "./detection/chiSquare";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

function setStatus(el: HTMLElement, message: string, kind: "" | "ok" | "error" = "") {
  el.textContent = message;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---- tabs -------------------------------------------------------------

document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    for (const name of ["image", "text", "detect"]) {
      $(`panel-${name}`).hidden = name !== btn.dataset.tab;
    }
  });
});

// ---- shared image helpers --------------------------------------------

async function fileToImageData(file: File): Promise<RasterImage> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D drawing context");
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
}

function imageDataToPngUrl(image: RasterImage): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D drawing context");
  ctx.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error("Could not export the image"));
    }, "image/png");
  });
}

// ---- image panel ------------------------------------------------------

const imgFile = $<HTMLInputElement>("img-file");
const imgStatus = $("img-status");
const imgOutput = $("img-output");
let currentImage: RasterImage | null = null;

imgFile.addEventListener("change", async () => {
  const file = imgFile.files?.[0];
  if (!file) return;
  try {
    currentImage = await fileToImageData(file);
    $("img-capacity").textContent =
      `${currentImage.width}x${currentImage.height} — can hold about ${imageCapacity(currentImage)} bytes`;
    setStatus(imgStatus, "");
  } catch (err) {
    setStatus(imgStatus, String(err), "error");
  }
});

$("img-encode").addEventListener("click", async () => {
  if (!currentImage) return setStatus(imgStatus, "Choose an image first", "error");
  const secret = $<HTMLTextAreaElement>("img-secret").value;
  if (!secret) return setStatus(imgStatus, "Enter a message to hide", "error");

  const password = $<HTMLInputElement>("img-password").value || undefined;
  setStatus(imgStatus, "Working...");
  imgOutput.innerHTML = "";

  try {
    const stego = await encodeImage(
      currentImage,
      new TextEncoder().encode(secret),
      { password }
    );
    const url = await imageDataToPngUrl(stego);
    imgOutput.innerHTML = `
      <img src="${url}" alt="Result" />
      <a href="${url}" download="stego.png">Download PNG</a>`;
    setStatus(imgStatus, "Hidden. Save as PNG — JPEG would destroy the payload.", "ok");
  } catch (err) {
    setStatus(imgStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

$("img-decode").addEventListener("click", async () => {
  if (!currentImage) return setStatus(imgStatus, "Choose an image first", "error");
  const password = $<HTMLInputElement>("img-password").value || undefined;
  setStatus(imgStatus, "Working...");

  try {
    const bytes = await decodeImage(currentImage, { password });
    $<HTMLTextAreaElement>("img-secret").value = new TextDecoder().decode(bytes);
    setStatus(imgStatus, "Message recovered.", "ok");
  } catch (err) {
    setStatus(imgStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

// ---- text panel -------------------------------------------------------

const txtCover = $<HTMLTextAreaElement>("txt-cover");
const txtStatus = $("txt-status");
const txtResult = $<HTMLTextAreaElement>("txt-result");

function updateTextCapacity() {
  $("txt-capacity").textContent =
    `Can hold about ${textCapacity(txtCover.value)} bytes`;
}
txtCover.addEventListener("input", updateTextCapacity);
updateTextCapacity();

$("txt-encode").addEventListener("click", async () => {
  const secret = $<HTMLTextAreaElement>("txt-secret").value;
  if (!secret) return setStatus(txtStatus, "Enter a message to hide", "error");
  const password = $<HTMLInputElement>("txt-password").value || undefined;

  try {
    txtResult.value = await encodeText(
      txtCover.value,
      new TextEncoder().encode(secret),
      { password }
    );
    setStatus(txtStatus, "Hidden. Copy the result — it looks unchanged.", "ok");
  } catch (err) {
    setStatus(txtStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

$("txt-decode").addEventListener("click", async () => {
  const source = txtResult.value || txtCover.value;
  const password = $<HTMLInputElement>("txt-password").value || undefined;

  try {
    const bytes = await decodeText(source, { password });
    $<HTMLTextAreaElement>("txt-secret").value = new TextDecoder().decode(bytes);
    setStatus(txtStatus, "Message recovered.", "ok");
  } catch (err) {
    setStatus(txtStatus, err instanceof Error ? err.message : String(err), "error");
  }
});

// ---- detection panel --------------------------------------------------

function renderResult(name: string, result: DetectionResult): string {
  const pct = Math.round(result.score * 100);
  return `
    <div class="result-card">
      <h3>${name}: ${result.suspicious ? "suspicious" : "looks clean"}</h3>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="detail">score ${result.score.toFixed(3)} — ${result.detail}</div>
    </div>`;
}

$<HTMLInputElement>("det-file").addEventListener("change", async () => {
  const file = $<HTMLInputElement>("det-file").files?.[0];
  if (!file) return;
  const status = $("det-status");
  setStatus(status, "Analysing...");

  try {
    const image = await fileToImageData(file);
    $("det-results").innerHTML =
      renderResult("Chi-square", chiSquareLsb(image.data)) +
      renderResult("Sample pairs", samplePairAnalysis(image.data));
    setStatus(status, "Thresholds are provisional — see README.", "");
  } catch (err) {
    setStatus(status, String(err), "error");
  }
});