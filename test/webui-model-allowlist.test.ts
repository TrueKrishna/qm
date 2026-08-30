import "./support/auto-fake-sprites.ts";

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createInsecureTestServer } from "../src/api/server.ts";
import { buildApp } from "../src/wiring.ts";
import { testConfig } from "./support/test-config.ts";

const ADMIN = { "content-type": "application/json", "x-admin-actor": "admin-alice@default-org" };

test("the org allowed-models list restricts the runtime-config picker and clearing restores the catalog", async () => {
  const modelCredentialFetch: typeof fetch = async () =>
    Response.json({
      data: [
        { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5", supported_parameters: ["tools"] },
        { id: "deepseek/deepseek-chat-v3.1", name: "DeepSeek: DeepSeek V3.1", supported_parameters: ["tools"] },
      ],
    });
  const built = buildApp(
    testConfig({
      dataDir: mkdtempSync(join(tmpdir(), "webui-model-allowlist-")),
      openrouterApiKey: "deployment-openrouter-key",
    }),
    { modelCredentialFetch },
  );
  const server = createInsecureTestServer(built.app, {
    config: built.config,
    modelCredentials: built.modelCredentials,
    modelCredentialFetch,
    harnessId: "pi",
    providerKeys: { anthropic: false, openai: false, openrouter: true },
    admin: built.admin,
    auditLog: built.auditLog,
  });
  server.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const runtimeModels = async (): Promise<string[]> => {
    const response = await fetch(`${base}/v1/runtime-config?principalId=alice&scopeId=personal%3Aalice`);
    assert.equal(response.status, 200);
    return ((await response.json()) as { modelsByHarness: Record<string, string[]> }).modelsByHarness.pi!;
  };
  try {
    const unrestricted = await runtimeModels();
    assert.ok(unrestricted.includes("anthropic/claude-sonnet-4.5"));
    assert.ok(unrestricted.includes("deepseek/deepseek-chat-v3.1"));

    const saved = await fetch(`${base}/v1/admin/scopes/org%3Adefault-org/webui-models`, {
      method: "PUT",
      headers: ADMIN,
      body: JSON.stringify({ ids: ["deepseek/deepseek-chat-v3.1", "openrouter/auto"] }),
    });
    assert.equal(saved.status, 200);

    assert.deepEqual(await runtimeModels(), ["deepseek/deepseek-chat-v3.1", "openrouter/auto"]);

    const cleared = await fetch(`${base}/v1/admin/scopes/org%3Adefault-org/webui-models`, {
      method: "PUT",
      headers: ADMIN,
      body: JSON.stringify({ ids: [] }),
    });
    assert.equal(cleared.status, 200);
    const restored = await runtimeModels();
    assert.ok(restored.includes("anthropic/claude-sonnet-4.5"));
    assert.ok(restored.includes("deepseek/deepseek-chat-v3.1"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("the deployment model allowlist hides, rejects, and ignores durable alternatives", async () => {
  const allowed = "deepseek/deepseek-chat-v3.1";
  const blocked = "anthropic/claude-sonnet-4.5";
  const modelCredentialFetch: typeof fetch = async () =>
    Response.json({
      data: [
        { id: allowed, name: "DeepSeek: DeepSeek V3.1", supported_parameters: ["tools"] },
        { id: blocked, name: "Anthropic: Claude Sonnet 4.5", supported_parameters: ["tools"] },
      ],
    });
  const config = testConfig({
    dataDir: mkdtempSync(join(tmpdir(), "deployment-model-allowlist-")),
    harness: "pi",
    modelId: allowed,
    modelAllowlist: [allowed],
    openrouterApiKey: "deployment-openrouter-key",
  });
  const built = buildApp(config, { modelCredentialFetch });
  built.config.setApprovedHarnesses(["mock", "pi"]);
  built.config.setBrowseModel("org:default-org", blocked);
  await built.config.setRuntimeSelectionLatest("org:default-org", { harnessId: "mock", modelId: allowed });
  await built.config.setRuntimeSelectionLatest("personal:alice", { harnessId: "pi", modelId: blocked });
  const server = createInsecureTestServer(built.app, {
    config: built.config,
    modelCredentials: built.modelCredentials,
    modelCredentialFetch,
    harnessId: "pi",
    baseModelDefault: allowed,
    modelAllowlist: [allowed],
    providerKeys: { anthropic: false, openai: false, openrouter: true },
    admin: built.admin,
    auditLog: built.auditLog,
  });
  server.listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  try {
    const runtime = await fetch(`${base}/v1/runtime-config?principalId=alice&scopeId=personal%3Aalice`);
    assert.equal(runtime.status, 200);
    const body = (await runtime.json()) as {
      modelsByHarness: Record<string, string[]>;
      orgDefault: { harnessId: string; modelId: string };
      scopeOverride: { harnessId: string; modelId: string } | null;
      effective: { harnessId: string; modelId: string };
    };
    assert.deepEqual(Object.keys(body.modelsByHarness), ["pi"]);
    assert.deepEqual(body.modelsByHarness.pi, [allowed]);
    assert.equal(body.orgDefault.harnessId, "pi");
    assert.equal(body.orgDefault.modelId, allowed);
    assert.equal(body.scopeOverride, null);
    assert.equal(body.effective.harnessId, "pi");
    assert.equal(body.effective.modelId, allowed);

    const governance = await fetch(`${base}/v1/admin/scopes/org%3Adefault-org`, { headers: ADMIN });
    assert.equal(governance.status, 200);
    const governanceBody = (await governance.json()) as {
      baseModelOptions: Array<{ id: string }>;
      approvedHarnesses: string[] | null;
      browseModel: string | null;
      harnessOptions: string[];
      runtime: { harnessId: string; modelId: string } | null;
      modelsByHarness: Record<string, Array<{ id: string }>>;
    };
    assert.deepEqual(
      governanceBody.baseModelOptions.map((model) => model.id),
      [allowed],
    );
    assert.deepEqual(governanceBody.approvedHarnesses, ["pi"]);
    assert.equal(governanceBody.browseModel, null);
    assert.deepEqual(governanceBody.harnessOptions, ["pi"]);
    assert.equal(governanceBody.runtime, null);
    assert.deepEqual(Object.keys(governanceBody.modelsByHarness), ["pi"]);
    assert.deepEqual(
      governanceBody.modelsByHarness.pi?.map((model) => model.id),
      [allowed],
    );

    for (const [resource, payload] of [
      ["base-model", { modelId: blocked }],
      ["runtime", { harnessId: "pi", modelId: blocked }],
      ["runtime", { harnessId: "mock", modelId: allowed }],
      ["approved-harnesses", { ids: ["mock"] }],
      ["browse-model", { modelId: blocked }],
      ["webui-models", { ids: [blocked] }],
    ] as const) {
      const rejected = await fetch(`${base}/v1/admin/scopes/org%3Adefault-org/${resource}`, {
        method: "PUT",
        headers: ADMIN,
        body: JSON.stringify(payload),
      });
      assert.equal(rejected.status, 400, resource);
      assert.match(JSON.stringify(await rejected.json()), /not enabled for this deployment/, resource);
    }

    const changed = await fetch(`${base}/v1/runtime-config?principalId=alice&scopeId=personal%3Aalice`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ harnessId: "pi", modelId: blocked }),
    });
    assert.equal(changed.status, 400);
    assert.deepEqual(await changed.json(), { error: "model_not_enabled" });

    const changedHarness = await fetch(`${base}/v1/runtime-config?principalId=alice&scopeId=personal%3Aalice`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ harnessId: "mock", modelId: allowed }),
    });
    assert.equal(changedHarness.status, 400);
    assert.deepEqual(await changedHarness.json(), { error: "harness_not_approved" });

    const turn = await built.app.turn({
      surface: "web",
      actor: { externalId: "alice" },
      conversation: { kind: "dm", threadRef: "web:alice:deployment-model-lock" },
      text: "hello",
      model: blocked,
      async: true,
    });
    assert.equal(turn.status, "refused");
    assert.match(turn.reason ?? "", /not enabled for this deployment/);

    const alternateHarnessTurn = await built.app.turn({
      surface: "web",
      actor: { externalId: "alice" },
      conversation: { kind: "dm", threadRef: "web:alice:deployment-harness-lock" },
      text: "hello",
      harness: "mock",
      model: allowed,
      async: true,
    });
    assert.equal(alternateHarnessTurn.status, "refused");
    assert.match(alternateHarnessTurn.reason ?? "", /not enabled for this deployment/);

    assert.equal((await built.slackCore.surfaceHeaderFacts("personal:alice")).modelName, allowed);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
