// `npm run fuzz`: a long local run of the mutation-XSS differential fuzzer
// (test/fuzz). CI runs the same tests with a small fixed budget as part of
// `npm test`; this script only raises the budget and picks the seed.
//
//   npm run fuzz                                    # 5000 cases per profile, random seed (printed)
//   npm run fuzz -- --iterations 50000 --seed 7     # long, reproducible
//   npm run fuzz -- --seed 7 --only 1234            # re-run one case of a seed
//   npm run fuzz -- --browsers chromium,webkit      # default: SF_BROWSERS, else all three
//   npm run fuzz -- --no-corpus                     # skip the fixed corpus replay
//   npm run fuzz -- --realm document                # where the engines parse: auto (default), iframe, document (ADR 0012)
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}

const seed = flag("seed") ?? String(Math.floor(Math.random() * 1_000_000));
const env = {
  ...process.env,
  SF_FUZZ_ONLY: "1",
  VITE_SF_FUZZ_SEED: seed,
  VITE_SF_FUZZ_ITERATIONS: flag("iterations") ?? "5000",
};
if (flag("only") !== undefined) env.VITE_SF_FUZZ_ONLY = flag("only");
if (args.includes("--no-corpus")) env.VITE_SF_FUZZ_CORPUS = "0";
if (flag("browsers")) env.SF_BROWSERS = flag("browsers");
if (flag("realm")) env.VITE_SF_FUZZ_REALM = flag("realm");

console.log(`fuzz: seed=${seed} iterations=${env.VITE_SF_FUZZ_ITERATIONS} browsers=${env.SF_BROWSERS ?? "chromium,webkit,firefox"}`);
console.log(`fuzz: reproduce with  npm run fuzz -- --seed ${seed} --iterations ${env.VITE_SF_FUZZ_ITERATIONS}`);

const require = createRequire(import.meta.url);
const vitest = require.resolve("vitest/vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "--silent=false"], { stdio: "inherit", env });
process.exit(result.status ?? 1);
