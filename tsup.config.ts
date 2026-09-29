import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  platform: "browser",
  target: "es2022",
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  // Real, justified dependency -- never vendored/bundled. See README
  // "Family" section and docs/adr/0002-native-sanitizer-with-dompurify-fallback.md.
  external: ["dompurify"],
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
