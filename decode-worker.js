// Scanner worker: keeps the dewarp sweep off the UI thread.
//
// The frame budget only allows a couple of decodes, so instead of trying all
// 19 dewarp candidates every frame we try two: the one that last worked (the
// flat pass, until something else proves better) and the next one in a rolling
// cycle. A whole sweep therefore completes in well under a second of handheld
// video, and once a curvature locks on it is re-tried first on every frame.

import { CANDIDATES, decodeWithCandidate, toGray } from "./pipeline.js";

const ATTEMPTS_PER_FRAME = 2;
const FORGET_AFTER_EMPTY_FRAMES = 45;

let preferred = 0;
let cycle = 0;
let emptyStreak = 0;
let scratch = null;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "reset") {
    preferred = 0;
    cycle = 0;
    emptyStreak = 0;
    return;
  }
  if (msg.type !== "frame") return;

  const { id, buffer, width, height } = msg;
  const started = performance.now();
  const gray = toGray(new Uint8ClampedArray(buffer), width, height);
  if (!scratch || scratch.length !== width * height * 4) {
    scratch = new Uint8ClampedArray(width * height * 4);
  }

  const tried = new Set();
  let best = [];
  let bestIndex = preferred;

  for (let n = 0; n < ATTEMPTS_PER_FRAME; n++) {
    const index = n === 0 ? preferred : nextCycleIndex(tried);
    if (tried.has(index)) continue;
    tried.add(index);

    let found = [];
    try {
      found = await decodeWithCandidate(gray, width, height, CANDIDATES[index], scratch);
    } catch (err) {
      self.postMessage({ type: "error", message: String(err?.message ?? err) });
    }
    if (found.length > best.length) {
      best = found;
      bestIndex = index;
    }
    if (best.length >= 2) break; // a single frame carrying both codes: done
  }

  if (best.length > 0) {
    preferred = bestIndex;
    emptyStreak = 0;
  } else if (++emptyStreak > FORGET_AFTER_EMPTY_FRAMES) {
    preferred = 0; // scene changed; fall back to assuming a flat code
    emptyStreak = 0;
  }

  self.postMessage({
    type: "result",
    id,
    results: best,
    candidate: CANDIDATES[bestIndex],
    ms: Math.round(performance.now() - started),
  });
};

function nextCycleIndex(tried) {
  for (let i = 0; i < CANDIDATES.length; i++) {
    cycle = (cycle + 1) % CANDIDATES.length;
    if (!tried.has(cycle)) return cycle;
  }
  return cycle;
}
