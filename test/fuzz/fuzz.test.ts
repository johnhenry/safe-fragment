import { describe, it, expect, afterAll } from "vitest";
import { deriveProfile, getProfile, registerProfile } from "../../src/policy/registry.js";
import { caseSeed, makeRng } from "./prng.js";
import { addSeeds, allSeeds, generate } from "./grammar.js";
import { EMAIL_BENIGN, EMAIL_HOSTILE } from "../fixtures/email-corpus.js";
import { checkCase, executionFindings, makeEnv, shrink, type Env, type Finding } from "./harness.js";

/**
 * Mutation-XSS differential fuzzer (safe-fragment#1 review packet).
 *
 * Oracles, per input x profile x engine: nothing executes (CSP-tripwire frame),
 * the output satisfies the profile (independent verifier), re-sanitizing the
 * output is a fixpoint, parse -> serialize -> parse of the output is stable and
 * still conformant, and the two engines agree (or the difference is a
 * documented divergence in ./divergences.ts).
 *
 * Deterministic: a fixed seed and iteration budget in CI. For a long local run:
 *   npm run fuzz -- --iterations 20000 --seed 7
 * Reproduce a failure with the seed and case index printed in the message.
 */
function numberFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && String(value ?? "") !== "" ? n : fallback;
}
const env_ = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const SEED = numberFrom(env_.VITE_SF_FUZZ_SEED, 20261001);
const ITERATIONS = numberFrom(env_.VITE_SF_FUZZ_ITERATIONS, 150);
const ONLY = env_.VITE_SF_FUZZ_ONLY === undefined || env_.VITE_SF_FUZZ_ONLY === "" ? undefined : Number(env_.VITE_SF_FUZZ_ONLY);
const REPLAY_CORPUS = env_.VITE_SF_FUZZ_CORPUS !== "0";
addSeeds(...EMAIL_BENIGN.map((f) => f.input), ...EMAIL_HOSTILE.map((f) => f.input));

// A profile that allows some classes, so the class allowlist is fuzzed too (ui-v1 allows none).
if (!getProfile("fuzz-ui-classes-v1")) registerProfile(deriveProfile("ui-v1", { name: "fuzz-ui-classes-v1", allowedClasses: ["user-*", "btn"] }));
const PROFILES = ["article-v1", "ui-v1", "email-v1", "component-template-v1", "fuzz-ui-classes-v1"];
const BATCH = 20;
const MAX_REPORTED = 4;

function describeFinding(f: Finding, shrunk: string, where: string): string {
  return `[${f.oracle}] engine=${f.engine} profile=${f.profile} ${where}\ninput (shrunk): ${JSON.stringify(shrunk)}\noriginal input: ${JSON.stringify(f.input)}\n${f.detail}`;
}

async function shrinkFinding(env: Env, f: Finding): Promise<string> {
  const profile = getProfile(f.profile)!;
  return shrink(f.input, async (candidate) => {
    const again = f.oracle === "execution" ? await executionFindings(env, profile, candidate) : await checkCase(env, profile, candidate, false);
    return again.some((x) => x.oracle === f.oracle);
  });
}

async function runInputs(env: Env, profileName: string, inputs: Array<{ input: string; label: string }>): Promise<string[]> {
  const profile = getProfile(profileName)!;
  const reports: string[] = [];
  const seen = new Set<string>();
  for (let start = 0; start < inputs.length; start += BATCH) {
    const batch = inputs.slice(start, start + BATCH);
    const staticFindings: Array<{ f: Finding; label: string }> = [];
    for (const { input, label } of batch) {
      for (const f of await checkCase(env, profile, input, true)) staticFindings.push({ f, label });
    }
    const fired = await env.probe.flush();
    const all = [...staticFindings];
    if (fired.length) {
      // attribute the execution to a case by re-mounting each one alone
      for (const { input, label } of batch) {
        for (const f of await executionFindings(env, profile, input)) all.push({ f, label });
      }
    }
    for (const { f, label } of all) {
      const key = `${f.oracle}|${f.engine}|${f.detail.split("\n")[0]}`;
      if (seen.has(key) || reports.length >= MAX_REPORTED) continue;
      seen.add(key);
      reports.push(describeFinding(f, await shrinkFinding(env, f), label));
    }
  }
  return reports;
}

describe(`mutation-XSS differential fuzzer (seed ${SEED}, ${ITERATIONS} random cases per profile)`, () => {
  let env: Env;
  const summary: string[] = [];

  it("sets up the engines and the execution probe", async () => {
    env = await makeEnv();
    expect(env.engines.length).toBeGreaterThan(0);
  });

  for (const profileName of PROFILES) {
    it(`${profileName}: corpus replay`, async () => {
      if (!REPLAY_CORPUS || ONLY !== undefined) return;
      const inputs = allSeeds().map((input, i) => ({ input, label: `corpus #${i}` }));
      expect(await runInputs(env, profileName, inputs)).toEqual([]);
    }, 120_000);

    it(`${profileName}: random and mutated markup`, async () => {
      const inputs: Array<{ input: string; label: string }> = [];
      for (let i = 0; i < ITERATIONS; i++) {
        if (ONLY !== undefined && ONLY !== i) continue;
        inputs.push({ input: generate(makeRng(caseSeed(SEED, i))), label: `seed=${SEED} case=${i} (VITE_SF_FUZZ_SEED=${SEED} VITE_SF_FUZZ_ONLY=${i})` });
      }
      expect(await runInputs(env, profileName, inputs)).toEqual([]);
    }, 600_000);
  }

  afterAll(() => {
    if (!env) return;
    summary.push(
      `engines: ${env.engines.join("+")}; cases checked: ${env.stats.cases}; round-trip tree drift (benign, non-canonical nesting): ${env.stats.drift}`,
    );
    for (const [reason, n] of env.stats.divergences) summary.push(`documented divergence "${reason}": ${n}`);
    console.info(`[fuzz] ${summary.join("\n[fuzz] ")}`);
    env.probe.dispose();
  });
});
