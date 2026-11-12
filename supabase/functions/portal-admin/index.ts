// Print Cell portal: admin actions (list people, add/edit access, set passwords).
// Auth is checked here: the caller must be an active portal admin.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EMAIL_DOMAIN = "printcell.internal";
const USERNAME = /^[a-z0-9._-]{2,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DPR_ROLES = ["full", "pdc", "agent"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const fail = (status: number, error: string) => json({ error }, status);
class UserError extends Error {}

// Never set a user session on this client: it must keep acting as service role.
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function callerRow(req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: row } = await admin.from("portal_users").select("*").eq("id", data.user.id).maybeSingle();
  return row && row.active ? row : null;
}

function randomPassword() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
function checkPassword(pw: unknown) {
  if (typeof pw !== "string" || pw.length < 8) throw new UserError("Passwords need at least 8 characters.");
  if (pw.length > 72) throw new UserError("Passwords can be at most 72 characters.");
  return pw;
}
const link = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !UUID.test(v)) throw new UserError("Pick an account from the list.");
  return v;
};

// A Coverage account is identified by its username (cov_users.username).
const covUser = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !USERNAME.test(v)) throw new UserError("Pick a coverage account from the list.");
  return v;
};

function clean(u: Record<string, unknown>) {
  const username = String(u.username ?? "").trim().toLowerCase();
  if (!USERNAME.test(username)) throw new UserError("Usernames use 2 to 32 lowercase letters, numbers, dots, dashes or underscores.");
  const full_name = String(u.full_name ?? "").trim();
  if (!full_name) throw new UserError("Enter the person's name.");
  const dpr_role = u.dpr_role ? String(u.dpr_role) : null;
  if (dpr_role && !DPR_ROLES.includes(dpr_role)) throw new UserError("Pick a DPR access level from the list.");
  const dpr_agent_name = dpr_role === "agent" ? String(u.dpr_agent_name ?? "").trim() : null;
  if (dpr_role === "agent" && !dpr_agent_name) throw new UserError("Pick which agent's customers this person sees in DPR.");
  return {
    username, full_name,
    is_admin: u.is_admin === true,
    active: u.active !== false,
    csrc_user_id: link(u.csrc_user_id),
    task_user_id: link(u.task_user_id),
    coverage_user: covUser(u.coverage_user),
    dpr_role, dpr_agent_name,
    dpr_can_export: dpr_role ? u.dpr_can_export === true : false,
  };
}

function dbError(e: { code?: string; message?: string; details?: string }) {
  const m = `${e.message ?? ""} ${e.details ?? ""}`;
  if (e.code === "23505") {
    if (m.includes("username")) return new UserError("That username is already taken.");
    if (m.includes("csrc_user_id")) return new UserError("That CSRC account is already linked to another person.");
    if (m.includes("task_user_id")) return new UserError("That Tasks account is already linked to another person.");
    if (m.includes("coverage_user")) return new UserError("That Coverage account is already linked to another person.");
  }
  if (e.code === "23503") return new UserError("That linked account no longer exists. Reload and try again.");
  return new Error(m);
}

async function list() {
  const [users, csrc, tasks, agents, signins, cov] = await Promise.all([
    admin.from("portal_users").select("*").order("full_name"),
    admin.from("csrc_app_users").select("id, username, full_name, role, active").order("full_name"),
    admin.from("task_list_profiles").select("id, username, full_name, role, active").order("full_name"),
    admin.from("dpr_customers").select("agent_name"),
    admin.from("portal_activity").select("user_id, at").eq("event", "sign_in").order("at", { ascending: false }).limit(2000),
    admin.from("cov_users").select("username, full_name, active").order("username"), // never selects password_hash
  ]);
  for (const r of [users, csrc, tasks, agents, signins, cov]) if (r.error) throw new Error(r.error.message);
  const last: Record<string, string> = {};
  for (const s of signins.data!) if (s.user_id && !last[s.user_id]) last[s.user_id] = s.at;
  const agentNames = [...new Set(agents.data!.map((a) => (a.agent_name || "").trim()).filter(Boolean))].sort();
  return {
    users: users.data!.map((u) => ({ ...u, last_sign_in: last[u.id] ?? null })),
    csrc_accounts: csrc.data, task_accounts: tasks.data, coverage_accounts: cov.data, dpr_agents: agentNames,
  };
}

async function save(me: { id: string }, input: Record<string, unknown>) {
  const row = clean(input);
  const id = input.id ? link(input.id) : null;
  const password = input.password ? checkPassword(input.password) : null;

  if (!id) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: `${row.username}@${EMAIL_DOMAIN}`, password: password ?? randomPassword(), email_confirm: true,
      user_metadata: { portal: true, full_name: row.full_name },
    });
    if (error || !created.user) {
      if (/already|registered|exists/i.test(error?.message ?? "")) throw new UserError("That username is already taken.");
      throw new Error(error?.message ?? "createUser failed");
    }
    const { data, error: insErr } = await admin.from("portal_users")
      .insert({ ...row, id: created.user.id, password_set: !!password }).select().single();
    if (insErr) { await admin.auth.admin.deleteUser(created.user.id); throw dbError(insErr); }
    return data;
  }

  const { data: existing } = await admin.from("portal_users").select("*").eq("id", id).maybeSingle();
  if (!existing) throw new UserError("That person no longer exists. Reload the page.");
  if (id === me.id && (!row.is_admin || !row.active)) throw new UserError("You can't remove your own admin access or deactivate yourself.");

  const authChanges: Record<string, unknown> = {};
  if (row.username !== existing.username) authChanges.email = `${row.username}@${EMAIL_DOMAIN}`;
  if (password) authChanges.password = password;
  if (Object.keys(authChanges).length) {
    const { error } = await admin.auth.admin.updateUserById(id, { ...authChanges, email_confirm: true });
    if (error) {
      if (/already|registered|exists/i.test(error.message)) throw new UserError("That username is already taken.");
      throw new Error(error.message);
    }
  }
  const { data, error } = await admin.from("portal_users")
    .update({ ...row, ...(password ? { password_set: true } : {}) }).eq("id", id).select().single();
  if (error) throw dbError(error);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail(405, "Use POST.");
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, "The request was not valid JSON."); }
  try {
    const me = await callerRow(req);
    if (!me) return fail(401, "Your session has ended. Sign in again.");
    if (!me.is_admin) return fail(403, "Only portal admins can do this.");
    switch (body.action) {
      case "list": return json(await list());
      case "save": return json({ user: await save(me, (body.user ?? {}) as Record<string, unknown>) });
      case "set_password": {
        const id = link(body.id);
        const pw = checkPassword(body.password);
        if (!id) throw new UserError("Pick a person.");
        const { error } = await admin.auth.admin.updateUserById(id, { password: pw });
        if (error) throw new Error(error.message);
        await admin.from("portal_users").update({ password_set: true }).eq("id", id);
        return json({ ok: true });
      }
      default: return fail(400, "Unknown action.");
    }
  } catch (e) {
    if (e instanceof UserError) return fail(400, e.message);
    console.error(e);
    return fail(500, "Something went wrong on the server. Try again in a minute.");
  }
});
