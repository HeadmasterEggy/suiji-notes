// The signed-in user's own assistant key (Settings → Assistant). The key itself never comes back to the page:
// GET answers with the address, model and last four characters only.
//   GET    → { own: {base_url, model, hint, updated_at} | null, fallback: bool }
//   PUT    { base_url, model, api_key? } (api_key may be left out to keep the saved one)
//   DELETE → removes it
//   POST   { base_url, api_key? } → { models: [id, …] }: the models that API offers, for suggestions in the model
//          field; with no api_key it uses the saved key, but only when it was saved for that same address.
import { admin, userOf, isOwner, seal, open, checkBaseUrl, DEFAULT } from "./_ai.js";

const json = (o, status = 200) => Response.json(o, { status, headers: { "cache-control": "no-store" } });

async function state(user) {
  const { data, error } = await admin().from("ai_keys").select("base_url,model,key_hint,updated_at").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(error.message);
  return {
    own: data && { base_url: data.base_url, model: data.model, hint: data.key_hint, updated_at: data.updated_at },
    fallback: isOwner(user) && !!process.env.DEEPSEEK_API_KEY ? { model: DEFAULT.model } : null,
  };
}

export async function GET(request) {
  const user = await userOf(request);
  if (!user) return json({ error: "not signed in" }, 401);
  return json(await state(user));
}

export async function PUT(request) {
  const user = await userOf(request);
  if (!user) return json({ error: "not signed in" }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const base_url = String(b?.base_url || "").trim().replace(/\/+$/, ""), model = String(b?.model || "").trim();
  const api_key = b?.api_key == null ? null : String(b.api_key).trim();
  const bad = checkBaseUrl(base_url);
  if (bad) return json({ error: bad }, 400);
  if (!model || model.length > 200) return json({ error: "enter a model name" }, 400);
  if (api_key !== null && (api_key.length < 8 || api_key.length > 1000 || /\s/.test(api_key))) return json({ error: "that doesn't look like an API key" }, 400);
  const db = admin();
  if (api_key === null) {
    // Model changed, same key. The saved key stays with the address it was saved for: sent to another
    // service it fails at best, and hands the key to someone else at worst (the model list works the same way).
    const { data: had, error: e1 } = await db.from("ai_keys").select("base_url").eq("user_id", user.id).maybeSingle();
    if (e1) return json({ error: e1.message }, 500);
    if (!had) return json({ error: "enter your API key" }, 400);
    if (had.base_url.replace(/\/+$/, "") !== base_url) return json({ error: "enter the API key for this address" }, 400);
    const { error } = await db.from("ai_keys").update({ base_url, model, updated_at: new Date().toISOString() }).eq("user_id", user.id);
    if (error) return json({ error: error.message }, 500);
  } else {
    const { error } = await db.from("ai_keys").upsert({ user_id: user.id, base_url, model, key_enc: seal(api_key), key_hint: api_key.slice(-4), updated_at: new Date().toISOString() });
    if (error) return json({ error: error.message }, 500);
  }
  return json(await state(user));
}

export async function DELETE(request) {
  const user = await userOf(request);
  if (!user) return json({ error: "not signed in" }, 401);
  const { error } = await admin().from("ai_keys").delete().eq("user_id", user.id);
  if (error) return json({ error: error.message }, 500);
  return json(await state(user));
}

export async function POST(request) {
  const user = await userOf(request);
  if (!user) return json({ error: "not signed in" }, 401);
  let b;
  try { b = await request.json(); } catch { return json({ error: "bad request" }, 400); }
  const base_url = String(b?.base_url || "").trim().replace(/\/+$/, "");
  const bad = checkBaseUrl(base_url);
  if (bad) return json({ error: bad }, 400);
  let key = b?.api_key == null ? "" : String(b.api_key).trim();
  if (key.length > 1000 || /\s/.test(key)) return json({ error: "that doesn't look like an API key" }, 400);
  if (!key) {
    const { data } = await admin().from("ai_keys").select("base_url,key_enc").eq("user_id", user.id).maybeSingle();
    if (data && data.base_url.replace(/\/+$/, "") === base_url) key = open(data.key_enc);
    else if (isOwner(user) && process.env.DEEPSEEK_API_KEY && base_url === DEFAULT.base_url) key = process.env.DEEPSEEK_API_KEY;
  }
  if (!key) return json({ error: "enter your API key" }, 400);
  try {
    const res = await fetch(base_url + "/models", { headers: { authorization: "Bearer " + key }, signal: AbortSignal.timeout(8000), redirect: "error" });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: out.error?.message || "HTTP " + res.status }, 502);
    const models = [...new Set((out.data || out.models || []).map((m) => typeof m === "string" ? m : m?.id).filter((id) => typeof id === "string" && id.length < 200))].sort();
    return json({ models: models.slice(0, 2000) });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 502);
  }
}
