import { build } from "esbuild";
import { readdirSync, existsSync } from "fs";
import { join } from "path";

const srcDir = "src";
const outDir = "Vimium/Safari Extension/Resources";

// Collect all .ts entry points from src/, preserving directory structure
function getEntryPoints(dir, base = "") {
  const entries = [];
  if (!existsSync(dir)) {
    console.log("No src/ directory found — nothing to compile.");
    return entries;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      entries.push(...getEntryPoints(join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      entries.push(join(dir, entry.name));
    }
  }
  return entries;
}

const entryPoints = getEntryPoints(srcDir);

if (entryPoints.length === 0) {
  console.log("No TypeScript files to compile.");
  process.exit(0);
}

await build({
  entryPoints,
  outdir: outDir,
  outbase: srcDir,
  bundle: false,
  format: "esm",
  target: "es2020",
  sourcemap: false,
  logLevel: "info",
});
