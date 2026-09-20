// Camera, frame pump, and result handling.

import { MAX_CODES, PairingPolicy } from "./policy.js";
import { createAxisHint } from "./orientation.js";

// Dense codes on a curved label need the resolution: on the reference
// photographs 720 loses one bottle entirely, 1080 reads all five, and 1440
// costs more for nothing.
const PROCESS_MAX = 1080;
const HISTORY_KEY = "qr-scan-history";
const HISTORY_MAX = 50;
// No decode has come back in this long: something is wedged.
const STALL_MS = 4000;
const PERSISTENT_ERRORS = 8;

const els = {
  video: document.getElementById("video"),
  overlay: document.getElementById("overlay"),
  start: document.getElementById("start"),
  stop: document.getElementById("stop"),
  flip: document.getElementById("flip"),
  torch: document.getElementById("torch"),
  photo: document.getElementById("photo"),
  photoInput: document.getElementById("photo-input"),
  status: document.getElementById("status"),
  results: document.getElementById("results"),
  history: document.getElementById("history"),
  historyPanel: document.getElementById("history-panel"),
  clearHistory: document.getElementById("clear-history"),
};

const frameCanvas = document.createElement("canvas");
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });
const overlayCtx = els.overlay.getContext("2d");
const policy = new PairingPolicy();
const axisHint = createAxisHint();

let worker = null;
let stream = null;
let scanning = false;
let facingMode = "environment";
let pendingFrame = false;
let frameSeq = 0;
let settleTimer = null;
let watchdog = null;
let lastResultAt = 0;
let resultsSeen = 0;
let lastScale = { x: 1, y: 1 };

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.className = `status ${kind}`;
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./decode-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type !== "result") return;
    pendingFrame = false;
    lastResultAt = performance.now();
    resultsSeen++;

    // Decoder trouble belongs on screen: an installed PWA has no console.
    if (msg.errorCount >= PERSISTENT_ERRORS) {
      stopScan();
      setStatus(`Decoder keeps failing: ${msg.error ?? "unknown error"}`, "error");
      return;
    }
    if (msg.error) setStatus(`Decode error: ${msg.error}`, "error");

    handleFrame(msg.results, msg.winners);
  };
  worker.onerror = (err) => {
    setStatus(`Decoder failed to start: ${err?.message ?? "unknown error"}`, "error");
    stopScan();
  };
  worker.onmessageerror = () => {
    setStatus("Decoder sent an unreadable message.", "error");
    pendingFrame = false;
  };
  return worker;
}

async function startScan() {
  if (scanning) return;
  clearResults();
  policy.reset();
  setStatus("Starting camera…");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode,
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        focusMode: "continuous",
      },
      audio: false,
    });
  } catch (err) {
    setStatus(cameraError(err), "error");
    return;
  }

  els.video.srcObject = stream;
  await els.video.play();
  scanning = true;
  resultsSeen = 0;
  getWorker().postMessage({ type: "reset" });
  document.body.classList.add("scanning");
  setStatus("Point at the codes… curved labels take a moment.");
  updateTorchButton();
  startWatchdog();
  pump();
}

function cameraError(err) {
  if (err?.name === "NotAllowedError") return "Camera permission denied. Allow it in your browser settings.";
  if (err?.name === "NotFoundError") return "No camera found on this device.";
  if (err?.name === "NotReadableError") return "Camera is busy in another app. Close it and try again.";
  if (!window.isSecureContext) return "Camera needs HTTPS. Open the GitHub Pages URL, not a file:// path.";
  return `Could not start camera: ${err?.message ?? err}`;
}

function stopScan() {
  scanning = false;
  pendingFrame = false;
  document.body.classList.remove("scanning");
  if (stream) {
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }
  els.video.srcObject = null;
  overlayCtx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  clearTimeout(settleTimer);
  settleTimer = null;
  clearInterval(watchdog);
  watchdog = null;
}

