import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server-renders the configurable public site", async () => {
  const workerUrl = new URL(`../dist/server/index.js?test=${Date.now()}`, import.meta.url);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Your Organization/);
  assert.match(html, /Community map/);
  assert.match(html, /Add something/);
});

test("public contributions require moderation, GPS, contact, D1, and R2", async () => {
  const [form, api, moderation, hosting] = await Promise.all([
    readFile(new URL("../app/contribute/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/contributions/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/ModerationQueue.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(form, /enableHighAccuracy:\s*true/);
  assert.match(form, /contactValue/);
  assert.match(form, /Send for administrator review/);
  assert.match(api, /status, submitted_at/);
  assert.match(api, /'pending'/);
  assert.match(moderation, /Approve/);
  assert.match(moderation, /Reject/);
  assert.match(hosting, /"d1":\s*"DB"/);
  assert.match(hosting, /"r2":\s*"MEDIA"/);
});
