import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * safe-fragment#10: `npm i git+https://github.com/johnhenry/safe-fragment#<sha>`
 * used to install a package with no `dist/` (it is gitignored, and nothing
 * built it). A `prepare` script fixes that: npm installs a git dependency's
 * devDependencies and runs `prepare` before packing it. This installs the
 * COMMITTED HEAD of this repo as a git dependency into a scratch project and
 * imports it as a consumer would, so the git-install path stays working until
 * the package is on the registry. Needs network (npm registry) and git.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scratch = mkdtempSync(join(tmpdir(), "sf-git-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const run = (cmd: string, args: string[], cwd: string): string =>
  execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, npm_config_loglevel: "error" } });

describe("installing the repo as a git dependency (safe-fragment#10)", () => {
  it("ships a working dist, and the ESM and CJS entry points import", { timeout: 600_000 }, async () => {
    const sha = run("git", ["rev-parse", "HEAD"], root).trim();
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(scratch, "package.json"), JSON.stringify({ name: "consumer", version: "0.0.0", private: true, type: "module" }));
    run("npm", ["install", "--no-audit", "--no-fund", `git+${pathToFileURL(root).href}#${sha}`], scratch);

    const pkgDir = join(scratch, "node_modules", "@johnhenry", "safe-fragment");
    for (const file of ["dist/index.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.d.cts"]) {
      expect(existsSync(join(pkgDir, file)), `${file} must be installed`).toBe(true);
    }
    expect(JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).name).toBe("@johnhenry/safe-fragment");

    writeFileSync(
      join(scratch, "check.mjs"),
      [
        'import { createRequire } from "node:module";',
        'import * as esm from "@johnhenry/safe-fragment";',
        'const cjs = createRequire(import.meta.url)("@johnhenry/safe-fragment");',
        'if (typeof esm.sanitizeToFragment !== "function" || typeof cjs.sanitizeToFragment !== "function") throw new Error("missing export");',
        'if (!esm.listProfiles().includes("article-v1")) throw new Error("no profiles");',
        "console.log(esm.listProfiles().join(','));",
      ].join("\n"),
    );
    expect(run("node", ["check.mjs"], scratch)).toContain("article-v1");
  });
});
