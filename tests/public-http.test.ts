import { test } from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "undici";
import { createPublicRequest, publicAddress, publicLookup, publicUrl } from "../src/public-http.ts";

test("source URL and IP validation rejects private, mapped, metadata and credential-bearing targets", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "64:ff9b::127.0.0.1"]) assert.equal(publicAddress(address), false, address);
  for (const url of ["file:///etc/passwd", "http://user:secret@example.org", "http://localhost", "http://api.localhost", "http://metadata.internal", "http://127.1", "http://2130706433", "http://[::ffff:127.0.0.1]", "http://0x7f000001"]) assert.throws(() => publicUrl(url), url);
  assert.equal(publicAddress("8.8.8.8"), true); assert.equal(publicAddress("2606:4700:4700::1111"), true);
  assert.equal(publicUrl("https://example.org/article#section").href, "https://example.org/article");
});

test("socket DNS lookup rejects mixed/private resolutions and revalidates every connection", async () => {
  let calls = 0;
  const resolver = publicLookup((async () => {
    calls++;
    return calls === 1 ? [{ address: "8.8.8.8", family: 4 }] : [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }];
  }) as any);
  const resolve = () => new Promise((yes, no) => resolver("example.org", { family: 4, hints: 0 }, (error, address) => error ? no(error) : yes(address)));
  assert.equal(await resolve(), "8.8.8.8"); await assert.rejects(resolve(), /DNS lookup failed/);
});

function mock() {
  const agent = new MockAgent(); agent.disableNetConnect();
  // MockAgent implements close(), but its inherited destroy() is abstract.
  agent.destroy = (() => agent.close()) as typeof agent.destroy;
  return { agent, pool: agent.get("https://example.org"), request: createPublicRequest(() => agent) };
}

test("public acquisition follows bounded public redirects without carrying cookies", async () => {
  const env = mock();
  env.pool.intercept({ path: "/start" }).reply(302, "", { headers: { location: "/article", "set-cookie": "private=session" } });
  env.pool.intercept({ path: "/article", headers: headers => !headers.cookie && !headers.authorization }).reply(200, "public evidence", { headers: { "content-type": "text/plain" } });
  const result = await env.request("https://example.org/start");
  assert.equal(result.url, "https://example.org/article"); assert.equal(Buffer.from(result.bytes).toString(), "public evidence");
});

test("private redirect targets, metadata redirects and oversized bodies fail closed", async () => {
  const privateRedirect = mock();
  privateRedirect.pool.intercept({ path: "/private" }).reply(302, "", { headers: { location: "http://169.254.169.254/latest/meta-data" } });
  await assert.rejects(privateRedirect.request("https://example.org/private"), /Only public/);
  const credentialRedirect = mock();
  credentialRedirect.pool.intercept({ path: "/metadata" }).reply(302, "", { headers: { location: "https://elsewhere.example" } });
  await assert.rejects(credentialRedirect.request("https://example.org/metadata", { redirects: false, headers: { Authorization: "Bearer private" } }), /redirect refused/);
  const oversized = mock();
  oversized.pool.intercept({ path: "/large" }).reply(200, "0123456789");
  await assert.rejects(oversized.request("https://example.org/large", { maxBytes: 5 }), /byte limit/);
  const declaredSize = mock();
  declaredSize.pool.intercept({ path: "/large" }).reply(200, "small", { headers: { "content-length": "10000" } });
  await assert.rejects(declaredSize.request("https://example.org/large", { maxBytes: 5 }), /byte limit/);
});

test("cancelled public requests do not reach a transport", async () => {
  const env = mock(); const controller = new AbortController(); controller.abort();
  await assert.rejects(env.request("https://example.org/no", { signal: controller.signal }));
});
