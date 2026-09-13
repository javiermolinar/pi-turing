import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startDashboard } from "../src/server.ts";
import { fixture } from "./fixtures.ts";

async function raw(url: string, headers: Record<string, string>, method = "GET"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers, method }, res => { res.resume(); resolve(res.statusCode!); });
    req.on("error", reject); req.end();
  });
}
test("dashboard requires token and host, rejects cross-origin and writes, streams updates", async () => {
  const state = fixture(); const server = await startDashboard(state);
  try {
    const page = await fetch(server.url);
    assert.equal(page.status, 200); assert.match(await page.text(), /data-live="true"/);
    assert.equal((await fetch(new URL("/", server.url))).status, 404);
    assert.equal((await fetch(new URL("/wrong/", server.url))).status, 404);
    assert.equal(await raw(server.url, { Host: "attacker.test" }), 403);
    assert.equal(await raw(server.url, { Origin: "https://attacker.test" }), 403);
    assert.equal(await raw(server.url, {}, "POST"), 403);
    const abort = new AbortController();
    const stream = await fetch(new URL("events", server.url), { signal: abort.signal });
    const reader = stream.body!.getReader();
    const initial = new TextDecoder().decode((await reader.read()).value);
    assert.match(initial, /event: snapshot/); assert.match(initial, /SQLite/);
    state.reason = "new live finding"; server.publish(state);
    const next = new TextDecoder().decode((await reader.read()).value);
    assert.match(next, /new live finding/);
    abort.abort();
  } finally { await server.close(); await server.close(); }
});
