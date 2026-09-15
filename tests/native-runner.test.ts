import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeBackend } from "../src/backend.ts";
import { ResearchServices } from "../src/services.ts";
import { ResearchRunner } from "../src/runner.ts";
import { createLocation } from "../src/paths.ts";
import { configSchema } from "../src/types.ts";
import type { WorkerDriver } from "../src/worker.ts";
import { fixture } from "./fixtures.ts";

test("native light research pauses, resumes from disk, verifies and revises with no PATH executables", async () => {
  const root = mkdtempSync(join(tmpdir(), "hpr-native-runner-"));
  const oldPath = process.env.PATH;
  let runner: ResearchRunner | undefined; let pause = true; let acquired = 0;
  const location = createLocation(root, root);
  const backend = () => new ResearchServices(new NativeBackend(location.workspacePath, { metadataIntervalMs: 0, env: {}, request: async url => {
    acquired++;
    assert.equal(new URL(url).hostname, "example.org", "Fixture must never reach external metadata/search");
    return { url, contentType: "text/html", bytes: Buffer.from(`<html><head><title>Evidence report</title></head><body><article><h1>Evidence report</h1><p>${"Measured evidence supports this observed finding. ".repeat(250)}</p></article></body></html>`) };
  } }));
  const driver: WorkerDriver = {
    async checkModels() { return true; },
    async run(request, state) {
      request.onTurn(); request.onUsage(100, 0.01);
      if (request.role === "decompose") return { ...fixture().decomposition, required_section_headings: ["## Findings"] };
      if (request.role === "research") {
        const lane = request.id.endsWith("2") ? 0 : 5;
        for (let i = lane; i < lane + 5; i++) {
          let page = await request.tools.find(tool => tool.name === "fetch_source")!.execute({ url: `https://example.org/source-${i}` }, request.signal) as any;
          while (page.nextOffset !== null) page = await request.tools.find(tool => tool.name === "read_source")!.execute({ id: page.id, offset: page.nextOffset }, request.signal);
        }
        return { summary: "Read ten public sources", gaps: [] };
      }
      if (request.role === "draft") {
        for (const source of state.sources) {
          let offset = 0;
          while (true) {
            const page = await request.tools.find(tool => tool.name === "read_source")!.execute({ id: source.id, offset }, request.signal) as any;
            if (page.nextOffset === null) break;
            offset = page.nextOffset;
          }
        }
        const result = { markdown: "# Native report\n\n## Findings\n\n" + Array.from({ length: 100 }, (_, i) => `Measured evidence supports this observed finding. [[${state.sources[i % 10].id}]]`).join("\n\n") };
        await request.validateResult?.(result); return result;
      }
      return { summary: "No changes needed", edits: [] };
    },
  };
  try {
    process.env.PATH = "";
    runner = await ResearchRunner.create(root, "Compare the fixture evidence", configSchema.parse({ sourceTarget: 10 }), "fixture/mock", "off", backend(), driver,
      state => { if (pause && state.steps["2"] === "done") { pause = false; runner?.stop("paused"); } }, undefined, location);
    await runner.run(); assert.equal(runner.state.status, "paused", runner.state.reason); assert.equal(acquired, 10);
    const resumed = new ResearchRunner(root, runner.store.load(), backend(), driver);
    await resumed.run(); assert.equal(resumed.state.status, "done", resumed.state.reason);
    assert.equal(acquired, 10); assert.equal(resumed.state.sources.length, 10); assert.ok(resumed.state.checks.every(check => check.ok));
    assert.equal(existsSync(join(location.workspacePath, ".hyperresearch")), false);
    assert.equal(existsSync(join(location.workspacePath, "research")), false);
    const original = readFileSync(resumed.store.reportPath);
    const revised = await ResearchRunner.revise(root, resumed.state, "Clarify the findings", configSchema.parse({ sourceTarget: 10 }), "fixture/mock", "off", backend(), driver);
    await revised.run(); assert.equal(revised.state.status, "done", revised.state.reason);
    assert.equal(acquired, 10, "Revision reuses saved source bytes without fetching again");
    assert.deepEqual(readFileSync(resumed.store.reportPath), original); assert.equal(revised.state.revision?.parentTag, resumed.state.tag);
  } finally { if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; rmSync(root, { recursive: true, force: true }); }
});
