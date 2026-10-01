// `prepare` lifecycle script (safe-fragment#10). npm runs it after `npm install`
// / `npm ci` in this repo and, for a GIT dependency, in the cloned checkout
// before packing it, after installing its devDependencies. dist/ is gitignored,
// so without it `npm i git+https://github.com/johnhenry/safe-fragment#<sha>`
// installs an empty package.
//
// Never fails an install that cannot build: with devDependencies omitted
// (`npm ci --omit=dev`) tsup is absent, so say so and leave dist/ as it is
// instead of breaking the whole install. Registry tarballs are never built
// here (npm does not run `prepare` for them).
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
try {
  require.resolve("tsup/package.json");
} catch {
  console.warn("safe-fragment: prepare skipped (tsup is not installed; devDependencies were omitted), so dist/ was not built.");
  process.exit(0);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "build"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
