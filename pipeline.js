// Decode pipeline: grayscale -> candidate dewarp -> ZXing.
// Shared by the scanner worker and the self-test page.

import { prepareZXingModule, readBarcodes } from "./vendor/zxing/reader/index.js";
import { CANDIDATES, dewarpGray, toSourcePoint } from "./dewarp.js";

const WASM_URL = new URL("./vendor/zxing/zxing_reader.wasm", import.meta.url).href;

prepareZXingModule({
  overrides: {
    locateFile: (path, prefix) => (path.endsWith(".wasm") ? WASM_URL : prefix + path),
  },
});

const READER_OPTIONS = {
  formats: ["QRCode", "MicroQRCode"],
  maxNumberOfSymbols: 2,
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
 */
export async function decodeWithCandidate(gray, width, height, cand, scratch) {
  const plane = dewarpGray(gray, width, height, cand);
  const results = await readBarcodes(grayToImageData(plane, width, height, scratch), READER_OPTIONS);
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
 * Sweep every candidate until one pass returns `want` codes. Used by the
 * self-test and by still-image scanning, where there is no next frame to
 * spread the work across.
 */
export async function decodeSweep(gray, width, height, want = 2) {
  const scratch = new Uint8ClampedArray(width * height * 4);
  let best = [];
  for (const cand of CANDIDATES) {
    const found = await decodeWithCandidate(gray, width, height, cand, scratch);
    if (found.length > best.length) best = found;
    if (best.length >= want) break;
  }
  return best;
}

export { CANDIDATES };
