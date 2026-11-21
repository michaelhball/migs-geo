// Use the optional project-local Node installation for CLI and Finder launches.
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const localNode = fileURLToPath(new URL("../.runtime/bin/node", import.meta.url));
const entry = fileURLToPath(new URL("../server/index.mjs", import.meta.url));
if (process.platform !== "win32" && existsSync(localNode) && realpathSync(localNode) !== realpathSync(process.execPath)) {
  process.execve(localNode, [localNode, entry, ...process.argv.slice(2)], process.env);
} else {
  await import("../server/index.mjs");
}
