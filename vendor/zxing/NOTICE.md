# Bundled decoder

This directory contains a vendored copy of the barcode decoder, so the app
needs no package manager and no network at runtime.

## What is here

| File | Origin | Licence |
| --- | --- | --- |
| `reader/index.js`, `share.js` | [zxing-wasm](https://github.com/zxing-wasm/zxing-wasm) 3.1.4 by Ze-Zheng Wu — the JavaScript wrapper | MIT — `LICENSE-zxing-wasm.txt` |
| `reader/zxing_reader.wasm` | [ZXing-C++](https://github.com/zxing-cpp/zxing-cpp) compiled to WebAssembly, distributed in the zxing-wasm package (upstream commit `0b2d9a8fc81f420f369928c24331091ff0525976`) | Apache-2.0 — `LICENSE-zxing-cpp.txt` |

Both licences are permissive and allow commercial use, including in closed
products, provided the licence text and copyright notices travel with the
software — which is why both files are kept here rather than deleted.

Apache-2.0 additionally asks that modifications be stated. The compiled
ZXing-C++ WebAssembly binary is **unmodified**.

## Local modifications

One change has been made to the MIT-licensed wrapper:

- `share.js` — upstream's default `locateFile` points at
  `https://fastly.jsdelivr.net/npm/zxing-wasm@3.1.4/...` to fetch the `.wasm`
  from a CDN. That default is replaced with one that resolves the file next to
  the module. The application always passes its own `locateFile` as well, so
  this only removes the possibility of a network fetch if that override were
  ever lost.
- `reader/zxing_reader.wasm` was moved to sit beside `reader/index.js` so the
  relative default above resolves correctly.

## Updating

Fetch the package, copy `dist/es/reader/index.js`, `dist/es/share.js` and
`dist/reader/zxing_reader.wasm` into the layout above, then re-apply the
`share.js` change and confirm `test/bench.html` still passes:

```bash
npm pack zxing-wasm@<version>
```
