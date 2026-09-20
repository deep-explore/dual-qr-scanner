// Decode pipeline: grayscale -> candidate dewarp -> ZXing.
// Shared by the scanner worker, the still-image path and the test pages.

import { prepareZXingModule, readBarcodes } from "./vendor/zxing/reader/index.js";
import { CANDIDATES, dewarpGray, toSourcePoint } from "./dewarp.js";
import { MAX_CODES, isComplete, mergeFrameResults } from "./policy.js";

const WASM_URL = new URL("./vendor/zxing/reader/zxing_reader.wasm", import.meta.url).href;

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? WASM_URL : prefix + path),
  },
});

const READER_OPTIONS = {
  formats: ["QRCode", "MicroQRCode"],
  maxNumberOfSymbols: MAX_CODES,
  tryHarder: true,
  tryInvert: true,
  tryRotate: true,
  tryDownscale: true,
};

export function toGray(rgba, width, height) {
  const gray = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
  }
  return gray;
}

function grayToImageData(gray, width, height, scratch) {
  const rgba = scratch ?? new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    const v = gray[i];
    rgba[p] = v;
    rgba[p + 1] = v;
    rgba[p + 2] = v;
    rgba[p + 3] = 255;
  }
  return new ImageData(rgba, width, height);
}

/**
 * Run one dewarp candidate over a grayscale frame.
 * Detection corners are mapped back to source coordinates so the caller can
 * outline them on the untouched preview.
 *
 * `scratch` (RGBA) and `plane` (grayscale) are reused across calls to keep the
 * scan loop free of per-frame allocation.
 */
export async function decodeWithCandidate(gray, width, height, cand, scratch, plane) {
  const straightened = dewarpGray(gray, width, height, cand, plane);
  const results = await readBarcodes(grayToImageData(straightened, width, height, scratch), READER_OPTIONS);
  return results.map((r) => ({
    text: r.text,
    bytes: r.bytes,
    format: r.format,
    candidate: cand.id,
    corners: ["topLeft", "topRight", "bottomRight", "bottomLeft"].map((k) =>
      toSourcePoint(r.position[k], width, height, cand),
    ),
  }));
}

/**
 * Sweep one frame, merging what each candidate finds.
 *
 * A single global warp cannot straighten a whole cylinder, so two labels on
 * the same bottle typically need two different candidates — but both readings
 * come from this one frame, which is what the pairing rule requires.
 *
 * `order` lets a caller try previously successful candidates first.
 */
export async function sweepFrame(gray, width, height, { order = CANDIDATES, scratch, plane } = {}) {
  const rgba = scratch ?? new Uint8ClampedArray(width * height * 4);
  const merged = new Map();
  const winners = [];

  for (const cand of order) {
    const found = await decodeWithCandidate(gray, width, height, cand, rgba, plane);
    if (found.length) {
      const before = merged.size;
      mergeFrameResults(merged, found);
      if (merged.size > before) winners.push(cand);
    }
    if (isComplete([...merged.keys()])) break;
  }

  return { results: [...merged.values()], winners };
}

export { CANDIDATES };
