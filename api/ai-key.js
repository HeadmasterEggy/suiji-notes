// The signed-in user's own assistant key (Settings → Assistant). The key itself never comes back to the page:
// GET answers with the address, model and last four characters only.
//   GET    → { own: {base_url, model, hint, updated_at} | null, fallback: bool }
//   PUT    { base_url, model, api_key? } (api_key may be left out to keep the saved one)
//   DELETE → removes it
import { admin, userOf, isOwner, seal, checkBaseUrl, DEFAULT } from "./_ai.js";

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
    // Address or model changed, same key.
    const { data, error } = await db.from("ai_keys").update({ base_url, model, updated_at: new Date().toISOString() }).eq("user_id", user.id).select("user_id");
    if (error) return json({ error: error.message }, 500);
    if (!data.length) return json({ error: "enter your API key" }, 400);
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
