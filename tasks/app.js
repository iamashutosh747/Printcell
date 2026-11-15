// Tasks: recurring office tasks for Print Cell and Biz Print. Makers mark them done; an admin approves.
// Same tables, rules and logins as the original Tasks app (task_list_* in the csrc-system database).
(function () {
  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const DOMAIN = "staff.tasks.local";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const C = window.Cal;

  const COMPANIES = ["Both", "Print Cell Pvt. Ltd.", "Biz Print Pvt. Ltd."];
  const CO_SHORT = { Both: "Both", "Print Cell Pvt. Ltd.": "Print Cell", "Biz Print Pvt. Ltd.": "Biz Print" };
  const FREQS = ["Daily", "Weekly", "Fortnightly", "Monthly", "Yearly", "Adhoc", "One-time"];
  const STATE_LABEL = { pending: "Not done", overdue: "Late", submitted: "Waiting for approval", approved: "Approved", returned: "Sent back" };
  const RULES = [
    ["daily", "Every working day (Sun–Fri)"], ["weekdays", "On certain days of the week"], ["everyOtherWeek", "Every other week"],
    ["monthDay", "Monthly, on a date (e.g. 7th)"], ["nthWeekday", "Monthly, on a weekday (e.g. 1st Sunday)"],
    ["lastWeek", "Monthly, in the last week"], ["yearly", "Once a year"], ["once", "Just once, on a date"], ["adhoc", "As needed, no fixed day"],
  ];

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const bsShort = (d) => C.fmtBS(d, false);
  const dateLine = (d) => bsShort(d) + ' <span class="aside">· ' + C.fmtADShort(d, false) + "</span>";
  const ago = (t) => {
    if (!t) return "";
    const m = Math.round((Date.now() - new Date(t).getTime()) / 6e4);
    if (m < 1) return "just now";
    if (m < 60) return m + " min ago";
    const h = Math.round(m / 60);
    return h < 24 ? h + " h ago" : "on " + new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const ICON = {
    check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 10.5 3.2 3.2L15 6.8"/></svg>',
    back: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5 3.5 9.5 8 14M4 9.5h7.5a5 5 0 0 1 0 10"/></svg>',
    edit: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 15.5 7.5 7 16H4v-3z"/></svg>',
    search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m13 13 4 4"/></svg>',
    prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
    next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
  };

  // ---------- state ----------
  let me = null, people = [], tasks = [], today = C.todayNepal(), waitingCount = 0;
  const isAdmin = () => me && me.role === "admin";
  const canExport = () => isAdmin() || (me && me.can_export);
  const personName = (id) => (people.find((p) => p.id === id) || {}).full_name || "Unknown";
  const companyMatch = (f, c) => f === "all" || c === f || c === "Both";

  // ---------- data ----------
  const unwrap = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
  const api = {
    profile: async (id) => unwrap(await sb.from("task_list_profiles").select("*").eq("id", id).single()),
    people: async () => unwrap(await sb.from("task_list_profiles").select("*").order("full_name")),
    tasks: async () => unwrap(await sb.from("task_list_tasks").select("*").order("created_at")),
    completions: async (from, to) => unwrap(await sb.from("task_list_completions").select("*").gte("due_date", from).lte("due_date", to)),
    submitted: async () => unwrap(await sb.from("task_list_completions").select("*").eq("status", "submitted")),
    submit: async (taskId, due, note) => {
      const { data: u } = await sb.auth.getUser();
      return unwrap(await sb.from("task_list_completions").upsert({ task_id: taskId, due_date: due, status: "submitted", submitted_by: u.user && u.user.id,
        submitted_at: new Date().toISOString(), maker_note: note }, { onConflict: "task_id,due_date" }).select().single());
    },
    unsubmit: async (id) => unwrap(await sb.from("task_list_completions").delete().eq("id", id).eq("status", "submitted")),
    review: async (id, status, note) => {
      const { data: u } = await sb.auth.getUser();
      unwrap(await sb.from("task_list_completions").update({ status, reviewed_by: u.user && u.user.id, reviewed_at: new Date().toISOString(), admin_note: note }).eq("id", id));
    },
    reopen: async (id) => unwrap(await sb.from("task_list_completions").update({ status: "submitted", reviewed_by: null, reviewed_at: null, admin_note: "" }).eq("id", id)),
    saveTask: async (t) => unwrap(t.id ? await sb.from("task_list_tasks").update(t).eq("id", t.id).select().single()
      : await sb.from("task_list_tasks").insert(t).select().single()),
    updatePerson: async (id, patch) => unwrap(await sb.from("task_list_profiles").update(patch).eq("id", id)),
    manage: async (body) => {
      const { data, error } = await sb.functions.invoke("task-list-manage-users", { body });
      if (error) { const ctx = error.context; const msg = ctx ? (await ctx.json().catch(() => null) || {}).error : null; throw new Error(msg || error.message); }
      return data;
    },
  };
  // Completions are cached by date range and cleared after any change.
  let compCache = new Map();
  async function completions(from, to) {
    const k = from + "|" + to;
    if (!compCache.has(k)) compCache.set(k, api.completions(from, to));
    try { return await compCache.get(k); } catch (e) { compCache.delete(k); throw e; }
  }
  async function refreshData() {
    compCache = new Map();
    [people, tasks] = await Promise.all([api.people(), api.tasks()]);
    if (isAdmin()) { try { waitingCount = (await api.submitted()).length; } catch (e) {} }
    paintNav();
  }
  async function act(fn, okText, undo) {
    try { const r = await fn(); compCache = new Map(); await refreshData(); render(); if (okText) toast(okText, undo); return r === undefined ? true : r; }
    catch (e) { toast(e.message); return undefined; }
  }

  // ---------- sign in ----------
  function paintSigninDate() {
    const b = C.toBS(today);
    $("si-np").textContent = C.NP_MONTHS[b.m - 1] + " " + C.npDigits(b.y);
    $("si-day").textContent = b.d;
    $("si-ad").textContent = C.WEEKDAYS[C.weekday(today)] + ", " + C.fmtADShort(today);
  }
  function showSignin(msg) {
    $("boot").classList.add("hidden"); $("shell").classList.add("hidden"); $("signin-view").classList.remove("hidden");
    paintSigninDate();
    $("si-msg").textContent = msg || "";
    $("si-user").focus();
  }
  $("signin").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("si-user").value.trim().toLowerCase(), p = $("si-pass").value;
    if (!u || !p) return;
    $("si-btn").disabled = true; $("si-btn").textContent = "Signing in…"; $("si-msg").textContent = "";
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email: u + "@" + DOMAIN, password: p });
      if (error) throw new Error(error.message === "Invalid login credentials" ? "That username and password don't match. Check both and try again." : error.message);
      await enter(data.user.id);
    } catch (err) { $("si-msg").textContent = err.message; }
    finally { $("si-btn").disabled = false; $("si-btn").textContent = "Sign in"; }
  });
  async function enter(userId) {
    const prof = await api.profile(userId).catch(() => null);
    if (!prof) { await sb.auth.signOut(); return showSignin("This login isn't on the task list. Ask Ashutosh."); }
    if (!prof.active) { await sb.auth.signOut(); return showSignin("This account has been turned off. Ask Ashutosh."); }
    me = prof;
    await refreshData();
    $("boot").classList.add("hidden"); $("signin-view").classList.add("hidden"); $("shell").classList.remove("hidden");
    $("who-name").textContent = me.full_name;
    $("who-role").textContent = isAdmin() ? "Admin" : "Maker";
    paintRailDate();
    render();
  }
  $("signout").addEventListener("click", async () => { await sb.auth.signOut(); me = null; history.replaceState(null, "", location.pathname); showSignin(""); });
  function paintRailDate() {
    const b = C.toBS(today);
    $("rail-date").innerHTML = '<span class="np">' + C.NP_MONTHS[b.m - 1] + " " + C.npDigits(b.y) + "</span><b>" + b.d + "</b><span>" +
      C.BS_MONTHS[b.m - 1] + " · " + C.WEEKDAYS[C.weekday(today)] + "<br>" + C.fmtADShort(today) + "</span>";
  }
  // The date rolls over at midnight in Kathmandu.
  setInterval(() => { const t = C.todayNepal(); if (t !== today) { today = t; compCache = new Map(); if (me) { paintRailDate(); render(); } } }, 60000);

  // ---------- routing ----------
  const route = () => location.hash.replace(/^#\/?/, "").split("/");
  function paintNav() {
    if (!me) return;
    const r = route()[0] || "today";
    const link = (to, label, count) => '<a href="#/' + to + '"' + (r === to ? ' aria-current="page"' : "") + "><span>" + label + "</span>" +
      (count ? '<b class="count" aria-label="' + count + ' waiting">' + count + "</b>" : "") + "</a>";
    $("views").innerHTML = link("today", "Today") + link("calendar", "Calendar") + link("tasks", "All tasks") +
      (isAdmin() ? link("review", "Review", waitingCount) + link("people", "People") : "");
  }
  window.addEventListener("hashchange", () => { closePanel(); render(); window.scrollTo(0, 0); });
  function render() {
    if (!me) return;
    paintNav();
    const [r, id] = route();
    const main = $("main");
    if (r === "calendar") return viewCalendar(main);
    if (r === "tasks" && id && isAdmin()) return viewEditor(main, id === "new" ? null : id);
    if (r === "tasks") return viewTasks(main);
    if (r === "review" && isAdmin()) return viewReview(main);
    if (r === "people" && isAdmin()) return viewPeople(main);
    return viewToday(main);
  }

  // ---------- shared pieces ----------
  function mark(state, size = 18) {
    const col = { pending: "var(--ink-3)", overdue: "var(--bad)", submitted: "var(--warn)", approved: "var(--ok)", returned: "var(--bad)" }[state];
    const inner = state === "approved" ? '<circle cx="9" cy="9" r="8" fill="' + col + '"/><path d="M5.6 9.2 8 11.5l4.4-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'
      : '<circle cx="9" cy="9" r="7" fill="none" stroke="' + col + '" stroke-width="' + (state === "pending" ? 1.4 : 1.8) + '"/>' +
        (state === "submitted" ? '<path d="M9 2 A7 7 0 0 1 9 16 Z" fill="' + col + '"/>' : "") +
        (state === "overdue" ? '<path d="M9 5.2v4.3l2.6 1.6" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linecap="round"/>' : "") +
        (state === "returned" ? '<path d="M4.2 13.8 13.8 4.2" stroke="' + col + '" stroke-width="1.8" stroke-linecap="round"/>' : "");
    return '<svg class="mark" width="' + size + '" height="' + size + '" viewBox="0 0 18 18" role="img" aria-label="' + STATE_LABEL[state] + '">' + inner + "</svg>";
  }
  const legend = () => '<div class="legend" aria-label="Legend">' + ["pending", "overdue", "submitted", "approved", "returned"].map((s) =>
    "<span>" + mark(s, 14) + " " + ({ pending: "Not done", overdue: "Late", submitted: "Waiting", approved: "Approved", returned: "Sent back" })[s] + "</span>").join("") + "</div>";
  function personSelect(id, value) {
    return '<label class="inline"><span class="sr-only">Show tasks for</span><select id="' + id + '">' +
      '<option value="' + me.id + '"' + (value === me.id ? " selected" : "") + ">My tasks</option>" +
      '<option value="all"' + (value === "all" ? " selected" : "") + ">Everyone</option>" +
      '<optgroup label="Person">' + people.filter((p) => p.active && p.id !== me.id).map((p) =>
        '<option value="' + p.id + '"' + (value === p.id ? " selected" : "") + ">" + esc(p.full_name) + "</option>").join("") + "</optgroup></select></label>";
  }
  function companySelect(id, value) {
    return '<label class="inline"><span class="sr-only">Company</span><select id="' + id + '"><option value="all">All companies</option>' +
      COMPANIES.slice(1).map((c) => '<option value="' + c + '"' + (value === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></label>";
  }

  // One occurrence of a task on a date, with its actions. Keyed so actions can find it again.
  let occIndex = new Map();
  function occRow(o, showDue) {
    const st = C.state(o, today), c = o.completion;
    const key = o.task.id + "|" + o.due;
    occIndex.set(key, o);
    const mine = o.task.maker_ids.includes(me.id) || isAdmin();
    const canDo = mine && (st === "pending" || st === "overdue" || st === "returned");
    const early = o.from > today;
    const makers = o.task.maker_ids.map(personName).join(" / ");
    const late = st === "overdue" || st === "returned" ? C.diffDays(today, o.due) : 0;
    let actions = '<span class="state ' + st + '">' + (st === "overdue" ? plural(late, "day", "days") + " late" : STATE_LABEL[st]) + "</span>";
    if (isAdmin()) actions += '<a class="btn sm quiet icon-only" href="#/tasks/' + o.task.id + '" aria-label="Edit ' + esc(o.task.name) + '" title="Edit this task">' + ICON.edit + "</a>";
    if (canDo) actions += '<button type="button" class="btn sm primary" data-do="done" data-key="' + key + '"' + (early ? ' title="Not due yet, but you can finish it early"' : "") + ">" + ICON.check + (st === "returned" ? "Mark done again" : "Mark done") + "</button>";
    if (st === "submitted" && c && c.submitted_by === me.id && !isAdmin()) actions += '<button type="button" class="btn sm quiet" data-do="unsubmit" data-key="' + key + '">Undo</button>';
    if (isAdmin() && st === "submitted" && c) actions += '<button type="button" class="btn sm quiet" data-do="return" data-key="' + key + '">' + ICON.back + 'Send back</button><button type="button" class="btn sm approve" data-do="approve" data-key="' + key + '">' + ICON.check + "Approve</button>";
    const notes = c && c.submitted_by ? '<div class="notes"><span><b>' + esc(personName(c.submitted_by)) + "</b> marked done " + ago(c.submitted_at) + (c.maker_note ? ": “" + esc(c.maker_note) + "”" : "") + "</span>" +
      (c.reviewed_by && (c.status === "returned" || c.admin_note) ? '<span class="admin ' + c.status + '"><b>' + esc(personName(c.reviewed_by)) + "</b> " + (c.status === "returned" ? "sent it back" : "approved") + (c.admin_note ? ": “" + esc(c.admin_note) + "”" : "") + "</span>" : "") + "</div>" : "";
    return '<li class="occ' + (st === "approved" ? " is-done" : "") + (late ? " is-late" : "") + '" data-key="' + key + '">' + mark(st) +
      '<div class="occ-main"><div class="title">' + esc(o.task.name) + '</div><div class="meta"><span>' + esc(makers) + "</span><span>to " + esc(o.task.reporting_to || "–") + "</span>" +
      (showDue ? '<span class="due">Due ' + dateLine(o.due) + "</span>" : o.from !== o.due ? '<span class="due">Due by ' + dateLine(o.due) + "</span>" : "") +
      "<span>" + esc(C.describe(o.task.rule)) + '</span><span class="tag">' + CO_SHORT[o.task.company] + "</span></div>" + notes + "</div>" +
      '<div class="actions">' + actions + "</div></li>";
  }
  // Clicks on occurrence actions, anywhere in the page.
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-do]");
    if (!b || !b.dataset.key) return;
    const o = occIndex.get(b.dataset.key);
    if (!o) return;
    const c = o.completion;
    if (b.dataset.do === "done" || b.dataset.do === "return") return compose(b.closest(".occ"), o, b.dataset.do);
    b.disabled = true;
    if (b.dataset.do === "unsubmit") await act(() => api.unsubmit(c.id), "Taken back. It's not done any more.");
    if (b.dataset.do === "approve") await act(() => api.review(c.id, "approved", ""), "Approved: " + o.task.name, () => act(() => api.reopen(c.id), "Back to waiting for approval."));
  });
  // A note box opens under the task: optional for "done", required for "send back".
  function compose(li, o, kind) {
    if (li.querySelector(".compose")) return;
    const id = "n-" + Math.random().toString(36).slice(2);
    li.insertAdjacentHTML("beforeend", '<form class="compose"><label class="sr-only" for="' + id + '">' + (kind === "done" ? "Note for the admin (optional)" : "What needs fixing") + "</label>" +
      '<textarea id="' + id + '" rows="2" placeholder="' + (kind === "done" ? "Note for the admin (optional), e.g. “sent on email at 4pm”" : "What needs fixing? The maker sees this note.") + '"></textarea>' +
      '<div class="compose-actions"><button type="button" class="btn quiet" data-cancel>Cancel</button><button class="btn primary">' + (kind === "done" ? "Submit as done" : "Send back") + "</button></div></form>");
    const form = li.querySelector(".compose"), ta = form.querySelector("textarea");
    ta.focus();
    ta.addEventListener("keydown", (e) => { if (e.key === "Escape") form.remove(); if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    form.querySelector("[data-cancel]").addEventListener("click", () => form.remove());
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const note = ta.value.trim();
      if (kind === "return" && !note) { ta.focus(); ta.setAttribute("aria-invalid", "true"); return; }
      form.querySelector(".btn.primary").disabled = true;
      if (kind === "done") {
        const row = await act(() => api.submit(o.task.id, o.due, note), "Sent for approval: " + o.task.name,
          () => act(() => api.unsubmit(row.id), "Taken back. It's not done any more."));
      } else {
        await act(() => api.review(o.completion.id, "returned", note), "Sent back to " + o.task.maker_ids.map(personName).join(" / "),
          () => act(() => api.reopen(o.completion.id), "Back to waiting for approval."));
      }
    });
  }
  function groupHtml(id, title, items, opts = {}) {
    if (!items.length && !opts.empty) return "";
    const max = 8, more = items.length > max;
    return '<section class="group' + (opts.tone ? " " + opts.tone : "") + '" id="g-' + id + '"><div class="group-head"><h2>' + title + "</h2>" +
      (items.length ? '<span class="n">' + items.length + "</span>" : "") + '</div><div class="sheet">' +
      (items.length ? '<ul class="occ-list">' + items.map((o, i) => (i >= max ? occRow(o, opts.showDue).replace('<li class="occ', '<li hidden class="occ') : occRow(o, opts.showDue))).join("") + "</ul>" +
        (more ? '<button type="button" class="show-more" data-more="' + id + '">Show all ' + items.length + "</button>" : "") : '<p class="empty">' + opts.empty + "</p>") + "</div></section>";
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-more]");
    if (!b) return;
    const g = $("g-" + b.dataset.more), hidden = g.querySelectorAll(".occ[hidden]").length;
    g.querySelectorAll(".occ").forEach((li, i) => { if (i >= 8) li.hidden = !hidden; });
    b.textContent = hidden ? "Show fewer" : "Show all " + g.querySelectorAll(".occ").length;
  });

  // ---------- Today ----------
  let todayFor = null;
  async function viewToday(main) {
    if (todayFor === null) todayFor = isAdmin() ? "all" : me.id;
    main.innerHTML = '<p class="loading">Loading today’s tasks…</p>';
    const from = C.addDays(today, -45), to = C.addDays(today, 7);
    let comps;
    try { comps = await completions(from, to); } catch (e) { main.innerHTML = '<p class="msg error">Couldn’t load tasks. Check your connection and try again.</p>'; return; }
    const ts = tasks.filter((t) => todayFor === "all" || t.maker_ids.includes(todayFor));
    const occ = C.occurrences(ts, comps, from, to);
    const late = [], due = [], waiting = [], done = [], soon = [];
    for (const o of occ) {
      const s = C.state(o, today);
      if (o.due < today) { if (s === "overdue" || s === "returned") late.push(o); else if (s === "submitted") waiting.push(o); }
      else if (o.from <= today) { if (s === "approved") done.push(o); else if (s === "submitted") waiting.push(o); else due.push(o); }
      else if (o.due <= C.addDays(today, 3) && s !== "approved") soon.push(o);
    }
    late.sort((a, b) => a.due.localeCompare(b.due));
    const byKey = new Map(comps.map((c) => [c.task_id + "|" + c.due_date, c]));
    const adhoc = ts.filter((t) => t.active && t.rule.type === "adhoc").map((t) => ({ task: t, due: today, from: today, completion: byKey.get(t.id + "|" + today) || null }));
    const open = late.length + due.length;
    occIndex = new Map();
    const title = todayFor === me.id ? "Your tasks today" : todayFor === "all" ? "Everyone’s tasks today" : personName(todayFor) + "’s tasks today";
    const sw = (id, n, label, ink, extra) => '<a class="sw' + (n ? "" : " zero") + '" href="#/today" data-jump="' + id + '"><i style="background:' + ink + '"' + (extra || "") + "></i><span><b>" + n + "</b><small>" + label + "</small></span></a>";
    main.innerHTML = '<header class="bar"><div><h1>' + title + '</h1><p class="lede">' + (open ? plural(open, "task", "tasks") + " to finish" + (late.length ? ", " + late.length + " of them late" : "") + "." : "Nothing left to do today.") + "</p></div>" +
      '<div class="bar-tools">' + personSelect("t-for", todayFor) + (canExport() ? '<button type="button" class="btn quiet" id="t-export">Export PDF</button>' : "") + "</div></header>" +
      '<div class="deck">' + sw("late", late.length, "Late", "var(--bad)", ' class="hatched"') + sw("due", due.length, "Due today", "var(--m)") + sw("waiting", waiting.length, "Waiting for approval", "var(--amber)") +
      sw("soon", soon.length, "Coming up in 3 days", "var(--g)") + sw("done", done.length, "Approved today", "var(--ok)") + "</div>" +
      groupHtml("late", "Late", late, { tone: "late", showDue: true }) +
      groupHtml("due", "Due today", due, { empty: late.length ? "Nothing else is due today." : "All clear. Nothing is due today." }) +
      groupHtml("waiting", "Waiting for approval", waiting, { showDue: true }) +
      groupHtml("soon", "Coming up in the next 3 days", soon, { showDue: true }) +
      groupHtml("done", "Approved today", done) + groupHtml("adhoc", "As needed", adhoc);
    $("t-for").addEventListener("change", (e) => { todayFor = e.target.value; render(); });
    if ($("t-export")) $("t-export").addEventListener("click", () => openExport(comps));
    main.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); const g = $("g-" + a.dataset.jump); if (g) { g.scrollIntoView({ behavior: "smooth", block: "start" }); g.classList.add("flash"); setTimeout(() => g.classList.remove("flash"), 1200); }
    }));
  }

  // ---------- Calendar ----------
  let calMode = (() => { try { return localStorage.getItem("tasks-cal") === "AD" ? "AD" : "BS"; } catch (e) { return "BS"; } })();
  let calYM = null, calSel = null, calFor = null, calCo = "all";
  async function viewCalendar(main) {
    if (calFor === null) calFor = isAdmin() ? "all" : me.id;
    if (!calYM) { const c = C.calDate(calMode, today); calYM = { y: c.y, m: c.m }; }
    if (!calSel) calSel = today;
    const len = C.monthDays(calMode, calYM.y, calYM.m), first = C.dateOf(calMode, calYM.y, calYM.m, 1), last = C.dateOf(calMode, calYM.y, calYM.m, len);
    main.innerHTML = '<p class="loading">Loading the month…</p>';
    let comps;
    try { comps = await completions(first, last); } catch (e) { main.innerHTML = '<p class="msg error">Couldn’t load the month. Check your connection and try again.</p>'; return; }
    const ts = tasks.filter((t) => (calFor === "all" || t.maker_ids.includes(calFor)) && companyMatch(calCo, t.company));
    const byDay = new Map();
    for (const o of C.occurrences(ts, comps, first, last)) { const l = byDay.get(o.due) || []; l.push(o); byDay.set(o.due, l); }
    const other = calMode === "BS" ? "AD" : "BS";
    const a = C.calDate(other, first), b = C.calDate(other, last), names = calMode === "BS" ? C.AD_MONTHS : C.BS_MONTHS;
    const span = names[a.m - 1] + " " + a.d + (a.y === b.y ? "" : ", " + a.y) + " – " + names[b.m - 1] + " " + b.d + ", " + b.y;
    const cells = Array(C.weekday(first)).fill(null).concat(Array.from({ length: len }, (_, i) => C.addDays(first, i)));
    while (cells.length % 7) cells.push(null);
    const canPrev = calMode !== "BS" || calYM.y > C.BS_FIRST_YEAR || calYM.m > 1, canNext = calMode !== "BS" || calYM.y < C.BS_LAST_YEAR || calYM.m < 12;
    const cell = (d) => {
      if (!d) return '<div class="cell blank" role="gridcell"></div>';
      const items = byDay.get(d) || [], states = items.map((o) => C.state(o, today));
      const lateN = states.filter((s) => s === "overdue" || s === "returned").length, doneN = states.filter((s) => s === "approved").length;
      const sat = C.weekday(d) === C.HOLIDAY;
      return '<button type="button" role="gridcell" class="cell' + (sat ? " sat" : "") + (d === today ? " today" : "") + (d === calSel ? " selected" : "") + '" data-day="' + d + '" aria-selected="' + (d === calSel) +
        '" aria-label="' + esc(C.fmtBS(d) + ", " + C.fmtADShort(d) + ": " + plural(items.length, "task", "tasks") + (lateN ? ", " + lateN + " late" : "")) + '">' +
        '<span class="cd"><b>' + C.calDate(calMode, d).d + "</b><small>" + C.calDate(other, d).d + "</small></span>" +
        '<span class="ci">' + items.slice(0, 3).map((o, i) => '<span class="it">' + mark(states[i], 12) + "<span>" + esc(o.task.name) + "</span></span>").join("") +
        (items.length > 3 ? '<span class="more">+' + (items.length - 3) + " more</span>" : "") + "</span>" +
        (items.length ? '<span class="cc">' + (lateN ? '<b class="late">' + lateN + " late</b>" : doneN === items.length ? '<b class="ok">all done</b>' : items.length) + "</span>" : "") + "</button>";
    };
    const sel = byDay.get(calSel) || [];
    occIndex = new Map();
    main.innerHTML = '<header class="bar"><div><h1>' + (calMode === "BS" ? '<span class="np">' + C.NP_MONTHS[calYM.m - 1] + " " + C.npDigits(calYM.y) + "</span> " + C.BS_MONTHS[calYM.m - 1] + " " + calYM.y : C.AD_MONTHS[calYM.m - 1] + " " + calYM.y) +
      '</h1><p class="lede">' + span + "</p></div>" +
      '<div class="bar-tools"><div class="seg" role="group" aria-label="Calendar"><button type="button" data-cal="BS" aria-pressed="' + (calMode === "BS") + '">BS month</button><button type="button" data-cal="AD" aria-pressed="' + (calMode === "AD") + '">AD month</button></div>' +
      '<button type="button" class="btn quiet" id="c-today">Today</button><button type="button" class="btn quiet icon-only" id="c-prev" aria-label="Previous month"' + (canPrev ? "" : " disabled") + ">" + ICON.prev + '</button><button type="button" class="btn quiet icon-only" id="c-next" aria-label="Next month"' + (canNext ? "" : " disabled") + ">" + ICON.next + "</button></div></header>" +
      '<div class="toolbar">' + personSelect("c-for", calFor) + companySelect("c-co", calCo) + '<span class="spacer"></span>' + legend() + "</div>" +
      '<div class="cal-wrap"><div class="patro sheet" role="grid" aria-label="Month"><div class="prow wd" role="row">' + C.WD_SHORT.map((w, i) => '<div role="columnheader"' + (i === 6 ? ' class="sat"' : "") + "><span>" + w + '</span> <span class="np">' + C.NP_WD[i] + "</span></div>").join("") + "</div>" +
      Array.from({ length: cells.length / 7 }, (_, r) => '<div class="prow" role="row">' + cells.slice(r * 7, r * 7 + 7).map(cell).join("") + "</div>").join("") + "</div>" +
      '<section class="group day-panel" aria-live="polite"><div class="group-head"><h2>' + dateLine(calSel) + "</h2>" + (sel.length ? '<span class="n">' + sel.length + "</span>" : "") + '</div><div class="sheet">' +
      (sel.length ? '<ul class="occ-list">' + sel.map((o) => occRow(o, false)).join("") + "</ul>" : '<p class="empty">' + (C.weekday(calSel) === C.HOLIDAY ? "Saturday. No tasks are scheduled." : "No tasks fall on this day for these filters.") + "</p>") + "</div></section></div>";
    main.querySelectorAll("[data-cal]").forEach((bt) => bt.addEventListener("click", () => {
      calMode = bt.dataset.cal; try { localStorage.setItem("tasks-cal", calMode); } catch (e) {}
      const c = C.calDate(calMode, calSel); calYM = { y: c.y, m: c.m }; render();
    }));
    $("c-today").addEventListener("click", () => { const c = C.calDate(calMode, today); calYM = { y: c.y, m: c.m }; calSel = today; render(); });
    $("c-prev").addEventListener("click", () => { calYM = C.shiftMonth(calYM.y, calYM.m, -1); render(); });
    $("c-next").addEventListener("click", () => { calYM = C.shiftMonth(calYM.y, calYM.m, 1); render(); });
    $("c-for").addEventListener("change", (e) => { calFor = e.target.value; render(); });
    $("c-co").addEventListener("change", (e) => { calCo = e.target.value; render(); });
    main.querySelectorAll("[data-day]").forEach((c) => c.addEventListener("click", () => { calSel = c.dataset.day; render(); }));
    main.querySelector(".patro").addEventListener("keydown", (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!step) return;
      e.preventDefault();
      const n = C.addDays(calSel, step);
      if (n < first || n > last) { calYM = C.shiftMonth(calYM.y, calYM.m, step > 0 ? 1 : -1); }
      calSel = n; render().then(() => { const c = document.querySelector('[data-day="' + n + '"]'); if (c) c.focus(); });
    });
  }

  // ---------- All tasks ----------
  const tf = { q: "", who: "all", co: "all", freq: "all", retired: false, sort: "next", dir: 1 };
  function viewTasks(main) {
    if (tf.who === "all" && !isAdmin() && tf._init !== true) { tf.who = me.id; tf._init = true; }
    const retiredN = tasks.filter((t) => !t.active).length;
    main.innerHTML = '<header class="bar"><div><h1>All tasks</h1><p class="lede">' + plural(tasks.filter((t) => t.active).length, "recurring task", "recurring tasks") + " across both companies." +
      (isAdmin() ? " Pick a task to change its name, maker, schedule or recipient." : "") + "</p></div>" + (isAdmin() ? '<a class="btn" href="#/tasks/new">Add task</a>' : "") + "</header>" +
      '<div class="toolbar"><div class="search">' + ICON.search + '<input type="search" id="a-q" placeholder="Search by report or recipient" aria-label="Search tasks" value="' + esc(tf.q) + '"><kbd aria-hidden="true">/</kbd></div>' +
      personSelect("a-who", tf.who) + companySelect("a-co", tf.co) +
      '<label class="inline"><span class="sr-only">Frequency</span><select id="a-freq"><option value="all">Any frequency</option>' + FREQS.map((f) => "<option" + (tf.freq === f ? " selected" : "") + ">" + f + "</option>").join("") + "</select></label>" +
      (retiredN ? '<label class="check"><input type="checkbox" id="a-ret"' + (tf.retired ? " checked" : "") + "> Show " + retiredN + " retired</label>" : "") + "</div>" +
      '<div class="sheet table-wrap" id="a-table"></div>';
    const paint = () => {
      const q = tf.q.trim().toLowerCase();
      const rows = tasks.filter((t) => (tf.retired || t.active) && (tf.who === "all" || t.maker_ids.includes(tf.who)) && companyMatch(tf.co, t.company) && (tf.freq === "all" || t.frequency === tf.freq) &&
        (!q || (t.name + " " + t.reporting_to).toLowerCase().includes(q))).map((t) => ({ t, next: C.nextDue(t, today), makers: t.maker_ids.map(personName).join(" / ") }));
      const key = (r) => ({ name: r.t.name.toLowerCase(), maker: r.makers.toLowerCase(), frequency: String(FREQS.indexOf(r.t.frequency)).padStart(2, "0"), next: r.next || "9999" })[tf.sort];
      rows.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * tf.dir);
      const th = (k, label) => '<th aria-sort="' + (tf.sort === k ? (tf.dir === 1 ? "ascending" : "descending") : "none") + '"><button type="button" class="th-sort" data-sort="' + k + '">' + label + (tf.sort === k ? (tf.dir === 1 ? " ↑" : " ↓") : "") + "</button></th>";
      const when = (n) => { const d = C.diffDays(n, today); return d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 7 ? C.WD_SHORT[C.weekday(n)] : "in " + d + " days"; };
      const noNext = (t) => t.rule.type === "adhoc" ? '<span class="muted">As needed</span>' : t.rule.type === "yearly" && (t.rule.month == null || t.rule.day == null) ? '<span class="warn">Set a due date</span>' : '<span class="muted">' + (t.active ? "None ahead" : "Retired") + "</span>";
      $("a-table").innerHTML = rows.length ? "<table><thead><tr>" + th("name", "Report") + th("maker", "Maker") + '<th class="hide-sm">Reporting to</th>' + th("frequency", "Frequency") + '<th class="hide-sm">Schedule</th>' + th("next", "Next due") + "</tr></thead><tbody>" +
        rows.map(({ t, next, makers }) => "<tr" + (isAdmin() ? ' class="pick" data-task="' + t.id + '" tabindex="0"' : "") + (t.active ? "" : ' data-retired') + '><td><b>' + esc(t.name) + (t.active ? "" : " (retired)") + '</b><span class="tag">' + CO_SHORT[t.company] + "</span></td><td>" + esc(makers) +
          '</td><td class="hide-sm">' + esc(t.reporting_to || "–") + "</td><td>" + esc(t.frequency) + '</td><td class="hide-sm muted">' + esc(C.describe(t.rule)) + "</td><td>" + (next ? "<b>" + bsShort(next) + '</b><small>' + when(next) + " · " + C.fmtADShort(next, false) + "</small>" : noNext(t)) + "</td></tr>").join("") + "</tbody></table>"
        : '<p class="empty"><b>No tasks match.</b> Clear the search or filters to see everything.</p>';
      $("a-table").querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { tf.dir = tf.sort === b.dataset.sort ? -tf.dir : 1; tf.sort = b.dataset.sort; paint(); }));
      $("a-table").querySelectorAll("tr[data-task]").forEach((tr) => {
        tr.addEventListener("click", () => (location.hash = "#/tasks/" + tr.dataset.task));
        tr.addEventListener("keydown", (e) => { if (e.key === "Enter") location.hash = "#/tasks/" + tr.dataset.task; });
      });
    };
    paint();
    $("a-q").addEventListener("input", (e) => { tf.q = e.target.value; paint(); });
    $("a-who").addEventListener("change", (e) => { tf.who = e.target.value; paint(); });
    $("a-co").addEventListener("change", (e) => { tf.co = e.target.value; paint(); });
    $("a-freq").addEventListener("change", (e) => { tf.freq = e.target.value; paint(); });
    if ($("a-ret")) $("a-ret").addEventListener("change", (e) => { tf.retired = e.target.checked; paint(); });
  }

  // ---------- Task editor ----------
  function firstWeekdayFrom(d, wd) { for (let i = 0; i < 7; i++) { const x = C.addDays(d, i); if (C.weekday(x) === wd) return x; } return d; }
  function ruleFor(type, prev) {
    const cal = prev && prev.cal ? prev.cal : "BS";
    switch (type) {
      case "daily": return { type };
      case "weekdays": return { type, days: prev && prev.type === "weekdays" ? prev.days : [] };
      case "everyOtherWeek": return { type, day: 5, anchor: firstWeekdayFrom(today, 5) };
      case "monthDay": return { type, cal, day: 7 };
      case "nthWeekday": return { type, cal, n: 1, day: 0 };
      case "lastWeek": return { type, cal };
      case "yearly": return { type, cal, month: C.calDate(cal, today).m, day: 1 };
      case "once": return { type, date: today };
      case "adhoc": return { type };
    }
  }
  function viewEditor(main, id) {
    const t = id ? tasks.find((x) => x.id === id) : null;
    if (id && !t) { main.innerHTML = '<p class="msg error">That task doesn’t exist any more. <a href="#/tasks">Back to all tasks</a></p>'; return; }
    const f = { name: t ? t.name : "", company: t ? t.company : "Both", makers: t ? [...t.maker_ids] : [], reporting_to: t ? t.reporting_to : "",
      rule: t ? JSON.parse(JSON.stringify(t.rule)) : { type: "daily" }, frequency: t ? t.frequency : "Daily", freqTouched: !!t, start: t ? t.start_date : today, notes: t ? t.notes : "", tried: false, saving: false };
    const choosable = people.filter((p) => p.active || f.makers.includes(p.id));
    const recipients = [...new Set(tasks.map((x) => x.reporting_to).filter(Boolean))].sort();
    const errors = () => {
      const e = {};
      if (!f.name.trim()) e.name = "Give the report a name.";
      if (!f.makers.length) e.makers = "Pick at least one maker.";
      if (f.rule.type === "weekdays" && !f.rule.days.length) e.rule = "Pick at least one day.";
      if (f.rule.type === "yearly" && (f.rule.month == null || f.rule.day == null)) e.rule = "Pick the month and day.";
      if ((f.rule.type === "once" || f.rule.type === "everyOtherWeek") && !C.inRange(f.rule.type === "once" ? f.rule.date : f.rule.anchor)) e.rule = "That date is outside the calendar this app knows (2078 to " + C.BS_LAST_YEAR + " BS).";
      return e;
    };
    const setRule = (r) => { f.rule = r; if (!f.freqTouched) f.frequency = C.frequencyOf(r); paintForm(); };
    const ruleFields = () => {
      const r = f.rule, opt = (v, l, s) => '<option value="' + v + '"' + (s ? " selected" : "") + ">" + l + "</option>";
      switch (r.type) {
        case "weekdays": return '<div class="field"><span class="flabel">On these days</span><div class="chips" role="group" aria-label="Days">' + C.WD_SHORT.map((w, i) =>
          '<button type="button" class="chip' + (i === 6 ? " sat" : "") + '" data-wd="' + i + '" aria-pressed="' + r.days.includes(i) + '">' + w + "</button>").join("") + "</div></div>";
        case "everyOtherWeek": return '<div class="row2"><label class="field"><span class="flabel">Day</span><select data-r="day">' + C.WEEKDAYS.map((w, i) => opt(i, w, r.day === i)).join("") + '</select></label>' +
          '<label class="field"><span class="flabel">First due on' + (C.inRange(r.anchor) ? ' <span class="hint">· ' + C.fmtBS(r.anchor) + " BS</span>" : "") + '</span><input type="date" data-r="anchor" value="' + r.anchor + '"></label></div>';
        case "monthDay": return '<label class="field"><span class="flabel">Day of the month' + (r.cal === "BS" ? ' <span class="hint">· if the month is shorter, it falls on the last day</span>' : "") + '</span><select data-r="day">' +
          Array.from({ length: r.cal === "BS" ? 32 : 31 }, (_, i) => opt(i + 1, C.ordinal(i + 1), r.day === i + 1)).join("") + "</select></label>";
        case "nthWeekday": return '<div class="row2"><label class="field"><span class="flabel">Which one</span><select data-r="n">' + [[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [-1, "Last"]].map(([v, l]) => opt(v, l, r.n === v)).join("") + "</select></label>" +
          '<label class="field"><span class="flabel">Day</span><select data-r="day">' + C.WEEKDAYS.map((w, i) => opt(i, w, r.day === i)).join("") + "</select></label></div>";
        case "lastWeek": return '<p class="hint-line">Shows from 7 days before the month ends and is due on the month’s last day.</p>';
        case "yearly": {
          const names = r.cal === "BS" ? C.BS_MONTHS : C.AD_MONTHS, cy = C.calDate(r.cal, today).y, maxD = r.month ? C.monthDays(r.cal, cy, r.month) : 32;
          return '<div class="row2"><label class="field"><span class="flabel">Month</span><select data-r="month">' + opt("", "Pick a month", r.month == null) + names.map((n, i) => opt(i + 1, n, r.month === i + 1)).join("") + "</select></label>" +
            '<label class="field"><span class="flabel">Day</span><select data-r="day">' + opt("", "Pick a day", r.day == null) + Array.from({ length: maxD }, (_, i) => opt(i + 1, i + 1, r.day === i + 1)).join("") + "</select></label></div>";
        }
        case "once": return '<label class="field"><span class="flabel">Date' + (C.inRange(r.date) ? ' <span class="hint">· ' + C.fmtBS(r.date) + " BS</span>" : "") + '</span><input type="date" data-r="date" value="' + r.date + '"></label>';
      }
      return "";
    };
    const preview = () => {
      const e = errors();
      if (f.rule.type === "adhoc") return '<p class="muted">No schedule. It shows under “As needed” and the maker marks it done whenever it happens.</p>';
      if (e.rule) return '<p class="muted">Fix the schedule to see dates.</p>';
      const s = f.start > today ? f.start : today;
      const list = C.occurrences([{ id: "draft", rule: f.rule, start_date: f.start, active: true, maker_ids: [] }], [], s, C.addDays(s, 420)).slice(0, 6);
      return list.length ? '<ol class="dates">' + list.map((o) => { const b = C.toBS(o.due); return '<li><span class="dblock"><b>' + b.d + "</b><small>" + Number(o.due.slice(8)) + '</small></span><span><b>' + C.fmtBS(o.due) + "</b><small>" + C.WEEKDAYS[C.weekday(o.due)] + ", " + C.fmtADShort(o.due) + "</small></span></li>"; }).join("") + "</ol>"
        : '<p class="muted">No dates in the next 14 months.</p>';
    };
    const paintForm = () => {
      const e = f.tried ? errors() : {};
      main.innerHTML = '<a class="crumb" href="#/tasks">Back to all tasks</a><header class="bar"><div><h1>' + (t ? "Edit task" : "Add a task") + "</h1>" + (t && !t.active ? '<p class="lede">This task is retired. It doesn’t show on anyone’s list.</p>' : "") + "</div></header>" +
        '<form class="editor" id="ed" novalidate><div class="sheet form-card"><h2>The report</h2>' +
        '<label class="field"><span class="flabel">Report name</span><input id="e-name" value="' + esc(f.name) + '" placeholder="e.g. VAT - All Co."' + (e.name ? ' aria-invalid="true"' : "") + ">" + (e.name ? '<span class="err">' + e.name + "</span>" : "") + "</label>" +
        '<div class="row2"><label class="field"><span class="flabel">Company</span><select id="e-co">' + COMPANIES.map((c) => "<option" + (f.company === c ? " selected" : "") + ">" + c + "</option>").join("") + "</select></label>" +
        '<label class="field"><span class="flabel">Reporting to <span class="hint">· who receives it</span></span><input id="e-to" list="recipients" value="' + esc(f.reporting_to) + '" placeholder="e.g. BOD, FJT-A, Modi Sir"><datalist id="recipients">' + recipients.map((r) => '<option value="' + esc(r) + '">').join("") + "</datalist></label></div>" +
        '<div class="field"><span class="flabel">Maker <span class="hint">· if you pick two, either one can mark it done</span></span><div class="chips" role="group" aria-label="Makers">' +
        choosable.map((p) => '<button type="button" class="chip" data-maker="' + p.id + '" aria-pressed="' + f.makers.includes(p.id) + '">' + esc(p.full_name) + "</button>").join("") + "</div>" + (e.makers ? '<span class="err">' + e.makers + "</span>" : "") + "</div>" +
        '<h2>When it’s due</h2><div class="row2"><label class="field"><span class="flabel">Repeats</span><select id="e-type">' + RULES.map(([v, l]) => '<option value="' + v + '"' + (f.rule.type === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
        ("cal" in f.rule ? '<div class="field"><span class="flabel">Calendar</span><div class="seg" role="group" aria-label="Calendar"><button type="button" data-rcal="BS" aria-pressed="' + (f.rule.cal === "BS") + '">BS (Nepali)</button><button type="button" data-rcal="AD" aria-pressed="' + (f.rule.cal === "AD") + '">AD (English)</button></div></div>' : "<div></div>") + "</div>" +
        ruleFields() + (f.rule.type !== "daily" && f.rule.type !== "adhoc" ? '<p class="hint-line">If a due date falls on a Saturday, it moves to the Sunday after.</p>' : "") + (e.rule ? '<p class="err">' + e.rule + "</p>" : "") +
        '<div class="row2"><label class="field"><span class="flabel">Frequency label <span class="hint">· shown in lists; filled in for you</span></span><select id="e-freq">' + FREQS.map((x) => "<option" + (f.frequency === x ? " selected" : "") + ">" + x + "</option>").join("") + "</select></label>" +
        '<label class="field"><span class="flabel">Starts from <span class="hint">· ' + (C.inRange(f.start) ? C.fmtBS(f.start) + " BS" : "") + '</span></span><input type="date" id="e-start" value="' + f.start + '"></label></div>' +
        '<label class="field"><span class="flabel">Notes <span class="hint">· where to send it, format, anything the maker should know</span></span><textarea id="e-notes" rows="3">' + esc(f.notes) + "</textarea></label>" +
        '<div class="form-actions">' + (t ? '<button type="button" class="btn ' + (t.active ? "danger-quiet" : "quiet") + ' left" id="e-retire">' + (t.active ? "Retire this task" : "Bring task back") + "</button>" : "") +
        '<a class="btn quiet" href="#/tasks">Cancel</a><button class="btn" id="e-save">' + (f.saving ? "Saving…" : t ? "Save changes" : "Add task") + "</button></div></div>" +
        '<aside class="sheet preview" aria-live="polite"><h2>Next due dates</h2><p class="rule">' + esc(C.describe(f.rule)) + "</p>" + preview() + "</aside></form>";
      const keep = (id, k) => $(id).addEventListener("input", (ev) => { f[k] = ev.target.value; });
      keep("e-name", "name"); keep("e-to", "reporting_to"); keep("e-notes", "notes");
      $("e-co").addEventListener("change", (ev) => (f.company = ev.target.value));
      $("e-freq").addEventListener("change", (ev) => { f.frequency = ev.target.value; f.freqTouched = true; });
      $("e-start").addEventListener("change", (ev) => { if (ev.target.value) { f.start = ev.target.value; paintForm(); } });
      $("e-type").addEventListener("change", (ev) => setRule(ruleFor(ev.target.value, f.rule)));
      main.querySelectorAll("[data-maker]").forEach((b) => b.addEventListener("click", () => { const id = b.dataset.maker; f.makers = f.makers.includes(id) ? f.makers.filter((x) => x !== id) : [...f.makers, id]; paintForm(); }));
      main.querySelectorAll("[data-rcal]").forEach((b) => b.addEventListener("click", () => setRule(Object.assign({}, f.rule, { cal: b.dataset.rcal }))));
      main.querySelectorAll("[data-wd]").forEach((b) => b.addEventListener("click", () => { const d = +b.dataset.wd, days = f.rule.days.includes(d) ? f.rule.days.filter((x) => x !== d) : [...f.rule.days, d].sort(); setRule(Object.assign({}, f.rule, { days })); }));
      main.querySelectorAll("[data-r]").forEach((el) => el.addEventListener("change", () => {
        const k = el.dataset.r, v = el.value;
        const r = Object.assign({}, f.rule);
        if (k === "anchor") { if (!v) return; r.anchor = v; r.day = C.weekday(v); }
        else if (k === "date") { if (!v) return; r.date = v; }
        else if (k === "day" && f.rule.type === "everyOtherWeek") { r.day = +v; r.anchor = firstWeekdayFrom(today, +v); }
        else r[k] = v === "" ? null : +v;
        setRule(r);
      }));
      const save = async (active) => {
        f.tried = true;
        if (Object.keys(errors()).length) { paintForm(); const bad = main.querySelector("[aria-invalid], .err"); if (bad) bad.scrollIntoView({ block: "center" }); return; }
        f.saving = true; $("e-save").disabled = true;
        const ok = await act(() => api.saveTask({ id: t ? t.id : undefined, name: f.name.trim(), company: f.company, maker_ids: f.makers, reporting_to: f.reporting_to.trim(),
          frequency: f.frequency, rule: f.rule, start_date: f.start, notes: f.notes.trim(), active }), t ? (active === t.active ? "Saved." : active ? "Task brought back." : "Task retired.") : "Task added.");
        f.saving = false;
        if (ok !== undefined) location.hash = "#/tasks";
      };
      $("ed").addEventListener("submit", (ev) => { ev.preventDefault(); save(t ? t.active : true); });
      if ($("e-retire")) $("e-retire").addEventListener("click", () => save(!t.active));
    };
    paintForm();
    if (!t) $("e-name").focus();
  }

  // ---------- Review ----------
  async function viewReview(main) {
    main.innerHTML = '<p class="loading">Loading…</p>';
    let waiting, recent;
    try { [waiting, recent] = await Promise.all([api.submitted(), completions(C.addDays(today, -14), C.addDays(today, 31))]); }
    catch (e) { main.innerHTML = '<p class="msg error">Couldn’t load. Check your connection and try again.</p>'; return; }
    const toOcc = (c) => { const t = tasks.find((x) => x.id === c.task_id); return t ? { task: t, due: c.due_date, from: c.due_date, completion: c } : null; };
    const w = waiting.map(toOcc).filter(Boolean).sort((a, b) => a.due.localeCompare(b.due));
    const r = recent.filter((c) => c.status !== "submitted" && c.reviewed_at).sort((a, b) => (b.reviewed_at || "").localeCompare(a.reviewed_at || "")).slice(0, 25).map(toOcc).filter(Boolean);
    occIndex = new Map();
    main.innerHTML = '<header class="bar"><div><h1>Review</h1><p class="lede">' + (w.length ? plural(w.length, "task", "tasks") + " marked done and waiting for you." : "Nothing waiting. Every finished task has been reviewed.") + "</p></div>" +
      (w.length > 1 ? '<button type="button" class="btn approve" id="r-all">Approve all ' + w.length + "</button>" : "") + "</header>" +
      '<section class="group"><div class="sheet">' + (w.length ? '<ul class="occ-list">' + w.map((o) => occRow(o, true)).join("") + "</ul>" : '<p class="empty"><b>You’re caught up.</b> When someone marks a task done it lands here.</p>') + "</div></section>" +
      (r.length ? groupHtml("recent", "Recently reviewed", r, { showDue: true }) : "");
    if ($("r-all")) $("r-all").addEventListener("click", async () => {
      $("r-all").disabled = true;
      const ids = w.map((o) => o.completion.id);
      await act(async () => { for (const id of ids) await api.review(id, "approved", ""); }, "Approved " + plural(ids.length, "task", "tasks") + ".",
        () => act(async () => { for (const id of ids) await api.reopen(id); }, "Back to waiting for approval."));
    });
  }

  // ---------- People ----------
  const userFrom = (name) => (name.trim().toLowerCase().split(/\s+/)[0] || "").replace(/[^a-z0-9._-]/g, "");
  function viewPeople(main) {
    const active = (p) => tasks.filter((t) => t.active && t.maker_ids.includes(p.id)).length;
    main.innerHTML = '<header class="bar"><div><h1>People</h1><p class="lede">Each person signs in with their username and password.</p></div><button type="button" class="btn" id="p-add">Add person</button></header>' +
      '<div class="sheet table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th class="hide-sm">Role</th><th class="hide-sm">Active tasks</th><th>PDF export</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      people.map((p) => "<tr" + (p.active ? "" : ' class="off"') + "><td><b>" + esc(p.full_name) + "</b>" + (p.id === me.id ? ' <span class="muted">(you)</span>' : "") + (p.active ? "" : ' <span class="muted">· turned off</span>') +
        "</td><td>" + esc(p.username) + '</td><td class="hide-sm">' + (p.role === "admin" ? "Admin" : "Maker") + '</td><td class="hide-sm">' + active(p) + "</td><td>" +
        (p.role === "admin" ? '<span class="muted">Always</span>' : '<label class="check"><input type="checkbox" data-export="' + p.id + '"' + (p.can_export ? " checked" : "") + '><span class="sr-only">Can export PDF:</span> ' + (p.can_export ? "Allowed" : "Off") + "</label>") +
        '</td><td class="row-actions"><button type="button" class="btn sm quiet" data-pw="' + p.id + '">New password</button>' +
        (p.id !== me.id ? '<button type="button" class="btn sm ' + (p.active ? "danger-quiet" : "quiet") + '" data-toggle="' + p.id + '">' + (p.active ? "Turn off login" : "Turn on login") + "</button>" : "") + "</td></tr>").join("") +
      "</tbody></table></div>";
    $("p-add").addEventListener("click", () => openAddPerson());
    main.querySelectorAll("[data-export]").forEach((c) => c.addEventListener("change", () => act(() => api.updatePerson(c.dataset.export, { can_export: c.checked }), c.checked ? "PDF export allowed." : "PDF export turned off.")));
    main.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
      const p = people.find((x) => x.id === b.dataset.toggle);
      act(() => api.updatePerson(p.id, { active: !p.active }), p.active ? p.full_name + " can't sign in now." : p.full_name + " can sign in again.",
        () => act(() => api.updatePerson(p.id, { active: p.active }), "Put back."));
    }));
    main.querySelectorAll("[data-pw]").forEach((b) => b.addEventListener("click", () => openPassword(people.find((x) => x.id === b.dataset.pw))));
  }
  function openAddPerson() {
    const body = openPanel("Add person",
      '<form id="ap" class="stack" novalidate><label class="field"><span class="flabel">Full name</span><input id="ap-name" autocomplete="off"></label>' +
      '<label class="field"><span class="flabel">Username <span class="hint">· lowercase, no spaces</span></span><input id="ap-user" autocapitalize="none" spellcheck="false"></label>' +
      '<label class="field"><span class="flabel">Starting password <span class="hint">· at least 8 characters</span></span><input id="ap-pass" autocomplete="off"></label>' +
      '<label class="field"><span class="flabel">Role</span><select id="ap-role"><option value="maker">Maker: sees and finishes tasks</option><option value="admin">Admin: also approves and edits tasks</option></select></label>' +
      '<p class="err" id="ap-err" role="alert"></p><div class="form-actions"><button type="button" class="btn quiet" id="ap-cancel">Cancel</button><button class="btn" id="ap-save">Add person</button></div></form>');
    let userTouched = false;
    $("ap-name").addEventListener("input", (e) => { if (!userTouched) $("ap-user").value = userFrom(e.target.value); });
    $("ap-user").addEventListener("input", (e) => { userTouched = true; e.target.value = e.target.value.toLowerCase(); });
    $("ap-cancel").addEventListener("click", closePanel);
    $("ap").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("ap-name").value.trim(), user = $("ap-user").value.trim(), pass = $("ap-pass").value, role = $("ap-role").value;
      const err = !name ? "Add their full name." : !/^[a-z0-9._-]{2,30}$/.test(user) ? "Use 2–30 lowercase letters, numbers, dot, dash or underscore for the username." : pass.length < 8 ? "The starting password needs at least 8 characters." : "";
      if (err) { $("ap-err").textContent = err; return; }
      $("ap-save").disabled = true;
      const ok = await act(() => api.manage({ action: "create", full_name: name, username: user, password: pass, role, email: user + "@" + DOMAIN }), name + " can now sign in as “" + user + "”.");
      if (ok !== undefined) closePanel(); else $("ap-save").disabled = false;
    });
    body.querySelector("#ap-name").focus();
  }
  function openPassword(p) {
    openPanel("New password for " + esc(p.full_name),
      '<form id="np" class="stack"><label class="field"><span class="flabel">New password <span class="hint">· at least 8 characters</span></span><input id="np-pass" autocomplete="off"></label>' +
      '<p class="muted">Share it with them privately. They can sign in with it straight away.</p><p class="err" id="np-err" role="alert"></p>' +
      '<div class="form-actions"><button type="button" class="btn quiet" id="np-cancel">Cancel</button><button class="btn" id="np-save">Set password</button></div></form>');
    $("np-pass").focus();
    $("np-cancel").addEventListener("click", closePanel);
    $("np").addEventListener("submit", async (e) => {
      e.preventDefault();
      if ($("np-pass").value.length < 8) { $("np-err").textContent = "Use at least 8 characters."; return; }
      $("np-save").disabled = true;
      const ok = await act(() => api.manage({ action: "set-password", id: p.id, password: $("np-pass").value }), "Password changed for " + p.full_name + ".");
      if (ok !== undefined) closePanel(); else $("np-save").disabled = false;
    });
  }

  // ---------- PDF export: overdue and the next working day's tasks, one section per person ----------
  function openExport(comps) {
    const nextDay = C.nextWorkingDay(today);
    const makers = people.filter((p) => p.active && tasks.some((t) => t.active && t.maker_ids.includes(p.id)));
    const ex = { who: "all", withToday: false };
    const sections = () => {
      const occ = C.occurrences(tasks, comps, C.addDays(today, -45), nextDay);
      const open = (o) => { const s = C.state(o, today); return s === "overdue" || s === "returned" || s === "pending"; };
      return (ex.who === "all" ? makers : makers.filter((p) => p.id === ex.who)).map((p) => {
        const mine = occ.filter((o) => o.task.maker_ids.includes(p.id));
        return { person: p, overdue: mine.filter((o) => o.due < today && open(o)).sort((a, b) => a.due.localeCompare(b.due)),
          today: ex.withToday ? mine.filter((o) => o.due === today && open(o)) : [], next: mine.filter((o) => o.due === nextDay && open(o)) };
      });
    };
    const dayName = C.WEEKDAYS[C.weekday(nextDay)];
    const body = openPanel("Export overdue and " + dayName + "’s tasks",
      '<p>One section per person with their overdue tasks and what’s due on ' + dayName + ", " + C.fmtBS(nextDay, false) + " (" + C.fmtADShort(nextDay, false) + ")" +
      (C.weekday(C.addDays(today, 1)) === C.HOLIDAY ? ", the next working day after Saturday" : "") + ".</p>" +
      '<label class="field"><span class="flabel">For</span><select id="x-who"><option value="all">Everyone, one section each</option>' + makers.map((p) => '<option value="' + p.id + '">' + esc(p.full_name) + " only</option>").join("") + "</select></label>" +
      '<label class="check"><input type="checkbox" id="x-today"> Also include today’s unfinished tasks</label><p class="count-line" id="x-count"></p>' +
      '<div class="form-actions">' + (navigator.canShare && navigator.canShare({ files: [new File([""], "x.pdf", { type: "application/pdf" })] }) ? '<button type="button" class="btn quiet" id="x-share">Share</button>' : "") +
      '<button type="button" class="btn" id="x-dl">Download PDF</button></div><p class="err" id="x-err" role="alert"></p>');
    const count = () => {
      const s = sections(), sum = (k) => s.reduce((n, x) => n + x[k].length, 0);
      $("x-count").innerHTML = '<b class="late">' + sum("overdue") + " overdue</b>" + (ex.withToday ? " · " + sum("today") + " open today" : "") + " · " + sum("next") + " due " + dayName;
    };
    count();
    $("x-who").addEventListener("change", (e) => { ex.who = e.target.value; count(); });
    $("x-today").addEventListener("change", (e) => { ex.withToday = e.target.checked; count(); });
    const fileName = () => { const b = C.toBS(today), who = ex.who === "all" ? "everyone" : (people.find((p) => p.id === ex.who) || {}).username || "person"; return "tasks-" + b.y + "-" + String(b.m).padStart(2, "0") + "-" + String(b.d).padStart(2, "0") + "-" + who + ".pdf"; };
    const go = async (btn, share) => {
      $("x-err").textContent = ""; const label = btn.textContent; btn.disabled = true; btn.textContent = "Preparing…";
      try {
        const blob = await buildPdf(sections(), nextDay, ex.withToday);
        if (share) { await navigator.share({ files: [new File([blob], fileName(), { type: "application/pdf" })], title: "Overdue and upcoming tasks" }); }
        else { const url = URL.createObjectURL(blob), a = Object.assign(document.createElement("a"), { href: url, download: fileName() }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1e4); }
      } catch (e) { if (e.name !== "AbortError") $("x-err").textContent = "Couldn’t make the PDF. Check your connection and try again."; }
      btn.disabled = false; btn.textContent = label;
    };
    $("x-dl").addEventListener("click", (e) => go(e.currentTarget, false));
    if ($("x-share")) $("x-share").addEventListener("click", (e) => go(e.currentTarget, true));
    return body;
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.appendChild(s); }); }
  async function buildPdf(sections, nextDay, withToday) {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    if (typeof new window.jspdf.jsPDF().autoTable !== "function") await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    const INK = [29, 32, 36], MUTED = [85, 90, 98], LINE = [226, 228, 223], W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const head = { fillColor: [36, 39, 43], textColor: [255, 255, 255], fontStyle: "bold" };
    doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...INK);
    doc.text("Overdue and " + C.WEEKDAYS[C.weekday(nextDay)] + "'s tasks", 40, 48);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...MUTED);
    doc.text("Today " + C.fmtBS(today) + " (" + C.fmtADShort(today) + ")     Next working day " + C.fmtBS(nextDay) + " (" + C.fmtADShort(nextDay) + ")     Prepared by " + me.full_name, 40, 66);
    let y = 88;
    const table = (title, rows, lateCol) => {
      if (!rows.length) return;
      if (y > H - 120) { doc.addPage(); y = 50; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(...(lateCol ? [179, 52, 58] : INK)); doc.text(title + " (" + rows.length + ")", 40, y); y += 6;
      doc.autoTable({ startY: y, theme: "grid", margin: { left: 40, right: 40 }, styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5, overflow: "linebreak" }, headStyles: head,
        head: [["Task", "Due (BS)", "Due (AD)"].concat(lateCol ? ["Late"] : [], ["Reporting to", "Company"])],
        body: rows.map((o) => [o.task.name, C.fmtBS(o.due, false), C.fmtADShort(o.due, false)].concat(lateCol ? [C.diffDays(today, o.due) + " d"] : [], [o.task.reporting_to || "–", CO_SHORT[o.task.company]])),
        columnStyles: { 0: { cellWidth: 190 } } });
      y = doc.lastAutoTable.finalY + 16;
    };
    for (const s of sections) {
      if (!s.overdue.length && !s.next.length && !s.today.length) continue;
      if (y > H - 140) { doc.addPage(); y = 50; }
      doc.setFillColor(200, 35, 122); doc.rect(40, y - 11, 4, 15, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...INK); doc.text(s.person.full_name, 50, y); y += 16;
      table("Overdue", s.overdue, true);
      if (withToday) table("Due today, not finished", s.today, false);
      table("Due " + C.WEEKDAYS[C.weekday(nextDay)], s.next, false);
    }
    if (y === 88) { doc.setFontSize(11); doc.setTextColor(...MUTED); doc.text("Nothing overdue or due on the next working day.", 40, y); }
    const n = doc.internal.getNumberOfPages();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text("Page " + i + " of " + n, W - 40, H - 20, { align: "right" }); }
    return doc.output("blob");
  }

  // ---------- panel and toast ----------
  let opener = null;
  function openPanel(title, html) {
    if ($("panel").hidden) opener = document.activeElement;
    $("panel-title").innerHTML = title;
    $("panel-body").innerHTML = html;
    $("panel").hidden = false; $("scrim").classList.remove("hidden");
    return $("panel-body");
  }
  function closePanel() {
    if ($("panel").hidden) return;
    $("panel").hidden = true; $("scrim").classList.add("hidden");
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  }
  $("panel-close").addEventListener("click", closePanel);
  $("scrim").addEventListener("click", closePanel);
  let toastTimer = 0, toastUndo = null;
  function toast(text, undo) {
    clearTimeout(toastTimer);
    $("toast-text").textContent = text;
    toastUndo = undo || null;
    $("toast-undo").hidden = !undo;
    $("toast").classList.remove("hidden");
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), undo ? 7000 : 4500);
  }
  $("toast-undo").addEventListener("click", () => { const f = toastUndo; toastUndo = null; $("toast").classList.add("hidden"); if (f) f(); });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape" && !$("panel").hidden) { e.preventDefault(); closePanel(); return; }
    if (e.key === "/" && !typing && $("a-q")) { e.preventDefault(); $("a-q").focus(); }
  });

  // ---------- start ----------
  sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT" && me) { me = null; showSignin(""); } });
  (async () => {
    // A sign-in handed over by the Print Cell portal arrives in the URL hash; supabase-js picks it up here.
    const { data: { session } } = await sb.auth.getSession();
    if (session) { try { await enter(session.user.id); } catch (e) { showSignin("Couldn’t load your tasks. Try again in a minute."); } }
    else showSignin("");
    if (/access_token=/.test(location.hash)) history.replaceState(null, "", location.pathname + "#/today");
  })();
})();
