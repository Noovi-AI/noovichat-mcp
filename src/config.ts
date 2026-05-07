import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageInfo {
  name: string;
  version: string;
}

function loadPackageInfo(): PackageInfo {
  // Resolve package.json from project root regardless of build layout.
  // In dev (tsx/vitest): __dirname = .../NooviChat-MCP/src
  // In prod (tsup esm):  __dirname = .../NooviChat-MCP/dist
  const candidates = [
    resolve(__dirname, "../package.json"),
    resolve(__dirname, "../../package.json"),
  ];

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const pkg = JSON.parse(raw) as PackageInfo;
      if (pkg.name && pkg.version) return pkg;
    } catch {
      // try next candidate
    }
  }

  return { name: "@nooviai/noovichat-mcp", version: "0.0.0" };
}

const packageInfo = loadPackageInfo();

export default {
  packageInfo,
};
