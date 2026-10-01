// `npm run size` (CI step): fails when the package got bigger than its budget.
//
// Measures, after `npm run build`:
//   - the gzip size (level 9) of dist/index.js, the file a browser downloads;
//   - the size of the tarball `npm pack` would publish (npm's own number, gzip'd tar).
// against the ceilings in size-budget.json. The ceilings sit above today's sizes with headroom
// (see "Size budget" in AGENTS.md); raising one is a deliberate edit with a reason in the commit,
// never a drive-by. `npm run size -- --print` prints the measured numbers and exits 0.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const budget = JSON.parse(readFileSync(new URL("../size-budget.json", import.meta.url), "utf8"));

const gzipIndex = gzipSync(readFileSync(new URL("../dist/index.js", import.meta.url)), { level: 9 }).length;

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pack = spawnSync(npm, ["pack", "--json", "--dry-run", "--ignore-scripts"], { encoding: "utf8", shell: process.platform === "win32" });
if (pack.status !== 0) {
  console.error(pack.stderr || pack.stdout);
  console.error("size: `npm pack --dry-run` failed");
  process.exit(1);
}
const tarball = JSON.parse(pack.stdout)[0].size;

const rows = [
  ["dist/index.js (gzip -9)", gzipIndex, budget.gzipIndexJs],
  ["packed tarball", tarball, budget.tarball],
];

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
let failed = false;
for (const [name, size, max] of rows) {
  const over = size > max;
  failed ||= over;
  console.log(`${over ? "FAIL" : "ok  "} ${name}: ${kb(size)} (${size} B), budget ${kb(max)} (${max} B), headroom ${(((max - size) / max) * 100).toFixed(1)}%`);
}
if (process.argv.includes("--print")) process.exit(0);
if (failed) {
  console.error("\nsize: over budget. If the growth is intended, raise size-budget.json in the same commit and say why; otherwise shrink the change.");
  process.exit(1);
}
