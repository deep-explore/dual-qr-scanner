// Forward cylindrical warp: bend a flat image onto a cylinder.
//
// Test-only. The scanner never needs it, so it stays out of the app's module
// graph and out of the offline payload.

import { resample, sourceCoord } from "../dewarp.js";

// Inverse of sourceCoord: given a screen position, find the arc position that
// lands there.
function inverseTable(cand, n) {
  const half = (n - 1) / 2;
  const map = new Float32Array(n);
  const hw = 1 - Math.abs(cand.center);
  for (let i = 0; i < n; i++) {
    const s = (i - half) / half;
    const ratio = Math.max(-1, Math.min(1, ((s - cand.center) / hw) * Math.sin(cand.theta)));
    const u = cand.center + (hw * Math.asin(ratio)) / cand.theta;
    map[i] = u * half + half;
  }
  return map;
}

export function warpGray(src, width, height, cand) {
  if (cand.theta < 1e-4) return src;
  const horizontal = cand.axis === "v";
  return resample(src, width, height, inverseTable(cand, horizontal ? width : height), horizontal);
}

// Re-exported so tests can assert the pair really are inverses.
export { sourceCoord };
