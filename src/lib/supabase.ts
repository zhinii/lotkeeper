import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const configured = Boolean(url && key && !url.includes("YOUR-PROJECT"));
export const supabase = configured
  ? createClient(url!, key!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function requireSupabase() {
  if (!supabase)
    throw new Error(
      "Material Pin has not been connected to its Supabase project.",
    );
  return supabase;
}
export function publicPhoto(path: string | null) {
  if (!path || !supabase) return "";
  return supabase.storage.from("public-records").getPublicUrl(path).data
    .publicUrl;
}

export async function siteMapUrl(path: string | null) {
  if (!path || !supabase) return "";
  const { data, error } = await supabase.storage
    .from("site-maps")
    .createSignedUrl(path, 3600);
  if (error) return "";
  return data.signedUrl;
}

export async function throwIfError<
  T extends { error: { message: string } | null },
>(result: T) {
  if (result.error) throw new Error(result.error.message);
  return result;
}
