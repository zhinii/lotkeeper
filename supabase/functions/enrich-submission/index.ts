import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Enrichment = {
  description: string;
  category: string;
  keywords: string[];
  search_terms: string[];
  warnings: string[];
};

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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST")
    return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = supabaseServerKey();
  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !serviceKey || !openAiKey) {
    return response({ error: "Function secrets are incomplete" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  let submissionId = "";

  try {
    const payload = await request.json();
    submissionId = String(payload?.submission_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(submissionId)) {
      return response({ error: "A valid submission id is required" }, 400);
    }

    // Claiming a queued row makes enrichment idempotent and prevents repeat
    // API charges when a browser retries the same request.
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
          description_applied: Boolean(
            existing.ai_suggestions?.description_applied,
          ),
        });
      return response(
        { status: existing?.ai_status || "already_processed" },
        202,
      );
    }

    const { data: organization, error: orgError } = await admin
      .from("organizations")
      .select("ai_enabled")
      .eq("id", submission.organization_id)
      .single();
    if (orgError) throw orgError;
    if (!organization.ai_enabled || !submission.photo_path) {
      await admin
        .from("submissions")
        .update({ ai_status: "not_requested" })
        .eq("id", submissionId);
      return response({ status: "disabled" }, 202);
    }

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count } = await admin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", submission.organization_id)
      .gte("submitted_at", startOfDay.toISOString())
      .in("ai_status", ["processing", "complete"]);
    const dailyLimit = Number(Deno.env.get("AI_DAILY_LIMIT") || "50");
    if ((count || 0) > dailyLimit) {
      throw new Error("Daily image enrichment limit reached");
    }

    const { data: signed, error: signedError } = await admin.storage
      .from("submission-media")
      .createSignedUrl(submission.photo_path, 300);
    if (signedError) throw signedError;

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_VISION_MODEL") || "gpt-4o-mini",
        max_output_tokens: 350,
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Create neutral search metadata for a mapped civic or commercial record. The submitter called it "${String(submission.proposed?.name || "")}" and wrote "${String(submission.proposed?.description || "")}". Describe only what is visibly supported. Never identify a person, infer sensitive traits, read license plates, or make safety guarantees. Return a concise description, one broad category, 5-12 visible keywords, 3-8 alternate search terms, and any uncertainty warnings.`,
              },
              {
                type: "input_image",
                image_url: signed.signedUrl,
                detail: "low",
              },
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
                description: { type: "string" },
                category: { type: "string" },
                keywords: { type: "array", items: { type: "string" } },
                search_terms: { type: "array", items: { type: "string" } },
                warnings: { type: "array", items: { type: "string" } },
              },
              required: [
                "description",
                "category",
                "keywords",
                "search_terms",
                "warnings",
              ],
            },
          },
        },
      }),
    });
    const apiResult = await openAiResponse.json();
    if (!openAiResponse.ok) {
      throw new Error(apiResult?.error?.message || "Image enrichment failed");
    }
    const outputText = apiResult.output
      ?.flatMap((item: { content?: unknown[] }) => item.content || [])
      .find((item: { type?: string }) => item.type === "output_text")?.text;
    if (!outputText) throw new Error("Image enrichment returned no text");

    const enrichment = JSON.parse(outputText) as Enrichment;
    const keywords = [
      ...new Set([...enrichment.keywords, ...enrichment.search_terms]),
    ].slice(0, 16);
    const descriptionApplied = !String(
      submission.proposed?.description || "",
    ).trim();
    const suggestions = {
      ...enrichment,
      keywords,
      description_applied: descriptionApplied,
    };
    const { error: saveError } = await admin
      .from("submissions")
      .update({
        ai_status: "complete",
        ai_suggestions: suggestions,
        proposed: descriptionApplied
          ? { ...submission.proposed, description: enrichment.description }
          : submission.proposed,
      })
      .eq("id", submissionId);
    if (saveError) throw saveError;
    return response({
      status: "complete",
      suggestions,
      description_applied: descriptionApplied,
    });
  } catch (error) {
    const failureMessage = messageFrom(error);
    console.error("Image enrichment failed", failureMessage);
    if (submissionId) {
      await admin
        .from("submissions")
        .update({
          ai_status: "failed",
          ai_suggestions: {
            error: failureMessage,
          },
        })
        .eq("id", submissionId);
    }
    return response({ error: failureMessage }, 500);
  }
});
