// Print Cell portal: one sign-in, then open CSRC, Tasks or DPR already signed in.
(function () {
  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const EMAIL_DOMAIN = "printcell.internal";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const APPS = [
    { key: "csrc", name: "CSRC", what: "Service schedule and visit reports", ink: "var(--p-cyan)" },
    { key: "tasks", name: "Tasks", what: "Daily task list and reviews", ink: "var(--p-magenta)" },
    { key: "dpr", name: "DPR", what: "Customer dues and cheque tracking", ink: "var(--p-yellow)" },
    { key: "coverage", name: "Coverage", what: "Toner used and clicks by machine", ink: "var(--p-key)" },
  ];
  const DPR_LABEL = { full: "Full report", pdc: "PDC cheques only", agent: "Agent" };
  const EVENT_LABEL = { sign_in: "Signed in", open_csrc: "Opened CSRC", open_tasks: "Opened Tasks", open_dpr: "Opened DPR", open_coverage: "Opened Coverage" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

  let me = null;          // portal_me() for the signed-in person
  let roster = null;      // admin: portal-admin "list" result
  let editing = null;     // admin: id of the person being edited, or "" for a new one

  // ---------- server calls ----------
  async function callFn(name, body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error("Your session has ended. Sign in again.");
    let res;
    try {
      res = await fetch(SUPABASE_URL + "/functions/v1/" + name, {
        method: "POST",
        headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) { throw new Error("Can't reach the server. Check your connection and try again."); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "Something went wrong (" + res.status + "). Try again.");
    return out;
  }

  // ---------- views ----------
  const VIEWS = ["signin", "home", "admin", "activity"];
  function show(view) {
    $("boot").classList.add("hidden");
    VIEWS.forEach((v) => $(v + "-view").classList.toggle("hidden", v !== view));
    const signedIn = view !== "signin";
    ["nav", "who", "signout"].forEach((id) => $(id).classList.toggle("hidden", !signedIn));
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.route === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }

  function route() {
    if (!me) return;
    const r = location.hash.replace(/^#\/?/, "");
    if ((r === "admin" || r === "activity") && me.is_admin) {
      show(r);
      if (r === "admin") loadPeople(); else loadActivity();
    } else {
      show("home");
      renderHome();
    }
  }

  // ---------- sign in / out ----------
  async function enter() {
    const { data, error } = await sb.rpc("portal_me");
    if (error || !data || !data.active) {
      await sb.auth.signOut();
      me = null;
      show("signin");
      $("si-msg").textContent = error ? "Can't load your account. Try again in a minute."
        : "This login can't use the portal. Ask an admin.";
      return;
    }
    me = data;
    $("who").textContent = me.full_name;
    $("nav-admin").classList.toggle("hidden", !me.is_admin);
    $("nav-activity").classList.toggle("hidden", !me.is_admin);
    route();
  }

  $("signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = $("si-user").value.trim().toLowerCase();
    const pass = $("si-pass").value;
    if (!user || !pass) return;
    $("si-btn").disabled = true; $("si-msg").textContent = "";
    try {
      const { error } = await sb.auth.signInWithPassword({ email: user + "@" + EMAIL_DOMAIN, password: pass });
      if (error) {
        $("si-msg").textContent = /invalid/i.test(error.message)
          ? "That username and password don't match. Check both and try again."
          : "Can't sign in right now (" + error.message + ").";
        return;
      }
      $("si-pass").value = "";
      await sb.rpc("portal_log_sign_in", { p_user_agent: navigator.userAgent });
      await enter();
    } catch (err) {
      $("si-msg").textContent = "Can't reach the server. Check your connection and try again.";
    } finally { $("si-btn").disabled = false; }
  });

  $("signout").addEventListener("click", async () => {
    await sb.auth.signOut();
    me = null; roster = null;
    history.replaceState(null, "", location.pathname);
    show("signin");
    $("si-user").focus();
  });

  // ---------- home ----------
  function roleText(key) {
    const a = me[key];
    if (key === "dpr") return a.role === "agent" ? "Agent: " + a.agent_name : DPR_LABEL[a.role];
    if (key === "coverage") return "Dashboard";
    return cap(a.role);
  }
  function renderHome() {
    $("hello").textContent = "Hello, " + me.full_name.split(" ")[0];
    const mine = APPS.filter((a) => me[a.key]);
    $("hello-sub").textContent = mine.length ? "Choose where to work." : "";
    $("apps").innerHTML = mine.length
      ? mine.map((a) =>
          '<li class="app" style="--c:' + a.ink + '"><span class="sw"></span>' +
          '<div><span class="name">' + a.name + '</span><span class="role">' + esc(roleText(a.key)) + "</span></div>" +
          '<div class="what">' + a.what + "</div>" +
          '<button type="button" class="btn" data-app="' + a.key + '">Open ' + a.name + "</button>" +
          '<p class="err hidden"></p></li>').join("")
      : '<li class="empty-apps">You don\'t have access to any portals yet. Ask an admin to add you.</li>';
  }
  $("apps").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-app]");
    if (!b) return;
    const err = b.parentElement.querySelector(".err");
    err.classList.add("hidden");
    const label = b.textContent;
    b.disabled = true; b.textContent = "Opening…";
    try {
      const { url, post } = await callFn("portal-launch", { app: b.dataset.app });
      if (post) {
        // The coverage site has its own sign-in: hand it this person's token in a form post.
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error("Your session has ended. Sign in again.");
        postForm(post, { access_token: session.access_token });
      } else {
        location.assign(url);
      }
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove("hidden");
      b.disabled = false; b.textContent = label;
    }
  });
  function postForm(action, fields) {
    const f = document.createElement("form");
    f.method = "post"; f.action = action;
    for (const [k, v] of Object.entries(fields)) {
      const i = document.createElement("input");
      i.type = "hidden"; i.name = k; i.value = v;
      f.appendChild(i);
    }
    document.body.appendChild(f);
    f.submit();
  }
  // Coming back with the browser's Back button restores the page from cache: reset the buttons.
  window.addEventListener("pageshow", (e) => { if (e.persisted && me && !$("home-view").classList.contains("hidden")) renderHome(); });

  $("pw-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = $("pw-new").value, b = $("pw-again").value, msg = $("pw-msg");
    msg.className = "msg";
    if (a.length < 8) { msg.className = "msg error"; msg.textContent = "Use at least 8 characters."; return; }
    if (a !== b) { msg.className = "msg error"; msg.textContent = "The two passwords don't match."; return; }
    $("pw-btn").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    $("pw-btn").disabled = false;
    if (error) { msg.className = "msg error"; msg.textContent = "Couldn't change it: " + error.message; return; }
    $("pw-new").value = ""; $("pw-again").value = "";
    msg.className = "msg ok"; msg.textContent = "Password changed. Use it next time you sign in.";
  });

  // ---------- admin: people ----------
  async function loadPeople() {
    $("people-msg").textContent = roster ? "" : "Loading…";
    try {
      roster = await callFn("portal-admin", { action: "list" });
      $("people-msg").textContent = "";
      renderPeople();
    } catch (e) { $("people-msg").className = "msg error"; $("people-msg").textContent = e.message; }
  }
  function acctLabel(list, id) {
    const a = (list || []).find((x) => x.id === id);
    return a ? a.username + " · " + cap(a.role) + (a.active ? "" : " (inactive)") : null;
  }
  function covLabel(username) {
    const a = ((roster && roster.coverage_accounts) || []).find((x) => x.username === username);
    return username + (a && !a.active ? " (inactive)" : "");
  }
  function accessLine(ink, name, text) {
    return '<div class="access' + (text ? "" : " none") + '"><span class="sw" style="--c:' + ink + '"></span>' +
      name + (text ? ": " + esc(text) : ": no access") + "</div>";
  }
  function renderPeople() {
    const rows = roster.users;
    $("people").innerHTML = '<table><thead><tr><th>Person</th><th>Portals</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>' +
      rows.map((u) => {
        const dpr = u.dpr_role ? (u.dpr_role === "agent" ? "Agent " + u.dpr_agent_name : DPR_LABEL[u.dpr_role]) +
          (u.dpr_can_export ? ", export" : "") : null;
        const state = !u.active ? '<span class="state">Can\'t sign in</span>'
          : !u.password_set ? '<span class="state warn">Needs password</span>'
          : '<span class="state on">Active</span>';
        return "<tr><td><strong>" + esc(u.full_name) + "</strong>" + (u.is_admin ? " · Admin" : "") +
          '<span class="sub">' + esc(u.username) + "</span></td><td>" +
          accessLine("var(--p-cyan)", "CSRC", acctLabel(roster.csrc_accounts, u.csrc_user_id)) +
          accessLine("var(--p-magenta)", "Tasks", acctLabel(roster.task_accounts, u.task_user_id)) +
          accessLine("var(--p-key)", "Coverage", u.coverage_user ? covLabel(u.coverage_user) : null) +
          accessLine("var(--p-yellow)", "DPR", dpr) + "</td>" +
          '<td class="num">' + (u.last_sign_in ? when(u.last_sign_in) : '<span class="none">Never</span>') + "</td>" +
          "<td>" + state + "</td>" +
          '<td><button type="button" class="btn secondary small" data-edit="' + u.id + '">Edit</button></td></tr>';
      }).join("") + "</tbody></table>";
  }

  function fillSelect(sel, list, linkedField, currentId) {
    const taken = new Set(roster.users.filter((u) => u.id !== editing && u[linkedField]).map((u) => u[linkedField]));
    sel.innerHTML = '<option value="">No access</option>' + list.map((a) => {
      const other = taken.has(a.id);
      return '<option value="' + a.id + '"' + (other ? " disabled" : "") + ">" + esc(a.full_name + " (" + a.username + ", " + a.role + ")") +
        (a.active ? "" : " – inactive") + (other ? " – linked to someone else" : "") + "</option>";
    }).join("");
    sel.value = currentId || "";
  }
  function fillCoverage(current) {
    const taken = new Set(roster.users.filter((u) => u.id !== editing && u.coverage_user).map((u) => u.coverage_user));
    $("e-coverage").innerHTML = '<option value="">No access</option>' + (roster.coverage_accounts || []).map((a) => {
      const other = taken.has(a.username);
      return '<option value="' + esc(a.username) + '"' + (other ? " disabled" : "") + ">" +
        esc((a.full_name || a.username) + " (" + a.username + ")") + (a.active ? "" : " – inactive") +
        (other ? " – linked to someone else" : "") + "</option>";
    }).join("");
    $("e-coverage").value = current || "";
  }
  function syncDprFields() {
    const r = $("e-dpr").value;
    $("e-agent-wrap").classList.toggle("hidden", r !== "agent");
    $("e-export-wrap").classList.toggle("hidden", !r);
  }
  function openEditor(u) {
    editing = u ? u.id : "";
    const isSelf = u && u.id === me.id;
    $("edit-title").textContent = u ? "Edit " + u.full_name : "Add person";
    $("e-name").value = u ? u.full_name : "";
    $("e-user").value = u ? u.username : "";
    $("e-pass").value = "";
    $("e-pass-label").textContent = u ? "New password" : "Password";
    $("e-pass-hint").textContent = u ? (u.password_set ? "Leave blank to keep their current password." : "They can't sign in until you set one.")
      : "At least 8 characters. Leave blank to set it later.";
    $("e-active").checked = u ? u.active : true;
    $("e-admin").checked = u ? u.is_admin : false;
    $("e-active").disabled = $("e-admin").disabled = !!isSelf;
    fillSelect($("e-csrc"), roster.csrc_accounts, "csrc_user_id", u && u.csrc_user_id);
    fillSelect($("e-tasks"), roster.task_accounts, "task_user_id", u && u.task_user_id);
    fillCoverage(u && u.coverage_user);
    $("e-dpr").value = (u && u.dpr_role) || "";
    $("e-agent").innerHTML = '<option value="">Pick an agent</option>' +
      roster.dpr_agents.map((n) => '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("");
    $("e-agent").value = (u && u.dpr_agent_name) || "";
    $("e-export").checked = !!(u && u.dpr_can_export);
    syncDprFields();
    $("e-msg").textContent = "";
    $("edit").classList.remove("hidden");
    $("edit").scrollIntoView({ behavior: "smooth", block: "start" });
    $("e-name").focus({ preventScroll: true });
  }
  function closeEditor() { editing = null; $("edit").classList.add("hidden"); }

  $("add-person").addEventListener("click", () => roster && openEditor(null));
  $("people").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-edit]");
    if (b) openEditor(roster.users.find((u) => u.id === b.dataset.edit));
  });
  $("e-dpr").addEventListener("change", syncDprFields);
  $("e-cancel").addEventListener("click", closeEditor);
  $("edit").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("e-msg");
    const pass = $("e-pass").value;
    if (pass && pass.length < 8) { msg.textContent = "Passwords need at least 8 characters."; $("e-pass").focus(); return; }
    const user = {
      id: editing || undefined,
      full_name: $("e-name").value, username: $("e-user").value.trim().toLowerCase(),
      password: pass || undefined, active: $("e-active").checked, is_admin: $("e-admin").checked,
      csrc_user_id: $("e-csrc").value || null, task_user_id: $("e-tasks").value || null,
      coverage_user: $("e-coverage").value || null,
      dpr_role: $("e-dpr").value || null, dpr_agent_name: $("e-agent").value || null, dpr_can_export: $("e-export").checked,
    };
    $("e-save").disabled = true; msg.textContent = "";
    try {
      const { user: saved } = await callFn("portal-admin", { action: "save", user });
      closeEditor();
      $("people-msg").className = "msg ok";
      $("people-msg").textContent = "Saved " + saved.full_name + "." +
        (saved.password_set ? "" : " Set a password before they can sign in.");
      await loadPeople();
      if (saved.id === me.id) await enter();
    } catch (ex) { msg.textContent = ex.message; }
    finally { $("e-save").disabled = false; }
  });

  // ---------- admin: activity ----------
  let activityRows = [];
  async function loadActivity() {
    $("activity-msg").className = "msg"; $("activity-msg").textContent = "Loading…";
    const { data, error } = await sb.from("portal_activity").select("username, event, at, user_agent")
      .order("at", { ascending: false }).limit(500);
    if (error) { $("activity-msg").className = "msg error"; $("activity-msg").textContent = "Can't load activity. Try again."; return; }
    activityRows = data;
    const people = [...new Set(data.map((r) => r.username).filter(Boolean))].sort();
    const keep = $("f-person").value;
    $("f-person").innerHTML = '<option value="">Everyone</option>' + people.map((p) => '<option>' + esc(p) + "</option>").join("");
    $("f-person").value = people.includes(keep) ? keep : "";
    $("activity-msg").textContent = data.length === 500 ? "Showing the latest 500 entries." : "";
    renderActivity();
  }
  function device(ua) {
    if (!ua) return "";
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows"
      : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox"
      : /Safari\//.test(ua) ? "Safari" : "";
    return [br, os].filter(Boolean).join(" on ");
  }
  function renderActivity() {
    const p = $("f-person").value, ev = $("f-event").value;
    const rows = activityRows.filter((r) => (!p || r.username === p) && (!ev || r.event === ev));
    $("activity").innerHTML = rows.length
      ? '<table><thead><tr><th>When</th><th>Person</th><th>What</th><th>Device</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td class="num">' + when(r.at) + "</td><td>" + esc(r.username || "–") + "</td><td>" +
          (EVENT_LABEL[r.event] || esc(r.event)) + '</td><td class="muted">' + esc(device(r.user_agent)) + "</td></tr>").join("") +
        "</tbody></table>"
      : '<p class="empty">Nothing matches these filters.</p>';
  }
  $("f-person").addEventListener("change", renderActivity);
  $("f-event").addEventListener("change", renderActivity);

  // ---------- start ----------
  window.addEventListener("hashchange", route);
  sb.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" && me) { me = null; show("signin"); }
  });
  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await enter(); else { show("signin"); $("si-user").focus(); }
  })();
})();
