import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type SuggestedField = { key: string; value: string };

type Enrichment = {
  name: string;
  collection_id: string;
  catalog_match: boolean;
  description: string;
  category: string;
  quantity: string;
  unit: string;
  keywords: string[];
  search_terms: string[];
  fields: SuggestedField[];
  warnings: string[];
};

type OrganizationContext = {
  id: string;
  mode: "material" | "civic" | "commercial";
  ai_enabled: boolean;
  ai_catalog_context: string;
  collections: Array<{
    id: string;
    name: string;
    kind?: "place" | "persistent" | "consumable";
    publicVisible?: boolean;
    publicSubmit?: boolean;
    fields?: Array<{ key: string; label: string; required?: boolean }>;
  }>;
};

const duplicateFieldKeys = new Set(["identifier", "verified_date"]);

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function messageFrom(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code]
      .filter(Boolean)
      .map(String)
      .join(" · ");
  }
  return String(error || "Unknown error");
}

function findModernSecret(value: unknown): string | null {
  if (typeof value === "string" && value.startsWith("sb_secret_")) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findModernSecret(item);
      if (match) return match;
    }
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) {
      const match = findModernSecret(item);
      if (match) return match;
    }
  }
  return null;
}

function supabaseServerKey() {
  const modernSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modernSecrets) {
    try {
      const key = findModernSecret(JSON.parse(modernSecrets));
      if (key) return key;
    } catch {
      // Fall through to the legacy service-role key on older projects.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function visibleCollections(
  organization: OrganizationContext,
  publicSearch = false,
) {
  return publicSearch
    ? organization.collections.filter((collection) => collection.publicVisible)
    : organization.collections;
}

function promptFor(
  organization: OrganizationContext,
  proposed?: Record<string, unknown>,
  publicSearch = false,
) {
  const collections = visibleCollections(organization, publicSearch).map(
    (collection) => {
      const configured = (collection.fields || []).filter(
        (field) => !duplicateFieldKeys.has(field.key),
      );
      return {
        id: collection.id,
        label: collection.name,
        kind: collection.kind || "persistent",
        fields: configured,
      };
    },
  );
  const existing = proposed
    ? `Existing user-entered values, which may be incomplete: ${JSON.stringify({
        name: proposed.name,
        description: proposed.description,
      })}.`
    : "The user has not entered any descriptive values yet.";

  const catalogGuide = organization.ai_catalog_context?.trim()
    ? organization.ai_catalog_context.slice(0, 4000)
    : "No organization-specific catalog guide was provided.";

  if (publicSearch) {
    const collectionIds = collections.map((collection) => collection.id);
    return `Convert a search photo into short, neutral text that can be compared with a Material Pin catalog.
FIRST identify the main visible object from the pixels alone. Use ordinary, generic language and visible text. Do not use the organization context, collection names, or expected inventory to decide what the object is.
Only after identifying it, use this organization context to decide whether it is plausibly relevant: ${catalogGuide}
The organization context is a relevance filter only. It may cull irrelevant alternate terms. It must never rename, replace, or force the observed object into the organization's vocabulary. For example, a visible laptop remains a laptop even in a steel catalog; never call it a beam, plate, pipe, or metal inventory.
Set catalog_match false when the visible subject is not a plausible catalog item. Still return honest generic name, description, category, keywords, and alternate search terms so the catalog can return zero results naturally. Set fields, quantity and unit to empty values. Choose one collection_id from this technical list, even when catalog_match is false: ${JSON.stringify(collectionIds)}.
Return a short plain-language name, one factual sentence, one broad category, 4-8 visible keywords, and 2-5 common alternate search terms. Read clearly visible brand or product text, but do not guess missing characters. Do not invent identifiers, measurements, ownership, condition, or hazards. Never identify a person, infer sensitive traits, transcribe license plates, or make safety guarantees.`;
  }

  return `Prepare editable metadata for a Material Pin item-capture photo. ${existing}
First identify the visible object from the pixels. Then use this organization-specific catalog guide to select precise industry terminology, remove irrelevant alternatives, and populate supported fields: ${catalogGuide}
The guide may refine an accurate identification, but it must not force a conflicting identity or invent attributes. Set catalog_match false if the visible object does not plausibly belong in this catalog; the employee can still correct it before submitting.
Available collections and their exact configured fields are data labels only: ${JSON.stringify(collections)}.
Choose exactly one collection_id from that list. Write a short, plain-language item name and a concise factual description. Choose one broad category, 5-12 visible keywords, and 3-8 alternate terms a person might use to find this item. Read useful product labels, part numbers, and SKU-like text when clearly visible and place them in the closest supported field; do not guess missing characters. Return a visible quantity only when it can reasonably be counted; otherwise return quantity as "1". Return a short unit such as pieces, feet, cases or vehicles when it is reasonably implied; otherwise return an empty unit. Return one fields entry for every configured field in the chosen collection, using its exact key and an empty value when the photo does not support a value. A field marked required still must remain empty when it cannot be determined from the photo—the employee will complete it. Do not invent SKUs, serial numbers, conditions, measurements, ownership, or hazards. Never identify a person, infer sensitive traits, transcribe license plates, or make safety guarantees. Put uncertainty that a reviewer should check in warnings.`;
}

function completeConfiguredFields(
  organization: OrganizationContext,
  enrichment: Enrichment,
) {
  const collection = organization.collections.find(
    (item) => item.id === enrichment.collection_id,
  );
  if (!collection) return enrichment;
  const suggested = new Map(
    (enrichment.fields || []).map((field) => [field.key, field.value]),
  );
  return {
    ...enrichment,
    fields: (collection.fields || [])
      .filter(
        (field) =>
          !duplicateFieldKeys.has(field.key) &&
          field.key !== "quantity" &&
          field.key !== "unit",
      )
      .map((field) => ({
        key: field.key,
        value: suggested.get(field.key) || "",
      })),
  };
}

async function reserveUsage(
  admin: ReturnType<typeof createClient>,
  organizationId: string,
  purpose: "preview" | "submission" | "search",
  submissionId: string | null,
) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error } = await admin
    .from("ai_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", startOfDay.toISOString());
  if (error) throw error;
  const dailyLimit = Number(Deno.env.get("AI_DAILY_LIMIT") || "50");
  if ((count || 0) >= dailyLimit)
    throw new Error("Daily photo suggestion limit reached");
  const { error: insertError } = await admin.from("ai_usage_events").insert({
    organization_id: organizationId,
    submission_id: submissionId,
    purpose,
  });
  if (insertError) throw insertError;
}

