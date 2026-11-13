// Shared by api/agent.js and api/ai-key.js (Vercel skips files starting with "_"): who is asking,
// and which model serves them. Each user brings their own key for any OpenAI-compatible API; it is stored
// encrypted in ai_keys, which only the server can read. Without one, only the accounts in AGENT_OWNER_EMAILS
// fall back to the server's DeepSeek key, so nobody else spends it.
import { createClient } from "@supabase/supabase-js";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const env = process.env;
const URL_ = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const OWNERS = (env.AGENT_OWNER_EMAILS || "").toLowerCase().split(/[\s,]+/).filter(Boolean);
export const DEFAULT = { base_url: "https://api.deepseek.com", model: env.DEEPSEEK_MODEL || "deepseek-flash" };

export const line = (o) => JSON.stringify(o) + "\n";
export const fail = (status, message, extra) => new Response(line({ t: "error", message, ...extra }), { status, headers: { "content-type": "application/x-ndjson" } });

export const admin = () => createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// The signed-in user behind the request's Supabase access token, or null.
export async function userOf(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !URL_ || !ANON) return null;
  const { data, error } = await createClient(URL_, ANON, { auth: { persistSession: false } }).auth.getUser(token);
  return error ? null : data?.user || null;
}
export const isOwner = (user) => OWNERS.includes((user.email || "").toLowerCase());

// AES-256-GCM under AI_KEY_SECRET; stored as base64 of iv | tag | ciphertext.
const secret = () => {
  if (!env.AI_KEY_SECRET) throw new Error("AI_KEY_SECRET is not set on the server");
  return createHash("sha256").update(env.AI_KEY_SECRET).digest();
};
export function seal(text) {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export function open(sealed) {
  const b = Buffer.from(sealed, "base64"), d = createDecipheriv("aes-256-gcm", secret(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

// The server calls this address with the user's key, so it must be a public https API:
// no plain http, no credentials in the URL, no IP addresses or internal host names.
export function checkBaseUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return "not a valid URL"; }
  if (u.protocol !== "https:") return "the address must start with https://";
  if (u.username || u.password || u.search || u.hash) return "the address can't contain a login, ? or #";
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")
      || /(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/.test(h)) return "the address must be a public API host";
  return null;
}

// The model for this user: their own key, else the server's for owners, else null.
export async function modelFor(user) {
  const { data: row, error } = await admin().from("ai_keys").select("base_url,model,key_enc").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  let cfg = null;
  if (row) cfg = { base_url: row.base_url, model: row.model, apiKey: open(row.key_enc), own: true };
  else if (isOwner(user) && env.DEEPSEEK_API_KEY) cfg = { ...DEFAULT, apiKey: env.DEEPSEEK_API_KEY, own: false };
  if (!cfg) return null;
  const bad = checkBaseUrl(cfg.base_url);
  if (bad) throw new Error(bad);
  const provider = createOpenAICompatible({ name: "suiji", baseURL: cfg.base_url.replace(/\/+$/, ""), apiKey: cfg.apiKey });
  return { model: provider.chatModel(cfg.model), name: cfg.model, base: cfg.base_url, own: cfg.own };
}
