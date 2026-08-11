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

test("Material Pin logs public searches and accountable inventory use", async () => {
  const directory = await read("src/pages/DirectoryPage.tsx");
  const schema = await read("supabase/schema.sql");
  assert.match(directory, /log_material_search/);
  assert.match(directory, /search_mode: true/);
  assert.match(directory, /record_inventory_use/);
  assert.match(
    schema,
    /create or replace function public\.log_material_search/,
  );
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
  assert.match(edge, /ai_catalog_context/);
  assert.match(edge, /relevance filter only/);
  assert.match(edge, /must never rename, replace, or force/);
  assert.match(edge, /visible laptop remains a laptop/);
  assert.match(edge, /catalog_match/);
  assert.match(edge, /gpt-4o-mini/);
  assert.match(client, /organization\.ai_enabled/);
  assert.match(
    schema,
    /grant select,update on public\.submissions to service_role/,
  );
});

test("admin onboarding uses the single Material Pin model", async () => {
  const admin = await read("src/pages/AdminPage.tsx");
  assert.match(admin, /Create your first organization/);
  assert.match(admin, /No organization to configure/);
  assert.match(admin, /Material Pin manages inventory/);
  assert.match(admin, /AI catalog guide/);
  assert.doesNotMatch(admin, /Civic ·|Commercial ·/);
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
  assert.match(map, /Number\.isFinite\(numericLatitude\)/);
  assert.match(map, /recordLatitude < -90/);
  assert.match(map, /boundaryEditor \? control\?\.disable\(\)/);
  assert.match(editor, /Boundary drawing is active/);
  assert.match(editor, /map is locked while drawing/);
  assert.match(editor, /Add at least 3 points to form an area/);
});

