// Scanner worker: sweeps one whole frame per message.
//
// Blocking here costs nothing visible — the preview runs on the main thread —
// so there is no per-frame attempt budget and no scheduler. The worker takes a
// frame, sweeps candidates until it has both codes, and answers. On the
// reference photographs that lands in 30-60 ms; a frame with nothing in it
// costs a full sweep, a few hundred ms.
//
// Two orderings keep the common case at the front: candidates that worked on
// the previous frame, then the axis the device says is upright.

import { CANDIDATES, sweepFrame, toGray } from "./pipeline.js";

const ERROR_REPORT_INTERVAL_MS = 2000;

let scratch = null;
let plane = null;
let recent = []; // candidate ids that produced a result last time
let lastErrorAt = 0;
let errorCount = 0;

self.onmessage = async (e) => {
  const msg = e.data;
  if (msg.type === "reset") {
    recent = [];
    errorCount = 0;
    return;
  }
  if (msg.type !== "frame") return;

  const { id, width, height, axisHint } = msg;
  const started = performance.now();
  let results = [];
  let winners = [];
  let failure = null;

  // Everything that could throw lives in here: a frame that never answers
  // would wedge the main thread's pump forever.
  try {
    const gray = toGray(new Uint8ClampedArray(msg.buffer), width, height);
    if (!scratch || scratch.length !== width * height * 4) {
      scratch = new Uint8ClampedArray(width * height * 4);
      plane = new Uint8ClampedArray(width * height);
    }
    const swept = await sweepFrame(gray, width, height, {
      order: orderCandidates(axisHint),
      scratch,
      plane,
    });
    results = swept.results;
    winners = swept.winners;
    recent = winners.map((c) => c.id);
    if (results.length) errorCount = 0;
  } catch (err) {
    failure = String(err?.message ?? err);
    errorCount++;
  }

  self.postMessage({
    type: "result",
    id,
    results,
    winners,
    ms: Math.round(performance.now() - started),
    error: reportableError(failure),
    errorCount,
  });
};

// The default list already leads with vertical-axis candidates, so ordering by
// the hint alone would change almost nothing. The hint earns its keep by
// pruning: a phone held upright is looking at a standing bottle, so the
// horizontal-axis half of the sweep can go, which is what halves the cost of a
// frame containing no codes. Without a hint — a desktop, a flat phone, or iOS
// where we never ask for motion permission — everything is still tried.
function orderCandidates(axisHint) {
  const usable = axisHint ? CANDIDATES.filter((c) => c.theta < 1e-4 || c.axis === axisHint) : [...CANDIDATES];
  const rank = (cand) => {
    if (recent.includes(cand.id)) return 0;
    if (cand.theta < 1e-4) return 1; // the flat pass stays cheap and early
    return 2;
  };
  return usable.sort((a, b) => rank(a) - rank(b));
}

// A broken decoder would otherwise post two messages per frame forever.
function reportableError(message) {
  if (!message) return null;
  const now = performance.now();
  if (now - lastErrorAt < ERROR_REPORT_INTERVAL_MS) return null;
  lastErrorAt = now;
  return message;
}