// The app has no other way to notice that it has silently stopped working:
// a wedged frame, a dead pump and a decoder that never loaded all look
// identical from here — nothing arrives.
function startWatchdog() {
  lastResultAt = performance.now();
  clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (!scanning || performance.now() - lastResultAt < STALL_MS) return;
    if (resultsSeen === 0) {
      setStatus("Decoder is not responding. It may have failed to load — try reloading.", "error");
    } else {
      setStatus("Scanner stalled, restarting…", "error");
    }
    lastResultAt = performance.now();
    pendingFrame = false; // release a frame that never came back
    pump(); // restart the loop if it died
  }, 1000);
}

function pump() {
  if (!scanning) return;
  const next = () => {
    if (!scanning) return;
    if ("requestVideoFrameCallback" in els.video) {
      els.video.requestVideoFrameCallback(pump);
    } else {
      requestAnimationFrame(pump);
    }
  };

  // Whatever happens below, the loop has to schedule its own next turn or the
  // scanner dies without a sound.
  try {
    if (pendingFrame || els.video.readyState < 2) return;

    const vw = els.video.videoWidth;
    const vh = els.video.videoHeight;
    if (!vw || !vh) return;

    const scale = Math.min(1, PROCESS_MAX / Math.max(vw, vh));
    const w = Math.round(vw * scale);
    const h = Math.round(vh * scale);
    if (frameCanvas.width !== w || frameCanvas.height !== h) {
      frameCanvas.width = w;
      frameCanvas.height = h;
    }
    frameCtx.drawImage(els.video, 0, 0, w, h);
    const image = frameCtx.getImageData(0, 0, w, h);
    lastScale = { x: vw / w, y: vh / h };

    pendingFrame = true;
    getWorker().postMessage(
      {
        type: "frame",
        id: ++frameSeq,
        buffer: image.data.buffer,
        width: w,
        height: h,
        axisHint: axisHint.get(),
      },
      [image.data.buffer],
    );
  } catch (err) {
    pendingFrame = false;
    setStatus(`Frame capture failed: ${err?.message ?? err}`, "error");
  } finally {
    next();
  }
}

function handleFrame(results, winners) {
  if (!scanning) return;
  drawOverlay(results);

  const decision = policy.offer(results, winners);
  if (decision.action === "accept") {
    clearTimeout(settleTimer);
    settleTimer = null;
    accept(decision.results, decision.candidates);
    return;
  }
  if (decision.action === "wait" && !settleTimer) {
    setStatus("Found one — checking for a second…");
    settleTimer = setTimeout(() => {
      settleTimer = null;
      const settled = policy.expire();
      if (scanning && settled.action === "accept") accept(settled.results, settled.candidates);
    }, decision.waitMs);
  }
}

function accept(results, candidates) {
  stopScan();
  if (navigator.vibrate) navigator.vibrate(results.length >= MAX_CODES ? [40, 60, 40] : 40);
  renderResults(results, candidates);
  addHistory(results);
  setStatus(results.length >= MAX_CODES ? "Two codes captured in one frame." : "One code captured.", "ok");
}

function drawOverlay(results) {
  const rect = els.video.getBoundingClientRect();
  if (els.overlay.width !== rect.width || els.overlay.height !== rect.height) {
    els.overlay.width = rect.width;
    els.overlay.height = rect.height;
  }
  overlayCtx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  if (!results.length) return;

  // Map decoder coordinates onto the displayed video box (object-fit: cover).
  const vw = els.video.videoWidth;
  const vh = els.video.videoHeight;
  const coverScale = Math.max(rect.width / vw, rect.height / vh);
  const offsetX = (rect.width - vw * coverScale) / 2;
  const offsetY = (rect.height - vh * coverScale) / 2;

  overlayCtx.lineWidth = 3;
  overlayCtx.strokeStyle = "#39d98a";
  overlayCtx.fillStyle = "rgba(57, 217, 138, 0.15)";
  for (const r of results) {
    overlayCtx.beginPath();
    r.corners.forEach((pt, i) => {
      const x = pt.x * lastScale.x * coverScale + offsetX;
      const y = pt.y * lastScale.y * coverScale + offsetY;
      if (i === 0) overlayCtx.moveTo(x, y);
      else overlayCtx.lineTo(x, y);
    });
    overlayCtx.closePath();
    overlayCtx.fill();
    overlayCtx.stroke();
  }
}

function clearResults() {
  els.results.innerHTML = "";
}

