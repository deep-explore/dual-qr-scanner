// Preflight for the offline cache.
//
// The service worker precaches with cache.addAll, which rejects as a whole if
// any single entry 404s — leaving the app with no offline cache at all and no
// obvious symptom until you lose signal. This asserts every listed asset
// exists on disk, and that nothing shipped is missing from the list.
//
//   node scripts/check-assets.mjs

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(root, "sw.js"), "utf8");

const assets = [...sw.matchAll(/"(\.\/[^"]*)"/g)].map((m) => m[1]).filter((p) => p !== "./");
const failures = [];

for (const asset of assets) {
  const path = join(root, asset.replace(/^\.\//, ""));
  if (!existsSync(path)) failures.push(`missing on disk: ${asset}`);
}

// Anything servable that the worker forgot to precache would silently fall
// back to the network, so flag it.
const IGNORE = new Set(["scripts", "test", ".git", "node_modules", "icons"]);
// The worker must not precache itself: the browser fetches it directly, and a
// cached copy fights the update check.
const NOT_PRECACHED = new Set(["./sw.js"]);
const shipped = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(js|css|html|wasm|webmanifest)$/.test(entry)) shipped.push("./" + relative(root, full));
  }
})(root);

const listedSet = new Set(assets);
for (const file of shipped) {
  if (!listedSet.has(file) && !NOT_PRECACHED.has(file)) {
    failures.push(`shipped but not precached: ${file}`);
  }
}

const bytes = assets
  .filter((a) => existsSync(join(root, a.replace(/^\.\//, ""))))
  .reduce((sum, a) => sum + statSync(join(root, a.replace(/^\.\//, ""))).size, 0);

if (failures.length) {
  console.error("FAIL\n" + failures.map((f) => "  - " + f).join("\n"));
  process.exit(1);
}
console.log(`PASS: ${assets.length} precached assets present, ${(bytes / 1024).toFixed(0)} KB total offline payload`);
