// Print Cell portal: open CSRC, Tasks or DPR already signed in.
// Checks the caller's portal access, then mints a fresh session for the linked app account
// and returns the app URL with that session in the hash (Supabase implicit-flow format,
// which supabase-js in CSRC and Tasks reads on page load and then clears).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APPS: Record<string, { url: string; event: string; name: string }> = {
  csrc: { url: "https://csrc.ashutosh-sharma.com/", event: "open_csrc", name: "CSRC" },
  tasks: { url: "https://tasks.ashutosh-sharma.com/", event: "open_tasks", name: "Tasks" },
  dpr: { url: "https://dpr.ashutosh-sharma.com/", event: "open_dpr", name: "DPR" },
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json({ error }, status);
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

// Never set a user session on this client: it must keep acting as service role.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, opts);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: who, error: whoErr } = token ? await admin.auth.getUser(token) : { data: null, error: true };
    if (whoErr || !who?.user) return fail(401, "Your session has ended. Sign in again.");
    const { data: me } = await admin.from("portal_users").select("*").eq("id", who.user.id).maybeSingle();
    if (!me || !me.active) return fail(403, "Your portal account is not active. Ask an admin.");

    let body: { app?: string } = {};
    try { body = await req.json(); } catch { /* handled below */ }
    const app = APPS[body.app ?? ""];
    if (!app) return fail(400, "Unknown portal.");

    let targetId: string | null = null;
    if (body.app === "csrc" || body.app === "tasks") {
      const linked = body.app === "csrc" ? me.csrc_user_id : me.task_user_id;
      const table = body.app === "csrc" ? "csrc_app_users" : "task_list_profiles";
      if (linked) {
        const { data: acct } = await admin.from(table).select("id, active").eq("id", linked).maybeSingle();
        if (acct?.active) targetId = acct.id;
      }
    } else if (me.dpr_role) {
      targetId = me.id; // DPR reads the portal user's own DPR role
    }
    if (!targetId) return fail(403, `You don't have ${app.name} access. Ask an admin.`);

    const { data: target, error: tErr } = await admin.auth.admin.getUserById(targetId);
    if (tErr || !target.user?.email) throw new Error(tErr?.message ?? "linked account has no email");
    const { data: link, error: lErr } = await admin.auth.admin.generateLink({ type: "magiclink", email: target.user.email });
    if (lErr || !link.properties?.hashed_token) throw new Error(lErr?.message ?? "generateLink failed");

    // A throwaway client so the minted session never lands on the service-role client.
    const verifier = createClient(SUPABASE_URL, SERVICE_KEY, opts);
    const { data: v, error: vErr } = await verifier.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
    if (vErr || !v.session) throw new Error(vErr?.message ?? "verifyOtp gave no session");
    const s = v.session;

    await admin.from("portal_activity").insert({
      user_id: me.id, username: me.username, event: app.event,
      user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
    });

    const hash = new URLSearchParams({
      access_token: s.access_token, refresh_token: s.refresh_token,
      expires_in: String(s.expires_in), expires_at: String(s.expires_at ?? Math.floor(Date.now() / 1000) + s.expires_in),
      token_type: "bearer", type: "magiclink",
    });
    return json({ url: app.url + "#" + hash.toString() });
  } catch (e) {
    console.error(e);
    return fail(500, "Could not open that portal. Try again in a minute.");
  }
});