function renderResults(results, candidates) {
  clearResults();
  const dewarped = Array.isArray(candidates) && candidates.some((c) => c?.theta > 0);
  results.forEach((r, i) => {
    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "card-head";
    head.innerHTML = `<span class="tag">Code ${i + 1}</span><span class="meta">${escapeHtml(r.format)}${
      dewarped ? " · dewarped" : ""
    }</span>`;

    const body = document.createElement("div");
    body.className = "payload";
    body.textContent = r.text;

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.append(copyButton(r.text));
    if (isUrl(r.text)) {
      const link = document.createElement("a");
      link.href = r.text;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "btn ghost";
      link.textContent = "Open link";
      actions.append(link);
    }

    card.append(head, body, actions);
    els.results.append(card);
  });
}

function copyButton(text) {
  const btn = document.createElement("button");
  btn.className = "btn ghost";
  btn.textContent = "Copy";
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Copied";
    } catch {
      btn.textContent = "Copy failed";
    }
    setTimeout(() => (btn.textContent = "Copy"), 1200);
  });
  return btn;
}

function isUrl(text) {
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function addHistory(results) {
  const entry = { at: Date.now(), codes: results.map((r) => r.text) };
  const list = [entry, ...loadHistory()].slice(0, HISTORY_MAX);
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked; history is best-effort */
  }
  renderHistory();
}

function renderHistory() {
  const list = loadHistory();
  els.history.innerHTML = "";
  els.historyPanel.hidden = list.length === 0;
  for (const entry of list) {
    const row = document.createElement("li");
    const when = new Date(entry.at).toLocaleString();
    const codes = document.createElement("div");
    codes.className = "history-codes";
    for (const code of entry.codes) {
      const line = document.createElement("div");
      line.className = "history-code";
      line.textContent = code;
      codes.append(line);
    }
    const time = document.createElement("time");
    time.textContent = when;
    row.append(codes, time);
    els.history.append(row);
  }
}

async function scanPhoto(file) {
  stopScan();
  clearResults();
  setStatus("Scanning image…");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PROCESS_MAX / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  frameCanvas.width = w;
  frameCanvas.height = h;
  frameCtx.drawImage(bitmap, 0, 0, w, h);
  const image = frameCtx.getImageData(0, 0, w, h);
  bitmap.close();

  const { sweepFrame, toGray } = await import("./pipeline.js");
  const { results, winners } = await sweepFrame(toGray(image.data, w, h), w, h);
  if (!results.length) {
    setStatus("No QR code found in that image.", "error");
    return;
  }
  renderResults(results, winners);
  addHistory(results);
  setStatus(results.length >= MAX_CODES ? "Two codes found in the image." : "One code found in the image.", "ok");
}

function updateTorchButton() {
  const track = stream?.getVideoTracks?.()[0];
  const capable = Boolean(track?.getCapabilities?.().torch);
  els.torch.hidden = !capable;
  els.torch.setAttribute("aria-pressed", "false");
}

async function toggleTorch() {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;
  const on = els.torch.getAttribute("aria-pressed") === "true";
  try {
    await track.applyConstraints({ advanced: [{ torch: !on }] });
    els.torch.setAttribute("aria-pressed", String(!on));
  } catch {
    els.torch.hidden = true;
  }
}

els.start.addEventListener("click", startScan);
els.stop.addEventListener("click", () => {
  stopScan();
  setStatus("Stopped.");
});
els.flip.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  if (scanning) {
    stopScan();
    await startScan();
  }
});
els.torch.addEventListener("click", toggleTorch);
els.photo.addEventListener("click", () => els.photoInput.click());
els.photoInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) scanPhoto(file).catch((err) => setStatus(`Image scan failed: ${err.message}`, "error"));
  e.target.value = "";
});
els.clearHistory.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

renderHistory();
setStatus("Ready. Tap Scan to start.");

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type !== "precache-failed") return;
    const names = e.data.failures.map((f) => f.asset).join(", ");
    setStatus(`Offline cache incomplete — will not work offline. Failed: ${names}`, "error");
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(new URL("./sw.js", import.meta.url)).catch((err) => {
      if (!scanning) setStatus(`Offline support unavailable: ${err?.message ?? err}`, "error");
    });
  });
}
