import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const upstream = createServer((req: IncomingMessage, res) => {
  if (req.url === "/api/whoami") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ isAdmin: true }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ url: req.url }));
});
await new Promise<void>((resolve) => upstream.listen(0, resolve));
const upstreamUrl = `http://localhost:${(upstream.address() as AddressInfo).port}`;

process.env.PORTAL_PUBLIC_URL = "http://portal.test";
process.env.PORTAL_SESSION_SECRET = "external-execution-portal-secret";
process.env.CORE_SIGNING_SECRET = "external-execution-core-secret";
process.env.WEB_UI_UPSTREAM = upstreamUrl;
process.env.ADMIN_UPSTREAM = upstreamUrl;
process.env.CORE_API_URL = upstreamUrl;
process.env.EXTERNAL_EXECUTION_URL = "/programme";
process.env.EXTERNAL_EXECUTION_LABEL = "BBG Workbench";

const { server } = await import("../src/index.ts");
const { deriveKey, seal } = await import("../src/session.ts");
await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const sessionKey = deriveKey("external-execution-portal-secret", "portal.session.v1");
const issuedAt = Math.floor(Date.now() / 1000);
const cookie = `portal_session=${encodeURIComponent(seal({ k: "session", sub: "U-admin", org: "acme", iat: issuedAt, exp: issuedAt + 28800 }, sessionKey))}`;

test.after(() => {
  server.close();
  upstream.close();
});

test("external execution mode replaces the assistant with an explicit workbench handoff", async () => {
  const response = await fetch(`${base}/`, { headers: { accept: "text/html", cookie }, redirect: "manual" });
  assert.equal(response.status, 503);
  const html = await response.text();
  assert.match(html, /BBG Workbench/);
  assert.match(html, /execution happens on the enrolled BBG Workbench/i);
  assert.match(html, /href="\/programme"/);
  assert.doesNotMatch(html, /add(?:ing)? a model API key/i);
});

test("external execution mode refuses model turn APIs instead of returning canned responses", async () => {
  const response = await fetch(`${base}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie, origin: "http://portal.test" },
    body: "{}",
  });
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "external_execution",
    message: "Assistant execution happens on the enrolled BBG Workbench.",
    url: "/programme",
  });
});
