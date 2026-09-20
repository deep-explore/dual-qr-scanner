// Cylindrical dewarp.
//
// A label wrapped on a cylinder of radius R, seen from the front, projects a
// point at angle t (from the cylinder's near line) to screen offset R*sin(t),
// while its true position on the flattened label is the arc length R*t. So the
// picture is squeezed towards the silhouette edges, and undoing it means
// sampling the source at sin() of the evenly spaced output angle.
//
// Parametrised by `theta`: the half-angle of cylinder surface covered by half
// the image. theta -> 0 is a flat label; 1.3 rad (~75 deg) is a code wrapped
// hard around a bottle. `center` is where the cylinder's near line sits, in
// normalised [-1, 1] image coordinates. `axis` is the cylinder's axis: 'v' for
// a standing bottle or can (the squeeze runs horizontally), 'h' for one lying
// on its side.
//
// `center` turns out to carry most of the weight on real bottles. One global
// warp cannot straighten a whole cylinder, because each label sits at its own
// angle around the circumference; shifting the near line effectively picks
// which part of the surface gets corrected. On the reference photographs the
// two labels are recovered by two different centres of the same frame, which
// is why the scanner merges results across candidates rather than hunting for
// one perfect warp.

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

/** Source coordinate (normalised, [-1, 1]) that output coordinate `u` samples. */
export function sourceCoord(u, theta, center) {
  if (theta < 1e-4) return u;
  // Output spans the arc evenly; scale so the image edges stay put.
  const half = 1 - Math.abs(center);
  const t = ((u - center) / half) * theta;
  return center + (half * Math.sin(t)) / Math.sin(theta);
}

// A sample table depends only on the candidate and the frame size, both fixed
// for the life of a scan, so each one is built once and kept.
const tables = new Map();

export function sampleTable(cand, n) {
  const key = `${cand.id}:${n}`;
  const cached = tables.get(key);
  if (cached) return cached;
  const half = (n - 1) / 2;
  const table = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    table[i] = sourceCoord((i - half) / half, cand.theta, cand.center) * half + half;
  }
  tables.set(key, table);
  return table;
}

/**
 * Resample a grayscale plane along one axis through a sample table. Bilinear,
 * edge-clamped. Writes into `out` when given so the scan loop can run without
 * allocating.
 */
export function resample(src, width, height, map, horizontal, out) {
  const dst = out ?? new Uint8ClampedArray(width * height);
  const n = horizontal ? width : height;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    if (horizontal) {
      for (let x = 0; x < width; x++) {
        const s = map[x];
        const i0 = Math.floor(s);
        const frac = s - i0;
        const va = src[row + clampIdx(i0, n)];
        const vb = src[row + clampIdx(i0 + 1, n)];
        dst[row + x] = va + (vb - va) * frac;
      }
    } else {
      // Every pixel in the row samples the same pair of source rows.
      const s = map[y];
      const i0 = Math.floor(s);
      const frac = s - i0;
      const ra = clampIdx(i0, n) * width;
      const rb = clampIdx(i0 + 1, n) * width;
      for (let x = 0; x < width; x++) {
        const va = src[ra + x];
        const vb = src[rb + x];
        dst[row + x] = va + (vb - va) * frac;
      }
    }
  }
  return dst;
}

/**
 * Straighten a frame that was bent around a cylinder.
 *
 * The flat candidate has nothing to do and returns `src` itself rather than
 * copying, so callers must treat the result as read-only.
 */
export function dewarpGray(src, width, height, cand, out) {
  if (cand.theta < 1e-4) return src;
  const horizontal = cand.axis === "v"; // vertical axis => horizontal squeeze
  return resample(src, width, height, sampleTable(cand, horizontal ? width : height), horizontal, out);
}

export function clampIdx(i, n) {
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
