// Post-build step of `npm run build`: types `document.createElement("safe-fragment")`.
//
// A `declare global { interface HTMLElementTagNameMap ... }` block in src/ would make the package
// unpublishable to JSR (global augmentations are "slow types"), so it lives here and is appended to the
// declaration files tsup writes. Idempotent.
import { appendFile, readFile } from "node:fs/promises";

const BLOCK = `
declare global {
  interface HTMLElementTagNameMap {
    "safe-fragment": SafeFragmentElement;
  }
}
`;

for (const file of ["dist/index.d.ts", "dist/index.d.cts"]) {
  const text = await readFile(file, "utf8");
  if (!text.includes("declare global")) await appendFile(file, BLOCK);
}
