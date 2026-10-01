import createDOMPurify from "dompurify";
import { sanitize } from "../../src/sanitize/index.js";
import type { ProfileDefinition } from "../../src/policy/profile.js";
import type { DOMPurifyFactory } from "../../src/sanitize/dompurify.js";
import { hasNativeSanitizer } from "../../src/sanitize/capabilities.js";
import { conformance, createProbe, neutralizeResolvedUrls, normalize, reparse, serialize, type ConformanceOptions, type Probe } from "./oracles.js";
import { divergenceReason } from "./divergences.js";

export type Engine = "native" | "dompurify";

export type OracleName = "throws" | "conformance" | "fixpoint" | "round-trip" | "execution" | "engine-agreement";

export interface Finding {
  oracle: OracleName;
  engine: Engine | "both";
  profile: string;
  input: string;
  detail: string;
}

const factory = createDOMPurify as unknown as DOMPurifyFactory;

export interface Env {
  doc: Document;
  engines: Engine[];
  probe: Probe;
  conformanceOptions?: (profile: ProfileDefinition) => Partial<ConformanceOptions>;
  /** Counters for the run summary. */
  stats: { cases: number; drift: number; divergences: Map<string, number> };
}

export async function makeEnv(extra?: Env["conformanceOptions"]): Promise<Env> {
  const engines: Engine[] = ["dompurify"];
  if (hasNativeSanitizer(document)) engines.unshift("native");
  return { doc: document, engines, probe: await createProbe(document), conformanceOptions: extra, stats: { cases: 0, drift: 0, divergences: new Map() } };
}

/**
 * A deliberately hostile cid resolver: depending on the content-id it answers with a safe URL, with every
 * kind of unsafe one, echoes the attacker-chosen id back, throws, or answers with a non-string.
 */
export function fuzzResolveCid(cid: string): string | undefined {
  switch (cid.length % 9) {
    case 0:
      return `https://cdn.example/att/${encodeURIComponent(cid)}`;
    case 1:
      return "blob:https://app.example/00000000-0000-4000-8000-000000000000";
    case 2:
      return "data:image/png;base64,iVBORw0KGgo=";
    case 3:
      return "javascript:alert(1)";
    case 4:
      return "//evil.example/x.png";
    case 5:
      return cid;
    case 6:
      throw new Error("resolver failed");
    case 7:
      return 42 as unknown as string;
    default:
      return undefined;
  }
}

