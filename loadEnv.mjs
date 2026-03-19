// Load .env file into process.env (KEY=VALUE lines, # comments).
// Existing env vars take precedence — .env values are defaults only.

import { readFileSync } from "fs";

try {
  const content = readFileSync(".env", "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {}
