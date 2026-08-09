import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("builds a static GitHub Pages application", async () => {
  await access(new URL("../dist/index.html", import.meta.url));
  const [html, workflow, vite, packageJson] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(
      new URL("../.github/workflows/pages.yml", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(html, /assets\/index-/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(vite, /base:\s*"\.\/"/);
  assert.doesNotMatch(packageJson, /vinext|wrangler|cloudflare/i);
});

test("supports configurable instances and moderated public contributions", async () => {
  const [admin, contribution, schema] = await Promise.all([
    readFile(
      new URL("../src/components/AdminConsole.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/ContributionForm.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../supabase/lotkeeper-schema.sql", import.meta.url),
      "utf8",
    ),
  ]);
  assert.match(admin, /Create a new instance/);
  assert.match(admin, /Make.*private.*public/s);
  assert.match(contribution, /enableHighAccuracy:\s*true/);
  assert.match(contribution, /administrator review/);
  assert.match(schema, /enable row level security/);
  assert.match(schema, /submission-media/);
  assert.match(schema, /public-media/);
});

test("accepts empty successful Supabase responses", async () => {
  const client = await readFile(
    new URL("../src/lib/supabase.ts", import.meta.url),
    "utf8",
  );
  assert.match(client, /if \(!text\.trim\(\)\) return undefined/);
});