/** `VITE_SF_FUZZ_REALM=document|iframe|auto` picks where the engines parse (default auto, ADR 0012); `npm run fuzz -- --realm document`. */
const REALM = ((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_SF_FUZZ_REALM ?? "auto") as "auto" | "iframe" | "document";

async function run(env: Env, profile: ProfileDefinition, input: string, engine: Engine, idPolicy?: "keep-in-shadow") {
  return sanitize(env.doc, input, profile, {
    forceEngine: engine,
    loadDOMPurify: async () => factory,
    idPolicy,
    resolveCid: fuzzResolveCid,
    inertRealm: REALM,
  });
}

/**
 * Runs every oracle on one input, both engines. Static oracles only; the
 * execution probe is driven by `executionFindings` so it can be batched.
 */
export async function checkCase(env: Env, profile: ProfileDefinition, input: string, mount: boolean): Promise<Finding[]> {
  const findings: Finding[] = [];
  const outputs = new Map<Engine, string>();
  const trees = new Map<Engine, DocumentFragment>();
  env.stats.cases++;
  const add = (oracle: OracleName, engine: Engine | "both", detail: string): void => {
    findings.push({ oracle, engine, profile: profile.name, input, detail });
  };
  const cOpts = (): ConformanceOptions => ({ baseUrl: env.doc.baseURI, ...(env.conformanceOptions?.(profile) ?? {}) });

  for (const engine of env.engines) {
    let result;
    try {
      result = await run(env, profile, input, engine);
    } catch (e) {
      add("throws", engine, String(e));
      continue;
    }
    const html = serialize(result.fragment);
    const htmlForFixpoint = serialize(neutralizeResolvedUrls(result.fragment, profile));
    outputs.set(engine, html);
    trees.set(engine, result.fragment);

    const bad = conformance(result.fragment, profile, cOpts());
    if (bad.length) add("conformance", engine, `output: ${html}\n${bad.join("\n")}`);

    // mXSS stability 1: the output is already what a host's re-parse would see, so re-sanitizing it removes
    // nothing (ids are namespaced already, hence keep-in-shadow on the second pass), and the result is a fixpoint.
    try {
      const again = await run(env, profile, htmlForFixpoint, engine, "keep-in-shadow");
      if (normalize(reparse(serialize(again.fragment))) !== normalize(reparse(htmlForFixpoint))) {
        add(
          "fixpoint",
          engine,
          `re-sanitizing the output changed what a host re-parse sees:\noutput   : ${htmlForFixpoint}\nresanitized: ${serialize(again.fragment)}\nreparsed   : ${serialize(reparse(htmlForFixpoint))}`,
        );
      } else {
        const stable = serialize(again.fragment);
        const third = serialize((await run(env, profile, stable, engine, "keep-in-shadow")).fragment);
        if (third !== stable) add("fixpoint", engine, `not a fixpoint:\n${stable}\n${third}`);
      }
    } catch (e) {
      add("throws", engine, `re-sanitize: ${String(e)}`);
    }

    // mXSS stability 2: parse -> serialize -> parse of the output.
    const t2 = reparse(html);
    const bad2 = conformance(t2, profile, cOpts());
    if (bad2.length) add("round-trip", engine, `serialized: ${html}\nreparsed tree violates the profile:\n${bad2.join("\n")}`);
    const s2 = serialize(t2);
    const s3 = serialize(reparse(s2));
    if (s3 !== s2) add("round-trip", engine, `not stable after one parse/serialize round:\n${s2}\n${s3}`);
    if (normalize(t2) !== normalize(result.fragment)) env.stats.drift++;

    if (mount) env.probe.mount(result.fragment, html);
  }

  if (env.engines.length === 2) {
    const a = outputs.get("native");
    const b = outputs.get("dompurify");
    const ta = trees.get("native");
    const tb = trees.get("dompurify");
    if (a !== undefined && b !== undefined && ta && tb && normalize(ta) !== normalize(tb)) {
      const reason = divergenceReason(input, ta, tb);
      if (reason) env.stats.divergences.set(reason, (env.stats.divergences.get(reason) ?? 0) + 1);
      else add("engine-agreement", "both", `native   : ${a}\ndompurify: ${b}`);
    }
  }
  return findings;
}

/** Mounts a case's outputs, waits, and reports any attempted execution. */
export async function executionFindings(env: Env, profile: ProfileDefinition, input: string): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const engine of env.engines) {
    try {
      const r = await run(env, profile, input, engine);
      env.probe.mount(r.fragment, serialize(r.fragment));
    } catch {
      // a throw is reported by checkCase
    }
  }
  const fired = await env.probe.flush();
  if (fired.length) out.push({ oracle: "execution", engine: "both", profile: profile.name, input, detail: fired.join("\n") });
  return out;
}

/** Delta-debugs `input` down while `fails(candidate)` keeps returning true. */
export async function shrink(input: string, fails: (candidate: string) => Promise<boolean>, budget = 300): Promise<string> {
  let best = input;
  let runs = 0;
  for (let size = Math.ceil(best.length / 2); size >= 1; size = size === 1 ? 0 : Math.ceil(size / 2)) {
    let i = 0;
    while (i < best.length && runs < budget) {
      const candidate = best.slice(0, i) + best.slice(i + size);
      runs++;
      if (candidate !== best && (await fails(candidate))) best = candidate;
      else i += size;
    }
    if (size === 1) break;
  }
  return best;
}
