import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startDashboard, startInventory } from "../src/server.ts";
import { createLocation } from "../src/paths.ts";
import { RunStore } from "../src/store.ts";
import { fixture } from "./fixtures.ts";

test("inventory and search filter every endpoint to the capability's authorized run set", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-web-scope-"));
  const allowed = fixture(); allowed.tag = "allowed"; allowed.location = createLocation(root, root); allowed.report = "Public needle";
  const secret = fixture(); secret.tag = "secret"; secret.query = "Confidential project"; secret.report = "Private needle";
  new RunStore(root, allowed.tag).save(allowed); new RunStore(root, secret.tag).save(secret);
  const server = await startInventory(root, new Set(["allowed"])); const single = await startDashboard(allowed, false);
  try {
    for (const instance of [server, single]) {
      const data = await (await fetch(new URL("runs", instance.url))).json();
      assert.deepEqual(data.runs.map((run: any) => run.tag), ["allowed"]);
      const search = await (await fetch(new URL("search?q=needle", instance.url))).json();
      assert.deepEqual(search.matches.map((match: any) => match.tag), ["allowed"]);
      assert.equal(search.scanned, 1);
      for (const path of ["run?id=secret", "events?run=secret", "markdown?id=secret", "html?id=secret", "run?id=..%2Fsecret", "../pi-state.json"]) assert.equal((await fetch(new URL(path, instance.url))).status, 404);
      assert.equal((await fetch(new URL("run?id=allowed", instance.url), { method: "POST" })).status, 403);
      assert.equal((await fetch(new URL("search?q=needle", instance.url), { headers: { origin: "https://evil.invalid" } })).status, 403);
    }
    allowed.report = "Updated from another runner"; new RunStore(root, allowed.tag).save(allowed);
    const external = await (await fetch(new URL("run?id=allowed", single.url))).json();
    assert.match(external.html, /Updated from another runner/); assert.match(external.html, /recorded running/);
    const exported = await fetch(new URL("markdown?id=allowed", server.url));
    assert.equal(exported.headers.get("content-disposition"), 'attachment; filename="allowed.md"');
    assert.match(await exported.text(), /UNVERIFIED DRAFT/);
    const page = await (await fetch(server.url)).text();
    assert.match(page, /src="app.js"/); assert.match(page, /href="style.css"/);
    assert.ok(!page.includes("Confidential")); assert.ok(!page.includes("@keyframes"));
    assert.equal((await fetch(new URL("app.js", server.url))).status, 200);
  } finally { await server.close(); await single.close(); rmSync(root, { recursive: true, force: true }); }
});
