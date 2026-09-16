#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const help = args.length === 1 && ["--help", "-h"].includes(args[0]);
const remove = args.length === 1 && ["--remove", "-r"].includes(args[0]);

if (help) {
  console.log(`pi-turing — research inside Pi

Usage:
  npx pi-turing          Install or update from npm using Pi
  npx pi-turing --remove Remove the npm package from Pi
  npx pi-turing --help   Show this help

Requires Node.js 22.13+ and pi on PATH.
Pause active research before updating or removing. Saved investigations are kept.
If switching from a Git install, remove its entry with pi remove <source> first.
Run /reload in Pi after installation.`);
} else if (args.length && !remove) {
  console.error("Unknown arguments. Run npx pi-turing --help for usage.");
  process.exitCode = 1;
} else {
  const result = spawnSync("pi", [remove ? "remove" : "install", "npm:pi-turing"], { stdio: "inherit" });
  if (result.error) {
    console.error(result.error.code === "ENOENT"
      ? "Pi was not found on PATH. Install Pi from https://pi.dev, then retry."
      : `Could not run Pi: ${result.error.message}`);
  }
  process.exitCode = result.status ?? 1;
}