test("public browsing combines image, text and filter search with the map", async () => {
  const home = await read("src/App.tsx");
  const directory = await read("src/pages/DirectoryPage.tsx");
  const styles = await read("src/styles.css");
  assert.doesNotMatch(home, /Search organizations/);
  assert.match(home, /organization-grid/);
  assert.match(directory, /material-search-panel/);
  assert.match(directory, /Search with a photo/);
  assert.match(directory, /Availability/);
  assert.match(directory, /Named location/);
  assert.match(directory, /onSelect=\{openRecord\}/);
  assert.match(directory, /record-detail-sheet/);
  assert.match(directory, /Employee sign in/);
  assert.match(directory, /Employee workspace/);
  assert.match(directory, /Admin console/);
  assert.match(directory, /className="floating-add"/);
  assert.match(directory, /<strong>Add item<\/strong>/);
  assert.match(directory, /pins"\} shown|pins.*shown/s);
  assert.match(styles, /\.material-map-panel \.map-count[\s\S]*bottom:\s*auto/);
  assert.match(styles, /\.directory-employee\.active/);
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
  assert.doesNotMatch(collections, /Let visitors suggest new entries/);
  assert.match(map, /Exact map values/);
});

test("organization admins can manage employee access and owners can delete deployments", async () => {
  const admin = await read("src/pages/AdminPage.tsx");
  const staff = await read("src/pages/StaffPage.tsx");
  const manager = await read("supabase/functions/manage-organization/index.ts");
  assert.match(admin, /Employees and administrators/);
  assert.match(admin, /Create or assign login/);
  assert.match(admin, /Delete this organization/);
  assert.match(admin, /No database work is required/);
  assert.match(staff, /Change my password/);
  assert.match(manager, /action === "create_employee"/);
  assert.match(manager, /action === "remove_member"/);
  assert.match(manager, /action === "delete_organization"/);
  assert.match(manager, /organization owner or platform administrator/);
  assert.match(manager, /storage[\s\S]*submission-media/);
  assert.match(manager, /storage[\s\S]*public-records/);
  const permissions = await read(
    "supabase/migrations/20260810_organization_management_permissions.sql",
  );
  assert.match(permissions, /organizations to service_role/);
  assert.match(permissions, /organization_members to service_role/);
  assert.match(permissions, /platform_admins to service_role/);
});

test("employee photo review uses consistent inventory fields and visibility", async () => {
  const submit = await read("src/pages/SubmitPage.tsx");
  const captureFields = await read("src/lib/captureFields.ts");
  const collections = await read("src/components/CollectionEditor.tsx");
  assert.match(submit, /Item name/);
  assert.match(submit, /First, take a photo/);
  assert.match(submit, /Filled from photo/);
  assert.match(submit, /Filled from photo/);
  assert.match(submit, /Date of capture/);
  assert.match(submit, /GPS coordinates/);
  assert.match(submit, /publicVisible/);
  assert.match(submit, /Show this item on the public site/);
  assert.match(submit, /Quantity/);
  assert.match(submit, /collection\.kind !== "place"/);
  assert.match(captureFields, /SKU \/ asset ID/);
  assert.match(captureFields, /Storage location \/ bin/);
  assert.match(captureFields, /Condition/);
  assert.match(captureFields, /Manufacturer \/ brand/);
  assert.match(captureFields, /Lot \/ serial number/);
  assert.match(collections, /Leave them optional unless/);
  assert.match(collections, /Required/);
  assert.doesNotMatch(collections, /Identifier/);
  assert.doesNotMatch(collections, /Last verified/);
  assert.match(submit, /inventoryFieldRequired/);
  assert.match(submit, /without a new photo/);
});

test("submitters review AI and EXIF values before a locked confirmation", async () => {
  const submit = await read("src/pages/SubmitPage.tsx");
  const cropper = await read("src/components/PhotoCropper.tsx");
  const edge = await read("supabase/functions/enrich-submission/index.ts");
  assert.match(submit, /SUBMITTED/);
  assert.match(submit, /You\s+do\s+not\s+need\s+to\s+submit\s+it\s+again/);
  assert.match(submit, /Take a photo/);
  assert.match(submit, /Choose a photo/);
  assert.match(submit, /setStep\("review"\)/);
  assert.match(submit, /image_data_url/);
  assert.match(submit, /prepareSubmissionPhoto/);
  assert.match(submit, /"photo" \| "crop" \| "review" \| "complete"/);
  assert.match(submit, /await cropPhoto\(sourcePhoto, crop\)/);
  assert.match(
    submit,
    /Only the area inside the frame will be analyzed and saved/,
  );
  assert.match(submit, /Use this crop/);
  assert.match(cropper, /canvas\.toBlob/);
  assert.match(cropper, /Cropped photo preview/);
  assert.match(cropper, /onPointerMove/);
  assert.match(cropper, /Pinch with two fingers to zoom/);
  assert.match(cropper, /touchZoom|distance \/ gesture\.current\.distance/);
  assert.match(cropper, /createImageBitmap cannot decode/);
  assert.match(cropper, /drawable\.current/);
  assert.match(cropper, /context\.drawImage/);
  assert.match(cropper, /This photo cannot be opened/);
  assert.match(submit, /disabled=\{preparing \|\| !cropReady\}/);
  assert.match(submit, /normalizeCollections/);
  assert.match(submit, /validCoordinate\(coordinates\?\.latitude, -90, 90\)/);
  assert.match(
    submit,
    /validCoordinate\(coordinates\?\.longitude, -180, 180\)/,
  );
  assert.match(submit, /metadata\?\.GPSLatitude/);
  assert.match(submit, /metadata\?\.GPSLongitude/);
  assert.match(submit, /function exifCoordinate/);
  assert.match(submit, /safeWarnings/);
  const cropStart = submit.indexOf("async function confirmCrop");
  const cropCall = submit.indexOf("await cropPhoto", cropStart);
  const aiCall = submit.indexOf("await analyzeSelectedPhoto", cropCall);
  assert.ok(cropStart < cropCall && cropCall < aiCall);
  assert.match(submit, /maximum = 1920/);
  assert.match(submit, /preparedPhoto!\.upload/);
  assert.match(submit, /Optimized for faster upload/);
  assert.ok(
    submit.indexOf("image_data_url") <
      submit.indexOf('.from("submissions").insert'),
    "AI preview should happen before the final submission insert",
  );
  assert.match(edge, /Photo-first preview/);
  assert.match(edge, /store: false/);
});

test("Material Pin is installable while retaining the GitHub Pages website", async () => {
  const [html, main, boundary, manifest, worker] = await Promise.all([
    read("index.html"),
    read("src/main.tsx"),
    read("src/components/AppErrorBoundary.tsx"),
    read("public/manifest.webmanifest"),
    read("public/sw.js"),
  ]);
  assert.match(html, /manifest\.webmanifest/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(main, /serviceWorker\.register/);
  assert.match(main, /AppErrorBoundary/);
  assert.match(boundary, /This screen could not open/);
  assert.match(boundary, /Your photo was not submitted/);
  assert.match(boundary, /app-error-detail/);
  assert.match(manifest, /"display": "standalone"/);
  assert.match(manifest, /"name": "Material Pin"/);
  assert.match(manifest, /icon-192\.png/);
  assert.match(manifest, /icon-512\.png/);
  assert.match(worker, /material-pin-shell-v6/);
  assert.match(worker, /request\.mode === "navigate"/);
});
