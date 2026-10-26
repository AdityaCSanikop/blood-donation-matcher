/**
 * Starts the production server (`next start`) against the TEST databases
 * and stops it afterwards. Run `next build` first (npm run test:api does).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const API_PORT = 3101;
let server: ChildProcess | undefined;

export async function setup() {
  const root = path.resolve(import.meta.dirname, "../..");
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    throw new Error("No production build found. Run `npm run build` first (or use `npm run test:api`).");
  }
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(API_PORT)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", COOKIE_INSECURE: "1" }, // process.env already holds .env.test values
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  server.stdout?.on("data", (d) => (output += d));
  server.stderr?.on("data", (d) => (output += d));

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${API_PORT}/api/health`);
      if (res.status === 200) return;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`Server exited early:\n${output}`);
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Server did not become healthy within 60s:\n${output}`);
}

export async function teardown() {
  server?.kill("SIGTERM");
}
