import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const installer = join(root, "install.mjs");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "turing-install-"));
  const capture = join(dir, "args.json");
  writeFileSync(join(dir, "pi"), `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.PI_TEST_CAPTURE, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.PI_TEST_EXIT || 0));
`, { mode: 0o755 });
  return {
    dir, capture,
    run(args: string[], env: NodeJS.ProcessEnv = {}) {
      return spawnSync(process.execPath, [installer, ...args], {
        cwd: dir, encoding: "utf8",
        env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}`, PI_TEST_CAPTURE: capture, PI_TEST_EXIT: "0", ...env },
      });
    },
    cleanup() { rmSync(dir, { recursive: true, force: true }); },
  };
}

test("installer delegates npm installation and removal to Pi", () => {
  const f = fixture();
  try {
    for (const [args, command] of [[[], "install"], [["--remove"], "remove"], [["-r"], "remove"]] as const) {
      const result = f.run([...args]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(f.capture, "utf8")), [command, "npm:pi-turing"]);
    }
    assert.equal(f.run([], { PI_TEST_EXIT: "23" }).status, 23, "Preserve Pi's failure status");
  } finally { f.cleanup(); }
});

test("help and invalid arguments never invoke Pi", () => {
  const f = fixture();
  try {
    for (const flag of ["--help", "-h"]) {
      const result = f.run([flag], { PATH: "" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /npx pi-turing/);
    }
    for (const args of [["--unknown"], ["--remove", "--help"], ["some-package"]]) {
      const result = f.run(args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unknown arguments/);
    }
    assert.equal(existsSync(f.capture), false);
  } finally { f.cleanup(); }
});

test("installer explains when Pi is missing", () => {
  const f = fixture();
  try {
    const result = f.run([], { PATH: join(f.dir, "missing-bin") });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Pi was not found on PATH/);
  } finally { f.cleanup(); }
});

test("npm package ships an executable installer and runtime resources without private state", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.name, "pi-turing");
  assert.deepEqual(pkg.bin, { "pi-turing": "install.mjs" });
  assert.equal(pkg.publishConfig.access, "public");
  assert.ok(pkg.keywords.includes("pi-package"));
  const result = spawnSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const [pack] = JSON.parse(result.stdout);
  const files = new Map<string, number>(pack.files.map((file: { path: string; mode: number }) => [file.path, file.mode]));
  for (const path of ["install.mjs", "package.json", "extensions/index.ts", "src/worker.ts", "web/app.js", "web/style.css", "skills/turing/SKILL.md", "LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    assert.ok(files.has(path), `Missing package file: ${path}`);
  }
  assert.ok(files.get("install.mjs")! & 0o111, "Installer must be executable");
  for (const path of files.keys()) {
    assert.doesNotMatch(path, /^(?:\.pi|\.github|\.hyperresearch|research|tests|scripts|node_modules|artifacts)\//);
  }
});
