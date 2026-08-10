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
    "ai_usage_events",
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
  assert.match(submit, /Place the item on the map before submitting/);
  assert.match(admin, /approve_submission/);
  assert.match(admin, /Delete from history/);
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
  const schema = await read("supabase/schema.sql");
  assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(edge, /SUPABASE_SECRET_KEYS/);
  assert.match(edge, /messageFrom/);
  assert.match(edge, /detail:\s*"low"/);
  assert.match(edge, /AI_DAILY_LIMIT/);
  assert.match(edge, /ai_usage_events/);
  assert.match(edge, /image_data_url/);
  assert.match(edge, /collection_id/);
  assert.match(edge, /gpt-4o-mini/);
  assert.match(client, /organization\.ai_enabled/);
  assert.match(
    schema,
    /grant select,update on public\.submissions to service_role/,
  );
});

test("admin onboarding exposes deployment type, fields and a clear empty state", async () => {
  const admin = await read("src/pages/AdminPage.tsx");
  assert.match(admin, /Create your first organization/);
  assert.match(admin, /No organization to configure/);
  assert.match(admin, /Civic · public places and contributions/);
  assert.match(admin, /Commercial · inventory, materials and equipment/);
  assert.match(admin, /value=\{createCollections\}/);
  assert.match(admin, /Map area/);
});

test("boundary drawing uses the current map tool and shows every point", async () => {
  const map = await read("src/components/MapView.tsx");
  const editor = await read("src/components/OrganizationMapEditor.tsx");
  assert.match(map, /interactionMode\.current\.boundaryEditor/);
  assert.match(map, /currentBoundary\.current/);
  assert.match(map, /type: "Point"/);
  assert.match(map, /type: "LineString"/);
  assert.match(map, /instance\.dragPan/);
  assert.match(map, /instance\.touchZoomRotate/);
  assert.match(map, /boundaryEditor \? control\?\.disable\(\)/);
  assert.match(editor, /Boundary drawing is active/);
  assert.match(editor, /map is locked while drawing/);
  assert.match(editor, /Add at least 3 points to form an area/);
});

test("public browsing is organization-first, mobile-friendly and map-linked", async () => {
  const home = await read("src/App.tsx");
  const directory = await read("src/pages/DirectoryPage.tsx");
  assert.doesNotMatch(home, /Search organizations/);
  assert.match(home, /organization-grid/);
  assert.match(directory, /collection-nav/);
  assert.match(directory, /record-grid/);
  assert.match(directory, /onSelect=\{openRecord\}/);
  assert.match(directory, /record-detail-sheet/);
  assert.match(directory, /floating-add/);
  assert.match(directory, /Add a photo/);
  assert.doesNotMatch(directory, /SEARCH RESULTS/);
});

test("manager console uses plain-language tasks and hides advanced setup", async () => {
  const admin = await read("src/pages/AdminPage.tsx");
  const collections = await read("src/components/CollectionEditor.tsx");
  const map = await read("src/components/OrganizationMapEditor.tsx");
  assert.match(admin, /What do you need to do\?/);
  assert.match(admin, /Review submissions/);
  assert.match(admin, /Manage items/);
  assert.match(admin, /Change organization settings/);
  assert.match(admin, /retryAi/);
  assert.match(collections, /Open to edit/);
  assert.match(collections, /Let visitors suggest new entries/);
  assert.match(map, /Exact map values/);
});

test("photo-first review uses consistent civic and commercial inventory fields", async () => {
  const submit = await read("src/pages/SubmitPage.tsx");
  const captureFields = await read("src/lib/captureFields.ts");
  const collections = await read("src/components/CollectionEditor.tsx");
  assert.match(submit, /Item name/);
  assert.match(submit, /First, take a photo/);
  assert.match(submit, /Check what Lotkeeper found/);
  assert.match(submit, /Filled from photo/);
  assert.match(submit, /Date of capture/);
  assert.match(submit, /GPS coordinates/);
  assert.match(submit, /organization\.mode === "commercial"/);
  assert.match(submit, /Quantity/);
  assert.match(submit, /quantity: quantity !== ""/);
  assert.match(captureFields, /SKU # \/ asset ID/);
  assert.match(captureFields, /Storage location \/ bin/);
  assert.match(captureFields, /Condition/);
  assert.match(captureFields, /Manufacturer \/ brand/);
  assert.match(captureFields, /Lot \/ serial number/);
  assert.match(collections, /included\s+automatically/);
  assert.match(submit, /without a new photo/);
});

test("submitters review AI and EXIF values before a locked confirmation", async () => {
  const submit = await read("src/pages/SubmitPage.tsx");
  const edge = await read("supabase/functions/enrich-submission/index.ts");
  assert.match(submit, /SUBMITTED/);
  assert.match(submit, /You\s+do not need to submit it again/);
  assert.match(submit, /Take a photo/);
  assert.match(submit, /Choose a photo/);
  assert.match(submit, /setStep\("review"\)/);
  assert.match(submit, /image_data_url/);
  assert.ok(
    submit.indexOf("image_data_url") < submit.indexOf('.from("submissions").insert'),
    "AI preview should happen before the final submission insert",
  );
  assert.match(edge, /Photo-first preview/);
  assert.match(edge, /store: false/);
});

test("Lotkeeper is installable while retaining the GitHub Pages website", async () => {
  const [html, main, manifest, worker] = await Promise.all([
    read("index.html"),
    read("src/main.tsx"),
    read("public/manifest.webmanifest"),
    read("public/sw.js"),
  ]);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(main, /serviceWorker\.register/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(worker, /lotkeeper-shell-v1/);
  assert.match(worker, /request\.mode === "navigate"/);
});
