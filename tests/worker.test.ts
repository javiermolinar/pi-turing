import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiWorkerDriver } from "../src/worker.ts";
import { fixture } from "./fixtures.ts";

test("real Pi SDK worker submits structured output without inheriting project tools/prompts", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "hpr-worker-"));
  mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(cwd, "AGENTS.md"), "SECRET_PROJECT_PROMPT_SHOULD_NOT_LOAD");
  writeFileSync(join(cwd, ".pi", "extensions", "bad.ts"), 'throw new Error("Project extension must not load");');
  let payload: any;
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    payload = JSON.parse(body);
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call1", type: "function", function: { name: "submit_result", arguments: JSON.stringify({ result: { answer: "ok" } }) } }] }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false });
    runtime.registerProvider("test", { baseUrl: `http://127.0.0.1:${address.port}/v1`, api: "openai-completions", apiKey: "test-key", models: [{
      id: "mock", name: "Mock", reasoning: false, input: ["text"], cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000,
    }] });
    const driver = new PiWorkerDriver(cwd, runtime);
    const state = fixture();
    assert.equal(await driver.checkModels(state), true);
    let tokens = 0, validations = 0;
    const result = await driver.run({ id: "test", role: "decompose", prompt: "Return answer ok.", resultSchema: z.object({ answer: z.string() }),
      async validateResult() { await new Promise(resolve => setTimeout(resolve, 10)); if (++validations === 1) throw new Error("Preserved-text verification rejected the first submission"); },
      tools: [], signal: AbortSignal.timeout(10_000), onActivity() {}, onTurn() {}, onUsage(t) { tokens += t; } }, state);
    assert.deepEqual(result, { answer: "ok" });
    assert.deepEqual(payload.tools.map((t: any) => t.function.name), ["submit_result"]);
    assert.ok(!JSON.stringify(payload).includes("SECRET_PROJECT_PROMPT_SHOULD_NOT_LOAD"));
    assert.equal(validations, 2);
    assert.match(JSON.stringify(payload), /Preserved-text verification rejected/);
    assert.equal(tokens, 40);
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(cwd, { recursive: true, force: true });
  }
});
