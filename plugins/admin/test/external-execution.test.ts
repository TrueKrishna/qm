import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

const core = createServer((req: IncomingMessage, res) => {
  if ((req.url ?? "").startsWith("/v1/surface-config")) {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ branding: { selfLabel: "QM" } }));
  }
  res.writeHead(404).end();
});
await new Promise<void>((resolve) => core.listen(0, resolve));

process.env.CORE_API_URL = `http://localhost:${(core.address() as AddressInfo).port}`;
process.env.CORE_SIGNING_SECRET = "external-execution-admin-secret";
process.env.EXTERNAL_EXECUTION_URL = "/programme";
process.env.EXTERNAL_EXECUTION_LABEL = "BBG Workbench";

const { server } = await import("../src/index.ts");
await new Promise<void>((resolve) => server.listen(0, resolve));
const base = `http://localhost:${(server.address() as AddressInfo).port}`;

test.after(() => {
  server.close();
  core.close();
});

test("admin onboarding presents external execution and hides provider controls", async () => {
  const html = await (await fetch(`${base}/onboarding`)).text();
  assert.match(html, /BBG Workbench/);
  assert.match(html, /execution happens on this enrolled workbench/i);
  assert.match(html, /const EXTERNAL_EXECUTION = \{"url":"\/programme","label":"BBG Workbench"\}/);
  assert.match(html, /onboarding-base-model"\)\.classList\.add\("hidden"\)/);
  assert.match(html, /onboarding-custom-providers"\)\.classList\.add\("hidden"\)/);
  assert.match(html, /id="onboarding-slack-create"/);
  assert.match(html, /Configure OAuth apps/);
});
