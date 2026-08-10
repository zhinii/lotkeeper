import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("GitHub Pages uses a relative asset base", async () => {
  const vite = await read("vite.config.ts");
  assert.match(vite, /base:\s*["']\.\/["']/);
});

test("the browser bundle contains no Page Steel database credentials", async () => {
  const files = await Promise.all([
    read("src/lib/supabase.ts"),
    read("src/App.tsx"),
    read(".env.example"),
  ]);
  const source = files.join("\n");
  assert.doesNotMatch(source, /mpgikhfsyfdntjjruzxc/);
  assert.doesNotMatch(source, /service_role|OPENAI_API_KEY\s*=/i);
  assert.match(source, /VITE_SUPABASE_URL/);
});

test("schema separates public and private record data and enables RLS", async () => {
  const schema = await read("supabase/schema.sql");
  for (const table of [
    "organizations",
    "platform_admins",
    "organization_members",
    "records",
    "record_private_data",
    "submissions",
    "inventory_transactions",
    "search_events",
    "alerts",
  ]) {
    assert.match(schema, new RegExp(`create table public\\.${table}`));
  }
  assert.match(
    schema,
    /alter table public\.record_private_data enable row level security/,
  );
  assert.match(schema, /create policy submissions_create/);
  assert.match(schema, /Platform administrator access required/);
  assert.match(schema, /create or replace function public\.approve_submission/);
});

test("public submission workflow requires mapped evidence and moderation", async () => {
  const submit = await read("src/pages/SubmitPage.tsx");
  const admin = await read("src/pages/AdminPage.tsx");
  assert.match(submit, /readGps/);
  assert.match(submit, /browser_gps/);
  assert.match(submit, /manual_pin/);
  assert.match(submit, /A mapped location is required/);
  assert.match(admin, /approve_submission/);
  assert.match(admin, /Delete submission/);
});

test("commercial use logs searches, inventory use and admin alerts", async () => {
  const directory = await read("src/pages/DirectoryPage.tsx");
  const schema = await read("supabase/schema.sql");
  assert.match(directory, /search_events/);
  assert.match(directory, /record_inventory_use/);
  assert.match(schema, /log_commercial_search/);
  assert.match(schema, /Inventory used:/);
});

test("image enrichment is server-side, optional and cost limited", async () => {
  const edge = await read("supabase/functions/enrich-submission/index.ts");
  const client = await read("src/pages/SubmitPage.tsx");
  assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(edge, /detail:\s*"low"/);
  assert.match(edge, /AI_DAILY_LIMIT/);
  assert.match(edge, /gpt-4o-mini/);
  assert.match(client, /organization\.ai_enabled/);
});

test("admin onboarding exposes deployment type, fields and a clear empty state", async () => {
  const admin = await read("src/pages/AdminPage.tsx");
  assert.match(admin, /Create your first organization/);
  assert.match(admin, /No organization to configure/);
  assert.match(admin, /Civic · public places and contributions/);
  assert.match(admin, /Commercial · inventory, materials and equipment/);
  assert.match(admin, /value=\{createCollections\}/);
  assert.match(admin, /Map and boundary/);
});
