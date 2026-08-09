import type { Session } from "../types";

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://mpgikhfsyfdntjjruzxc.supabase.co";
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Tp6oGQM9k7C022UwKKTRWA_JvVuh1Dl";
const SESSION_KEY = "lotkeeper-supabase-session";

export function getSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

function authHeaders(json = true) {
  const session = getSession();
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}`,
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

export async function signIn(email: string, password: string) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.msg || "Sign-in failed.");
  localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  return data as Session;
}

export function signOut() { localStorage.removeItem(SESSION_KEY); }

export async function db<T>(table: string, query = "", options: { method?: string; body?: unknown; prefer?: string } = {}): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method: options.method || "GET",
    headers: { ...authHeaders(), ...(options.prefer ? { Prefer: options.prefer } : {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok) { const detail = await response.text(); throw new Error(detail || `Database request failed (${response.status}).`); }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export async function upload(bucket: string, path: string, file: Blob) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`, { method: "POST", headers: { ...authHeaders(false), "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" }, body: file });
  if (!response.ok) throw new Error(await response.text());
  return path;
}

export async function signedUrl(bucket: string, path: string, expiresIn = 900) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${bucket}/${path}`, { method: "POST", headers: authHeaders(), body: JSON.stringify({ expiresIn }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "Could not open photo.");
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`;
}

export function publicPhoto(path: string) { return `${SUPABASE_URL}/storage/v1/object/public/public-media/${path}`; }
