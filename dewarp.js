// Cylindrical dewarp.
//
// A label wrapped on a cylinder of radius R, seen from the front, projects a
// point at angle t (from the cylinder's near line) to screen offset R*sin(t),
// while its true position on the flattened label is the arc length R*t. So the
// picture is squeezed towards the silhouette edges, and undoing it means
// sampling the source at sin() of the evenly spaced output angle.
//
// Parametrised by `theta`: the half-angle of cylinder surface covered by half
// the image. theta -> 0 is a flat label; 1.2 rad (~69 deg) is a code wrapped
// hard around a bottle. `center` is where the cylinder's near line sits, in
// normalised [-1, 1] image coordinates, since the object is rarely centred
// perfectly. `axis` is the cylinder's axis: 'v' for a standing bottle or can
// (the squeeze runs horizontally), 'h' for one lying on its side.

export const CANDIDATES = buildCandidates();

function buildCandidates() {
  const list = [{ id: "flat", axis: "v", theta: 0, center: 0 }];
  for (const axis of ["v", "h"]) {
    // ZXing already copes with gentle curvature on its own (~0.9 rad in the
    // self-test), so the sweep spends its budget where the decoder fails.
    for (const theta of [0.7, 1.0, 1.3]) {
      for (const center of [0, -0.3, 0.3]) {
        list.push({ id: `${axis}-t${theta}-c${center}`, axis, theta, center });
      }
    }
  }
  return list;
}

// Source coordinate (normalised, [-1, 1]) that output coordinate `u` samples.
function sourceCoord(u, theta, center) {
  if (theta < 1e-4) return u;
  // Output spans the arc evenly; scale so the image edges stay put.
  const half = 1 - Math.abs(center);
  const t = ((u - center) / half) * theta;
  return center + (half * Math.sin(t)) / Math.sin(theta);
}

/**
 * Resample a grayscale plane with the inverse cylindrical projection.
 * Bilinear, edge-clamped. Returns a new plane of the same size.
 */
export function dewarpGray(src, width, height, cand) {
  if (cand.theta < 1e-4) return src;
  const out = new Uint8ClampedArray(width * height);
  const horizontal = cand.axis === "v"; // vertical axis => horizontal squeeze
  const n = horizontal ? width : height;
  const half = (n - 1) / 2;

  // The remap is the same for every line, so build the sample table once.
  const map = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = (i - half) / half;
    map[i] = sourceCoord(u, cand.theta, cand.center) * half + half;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = horizontal ? map[x] : map[y];
      const i0 = Math.floor(s);
      const frac = s - i0;
      const a = clampIdx(i0, n);
      const b = clampIdx(i0 + 1, n);
      const p = horizontal ? y * width : 0;
      const va = horizontal ? src[p + a] : src[a * width + x];
      const vb = horizontal ? src[p + b] : src[b * width + x];
      out[y * width + x] = va + (vb - va) * frac;
    }
  }
  return out;
}

function clampIdx(i, n) {
  return i < 0 ? 0 : i >= n ? n - 1 : i;
}

/**
 * Map a point found in a dewarped image back to source-image coordinates, so
 * detections can be outlined on the untouched camera preview.
 */
export function toSourcePoint(pt, width, height, cand) {
  if (cand.theta < 1e-4) return { x: pt.x, y: pt.y };
  const horizontal = cand.axis === "v";
  const n = horizontal ? width : height;
  const half = (n - 1) / 2;
  const v = horizontal ? pt.x : pt.y;
  const mapped = sourceCoord((v - half) / half, cand.theta, cand.center) * half + half;
  return horizontal ? { x: mapped, y: pt.y } : { x: pt.x, y: mapped };
}

/** Forward warp: bend a flat image onto a cylinder. Used by the tests. */
export function warpGray(src, width, height, cand) {
  const out = new Uint8ClampedArray(width * height);
  const horizontal = cand.axis === "v";
  const n = horizontal ? width : height;
  const half = (n - 1) / 2;
  const map = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = (i - half) / half;
    // Invert sourceCoord: given screen position, find the arc position.
    const hw = 1 - Math.abs(cand.center);
    const ratio = Math.max(-1, Math.min(1, ((s - cand.center) / hw) * Math.sin(cand.theta)));
    const u = cand.center + (hw * Math.asin(ratio)) / cand.theta;
    map[i] = u * half + half;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = horizontal ? map[x] : map[y];
      const i0 = Math.floor(s);
      const frac = s - i0;
      const a = clampIdx(i0, n);
      const b = clampIdx(i0 + 1, n);
      const va = horizontal ? src[y * width + a] : src[a * width + x];
      const vb = horizontal ? src[y * width + b] : src[b * width + x];
      out[y * width + x] = va + (vb - va) * frac;
    }
  }
  return out;
}