async function runVision(openAiKey: string, imageUrl: string, prompt: string) {
  const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openAiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_VISION_MODEL") || "gpt-4o-mini",
      max_output_tokens: 550,
      store: false,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl, detail: "low" },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "lotkeeper_image_metadata",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: "string" },
              collection_id: { type: "string" },
              catalog_match: { type: "boolean" },
              description: { type: "string" },
              category: { type: "string" },
              quantity: { type: "string" },
              unit: { type: "string" },
              keywords: { type: "array", items: { type: "string" } },
              search_terms: { type: "array", items: { type: "string" } },
              fields: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string" },
                    value: { type: "string" },
                  },
                  required: ["key", "value"],
                },
              },
              warnings: { type: "array", items: { type: "string" } },
            },
            required: [
              "name",
              "collection_id",
              "catalog_match",
              "description",
              "category",
              "quantity",
              "unit",
              "keywords",
              "search_terms",
              "fields",
              "warnings",
            ],
          },
        },
      },
    }),
  });
  const apiResult = await openAiResponse.json();
  if (!openAiResponse.ok)
    throw new Error(apiResult?.error?.message || "Image enrichment failed");
  const outputText = apiResult.output
    ?.flatMap((item: { content?: unknown[] }) => item.content || [])
    .find((item: { type?: string }) => item.type === "output_text")?.text;
  if (!outputText) throw new Error("Image enrichment returned no text");
  const enrichment = JSON.parse(outputText) as Enrichment;
  return {
    ...enrichment,
    keywords: [
      ...new Set([...enrichment.keywords, ...enrichment.search_terms]),
    ].slice(0, 16),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = supabaseServerKey();
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceKey || !openAiKey)
    return response({ error: "Function secrets are incomplete" }, 500);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  let submissionId = "";

  try {
    const payload = await request.json();
    submissionId = String(payload?.submission_id || "");

    // Photo-first preview: analyze a small browser-compressed copy before the
    // user confirms anything. The original image is uploaded only on submit.
    if (!submissionId) {
      const organizationId = String(payload?.organization_id || "");
      const imageDataUrl = String(payload?.image_data_url || "");
      const searchMode = payload?.search_mode === true;
      if (!/^[0-9a-f-]{36}$/i.test(organizationId))
        return response({ error: "A valid organization id is required" }, 400);
      if (
        !/^data:image\/(jpeg|png|webp);base64,/i.test(imageDataUrl) ||
        imageDataUrl.length > 6_000_000
      )
        return response(
          { error: "A supported compressed image is required" },
          400,
        );

      const { data: organization, error: orgError } = await admin
        .from("organizations")
        .select("id,mode,ai_enabled,ai_catalog_context,collections")
        .eq("id", organizationId)
        .single();
      if (orgError) throw orgError;
      const context = organization as OrganizationContext;
      if (!context.ai_enabled) return response({ status: "disabled" }, 202);
      if (!visibleCollections(context, searchMode).length)
        return response(
          { error: "No submission collections are available" },
          400,
        );

      await reserveUsage(
        admin,
        organizationId,
        searchMode ? "search" : "preview",
        null,
      );
      let suggestions = await runVision(
        openAiKey,
        imageDataUrl,
        promptFor(context, undefined, searchMode),
      );
      if (
        !visibleCollections(context, searchMode).some(
          (item) => item.id === suggestions.collection_id,
        )
      )
        suggestions.collection_id = visibleCollections(
          context,
          searchMode,
        )[0].id;
      suggestions = completeConfiguredFields(context, suggestions);
      return response({ status: "complete", suggestions });
    }

    if (!/^[0-9a-f-]{36}$/i.test(submissionId))
      return response({ error: "A valid submission id is required" }, 400);

    // Existing administrator retry path remains idempotent.
    const { data: submission, error: claimError } = await admin
      .from("submissions")
      .update({ ai_status: "processing" })
      .eq("id", submissionId)
      .eq("status", "pending")
      .eq("ai_status", "queued")
      .select("id,organization_id,photo_path,proposed")
      .maybeSingle();
    if (claimError) throw claimError;
    if (!submission) {
      const { data: existing, error: existingError } = await admin
        .from("submissions")
        .select("ai_status,ai_suggestions")
        .eq("id", submissionId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing?.ai_status === "complete")
        return response({
          status: "complete",
          suggestions: existing.ai_suggestions,
        });
      return response(
        { status: existing?.ai_status || "already_processed" },
        202,
      );
    }

    const { data: organization, error: orgError } = await admin
      .from("organizations")
      .select("id,mode,ai_enabled,ai_catalog_context,collections")
      .eq("id", submission.organization_id)
      .single();
    if (orgError) throw orgError;
    const context = organization as OrganizationContext;
    if (!context.ai_enabled || !submission.photo_path) {
      await admin
        .from("submissions")
        .update({ ai_status: "not_requested" })
        .eq("id", submissionId);
      return response({ status: "disabled" }, 202);
    }

    await reserveUsage(admin, context.id, "submission", submissionId);
    const { data: signed, error: signedError } = await admin.storage
      .from("submission-media")
      .createSignedUrl(submission.photo_path, 300);
    if (signedError) throw signedError;
    let suggestions = await runVision(
      openAiKey,
      signed.signedUrl,
      promptFor(context, submission.proposed),
    );
    if (
      !visibleCollections(context).some(
        (item) => item.id === suggestions.collection_id,
      )
    )
      suggestions.collection_id =
        submission.proposed?.collection_id ||
        visibleCollections(context)[0]?.id ||
        "";
    suggestions = completeConfiguredFields(context, suggestions);
    const descriptionApplied = !String(
      submission.proposed?.description || "",
    ).trim();
    const storedSuggestions = {
      ...suggestions,
      description_applied: descriptionApplied,
    };
    const { error: saveError } = await admin
      .from("submissions")
      .update({
        ai_status: "complete",
        ai_suggestions: storedSuggestions,
        proposed: descriptionApplied
          ? { ...submission.proposed, description: suggestions.description }
          : submission.proposed,
      })
      .eq("id", submissionId);
    if (saveError) throw saveError;
    return response({ status: "complete", suggestions: storedSuggestions });
  } catch (error) {
    const failureMessage = messageFrom(error);
    console.error("Image enrichment failed", failureMessage);
    if (submissionId) {
      await admin
        .from("submissions")
        .update({
          ai_status: "failed",
          ai_suggestions: { error: failureMessage },
        })
        .eq("id", submissionId);
    }
    return response({ error: failureMessage }, 500);
  }
});
