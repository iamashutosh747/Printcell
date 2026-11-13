// Print Cell portal: one sign-in, a card per app, and one-click access to CSRC, Tasks, DPR and Coverage.
(function () {
  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const EMAIL_DOMAIN = "printcell.internal";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const TS = window.TaskSchedule;

  // Card order and ink. "key" matches the portal_me / portal_home field and the portal-launch app name.
  const APPS = [
    { key: "tasks", name: "Tasks", ink: "var(--p-magenta)" },
    { key: "csrc", name: "CSRC", ink: "var(--p-cyan)" },
    { key: "dpr", name: "DPR", ink: "var(--p-yellow)" },
    { key: "coverage", name: "Coverage", ink: "var(--p-key)" },
  ];
  // DPR statuses in DPR's own order (worst first) and its colours.
  const STATUSES = [
    ["Black", "var(--s-black)"], ["Gray", "var(--s-gray)"], ["Blue", "var(--s-blue)"],
    ["Red", "var(--s-red)"], ["Yellow", "var(--s-yellow)"], ["Green", "var(--s-green)"],
  ];
  const DPR_LABEL = { full: "Full report", pdc: "PDC cheques only", agent: "Agent" };
  const EVENT_LABEL = { sign_in: "Signed in", open_csrc: "Opened CSRC", open_tasks: "Opened Tasks", open_dpr: "Opened DPR", open_coverage: "Opened Coverage" };
  const ICON_OPEN = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4.5H4.5v11h11V12M11 4.5h4.5V9M15.5 4.5 9 11"/></svg>';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  function money(n) {                       // compact rupees: 1.25 Cr, 4.3 L, 2,500
    const v = Math.abs(Number(n || 0));
    const s = v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(1) + " L" : Math.round(v).toLocaleString("en-US");
    return Number(n) < 0 ? "(" + s + ")" : s;
  }
  const lateText = (n) => n + " " + (n === 1 ? "is" : "are") + " late";

  let me = null;          // portal_me() for the signed-in person
  let home = null;        // portal_home() card data
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
  const VIEWS = ["signin", "home", "settings", "admin", "activity"];
  function show(view) {
    $("boot").classList.add("hidden");
    VIEWS.forEach((v) => $(v + "-view").classList.toggle("hidden", v !== view));
    const signedIn = view !== "signin";
    $("brand").classList.toggle("hidden", signedIn);
    $("who").classList.toggle("hidden", !signedIn);
    $("top-actions").classList.toggle("hidden", !signedIn);
    if (view === "settings") $("settings-link").setAttribute("aria-current", "page"); else $("settings-link").removeAttribute("aria-current");
    window.scrollTo(0, 0);
  }

  function route() {
    if (!me) return;
    const r = location.hash.replace(/^#\/?/, "");
    if ((r === "admin" || r === "activity") && me.is_admin) {
      show(r);
      if (r === "admin") loadPeople(); else loadActivity();
    } else if (r === "settings") {
      show("settings");
      $("admin-links").classList.toggle("hidden", !me.is_admin);
    } else {
      show("home");
      if (home) renderCards(); else loadHome();
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
    me = data; home = null;
    const t = TS.todayNepal();
    $("who-name").textContent = me.full_name;
    $("who-date").textContent = TS.WEEKDAYS[TS.weekday(t)] + ", " + TS.fmtAD(t) + " · " + TS.fmtBS(t);
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
    me = null; roster = null; home = null;
    history.replaceState(null, "", location.pathname);
    show("signin");
    $("si-user").focus();
  });

  // ---------- home: cards ----------
  const myApps = () => APPS.filter((a) => me && me[a.key]);

  function cardShell(app, inner) {
    return '<section class="card" id="card-' + app.key + '" style="--c:' + app.ink + '" aria-labelledby="h-' + app.key + '">' +
      '<div class="card-head"><span class="ink"></span><h2 id="h-' + app.key + '">' + app.name + "</h2>" +
      '<button type="button" class="open" data-open="' + app.key + '">Open<span class="sr-only"> ' + app.name + "</span>" + ICON_OPEN + "</button></div>" +
      inner + '<p class="card-err" role="alert"></p></section>';
  }
  function renderSkeletons() {
    const apps = myApps();
    $("cards").innerHTML = apps.length
      ? apps.map((a) => cardShell(a, '<span class="sk big"></span><div class="card-body"><span class="sk w80"></span><span class="sk w60"></span><span class="sk w40"></span></div>')).join("")
      : '<section class="card"><p class="card-sum">Nothing here yet<small>You don\'t have access to any apps yet. Ask an admin to add you.</small></p></section>';
    layoutCards();
  }
  async function loadHome() {
    $("home-msg").innerHTML = "";
    renderSkeletons();
    if (!myApps().length) return;
    const { data, error } = await sb.rpc("portal_home");
    if (error || !data) {
      $("home-msg").innerHTML = 'Couldn\'t load your cards. <button type="button" class="more" id="home-retry">Try again</button>';
      $("home-retry").addEventListener("click", loadHome);
      return;
    }
    home = data;
    renderCards();
  }
  function renderCards() {
    const parts = [];
    for (const app of myApps()) {
      const d = home[app.key];
      if (!d) continue;
      parts.push(cardShell(app, ({ tasks: tasksCard, csrc: csrcCard, dpr: dprCard, coverage: coverageCard })[app.key](d)));
    }
    $("cards").innerHTML = parts.join("");
    layoutCards();
    wireDonut();
  }
  // Wide screens: deal the cards, in order, into whichever of two columns is shorter.
  const WIDE = window.matchMedia("(min-width: 980px)");
  function layoutCards() {
    const box = $("cards");
    const cards = [...box.querySelectorAll(".card")];
    box.classList.remove("masonry");
    box.replaceChildren(...cards);
    if (cards.length < 3 || !WIDE.matches) return;
    const cols = [document.createElement("div"), document.createElement("div")];
    cols.forEach((c) => (c.className = "col"));
    box.classList.add("masonry");
    box.replaceChildren(...cols);
    for (const card of cards) (cols[0].offsetHeight <= cols[1].offsetHeight ? cols[0] : cols[1]).appendChild(card);
  }
  WIDE.addEventListener("change", layoutCards);

  // Tasks: late + due today, tick to send for approval.
  const TASK_LIMIT = 8;
  function tasksCard(t) {
    const day = home.today;
    const { late, due, waiting } = TS.today(t.tasks, t.completions, day);
    const open = late.length + due.length;
    const sum = open === 0 ? "Nothing left today" : plural(open, "task", "tasks") + " to finish";
    const sub = open === 0 ? (waiting.length ? "Everything is ticked off." : "No tasks are due.")
      : late.length ? lateText(late.length) : "All due today.";
    const row = (o, isLate) => {
      const ret = o.completion && o.completion.status === "returned";
      const meta = ret ? "Sent back" + (o.completion.admin_note ? ": " + o.completion.admin_note : "")
        : isLate ? "Was due " + TS.fmtBS(o.due, false) + ", " + plural(TS.diffDays(day, o.due), "day", "days") + " ago"
        : o.due > day ? "Due by " + TS.fmtBS(o.due, false) : "";
      return '<li class="tick' + (isLate || ret ? " is-late" : "") + '" data-meta="' + esc(meta) + '"><label>' +
        '<input type="checkbox" data-task="' + esc(o.task.id) + '" data-due="' + o.due + '">' +
        '<span class="t-name">' + esc(o.task.name) + "</span>" +
        '<span class="t-meta">' + esc(meta) + "</span>" +
        '</label><p class="t-err" role="alert"></p></li>';
    };
    // Today's tasks always show; late ones fill the rest (most recent first), the remainder link to Tasks.
    const shownDue = due.slice(0, TASK_LIMIT);
    const shownLate = late.slice().sort((a, b) => (a.due < b.due ? 1 : -1)).slice(0, Math.max(3, TASK_LIMIT - shownDue.length));
    const hidden = open - shownLate.length - shownDue.length;
    let body = "";
    if (open === 0) body = '<p class="empty-note">Open Tasks to see what is coming up this week.</p>';
    else {
      if (shownDue.length) body += '<p class="group-label">Today</p><ul class="ticks">' + shownDue.map((o) => row(o, false)).join("") + "</ul>";
      if (shownLate.length) body += '<p class="group-label late">Late</p><ul class="ticks">' + shownLate.map((o) => row(o, true)).join("") + "</ul>";
      if (hidden > 0) body += '<button type="button" class="more" data-open="tasks">' + plural(hidden, "more late task", "more late tasks") + " in Tasks</button>";
    }
    const foot = '<span id="t-waiting"><strong>' + waiting.length + "</strong> waiting for approval</span>" +
      (t.is_admin && t.to_review != null ? "<span><strong>" + t.to_review + "</strong> for you to review</span>" : "");
    return '<p class="card-sum" id="t-sum" data-waiting="' + waiting.length + '" data-open="' + open + '" data-late="' + late.length + '">' + sum + "<small>" + sub + "</small></p>" +
      '<div class="card-body">' + body + "</div>" + '<div class="card-foot">' + foot + "</div>";
  }
  function refreshTaskSummary() {
    const card = $("card-tasks");
    if (!card) return;
    // Count against the full totals, not just the rows shown (some late ones may be hidden behind "more").
    const sumEl = $("t-sum"), base = Number(sumEl.dataset.waiting) || 0;
    const ticked = card.querySelectorAll('.ticks input[type="checkbox"]:checked').length;
    const tickedLate = card.querySelectorAll('.tick.is-late input[type="checkbox"]:checked').length;
    const left = (Number(sumEl.dataset.open) || 0) - ticked, lateLeft = (Number(sumEl.dataset.late) || 0) - tickedLate;
    $("t-sum").innerHTML = (left === 0 ? "Nothing left today" : plural(left, "task", "tasks") + " to finish") +
      "<small>" + (left === 0 ? "Everything is ticked off." : lateLeft ? lateText(lateLeft) : "All due today.") + "</small>";
    $("t-waiting").innerHTML = "<strong>" + (base + ticked) + "</strong> waiting for approval";
  }
  async function toggleTask(box) {
    const li = box.closest(".tick"), err = li.querySelector(".t-err"), on = box.checked;
    err.textContent = ""; box.disabled = true; li.classList.add("is-saving");
    try {
      const { data, error } = await sb.rpc(on ? "portal_task_submit" : "portal_task_unsubmit", { p_task: box.dataset.task, p_due: box.dataset.due });
      if (error) throw new Error(/assigned to someone|Already approved|can't be submitted/i.test(error.message) ? error.message : "Couldn't save. Try again.");
      if (!on && data === false) throw new Error("It has already been reviewed, so it can't be unticked here. Open Tasks.");
      li.classList.toggle("is-done", on);
      li.querySelector(".t-meta").textContent = on ? "Sent for approval" : li.dataset.meta;
      refreshTaskSummary();
    } catch (e) {
      box.checked = !on;
      err.textContent = e.message;
    } finally {
      box.disabled = false; li.classList.remove("is-saving");
    }
  }

  // CSRC: today's calls.
  function csrcCard(c) {
    const calls = c.calls || [];
    const done = calls.filter((x) => x.status === "completed").length;
    const sum = calls.length ? plural(calls.length, "call", "calls") + " today" : "No calls booked today";
    const sub = calls.length ? (done ? done + " done, " + (calls.length - done) + " to go" : "None done yet")
      : c.role === "manager" ? "Calls booked for today will show here." : "Your calls for today will show here.";
    const hhmm = (t) => (t ? String(t).slice(0, 5) : "–");
    let body = calls.length
      ? '<ul class="calls">' + calls.slice(0, 6).map((x) =>
          '<li class="call' + (x.status === "completed" ? " is-done" : "") + '">' +
          '<span class="c-time">' + hhmm(x.from) + '</span><span class="c-cust">' + esc(x.customer) + "</span>" +
          '<span class="c-tag">' + (x.status === "completed" ? "Done" : x.type === "SCH" ? "Scheduled" : "On call") + "</span>" +
          '<span class="c-eng">' + esc(x.engineers || "No engineer assigned") + "</span></li>").join("") + "</ul>" +
        (calls.length > 6 ? '<button type="button" class="more" data-open="csrc">' + plural(calls.length - 6, "more call", "more calls") + " in CSRC</button>" : "")
      : "";
    const figs = [];
    if (c.overdue_calls) figs.push('<p class="figure"><strong>' + c.overdue_calls + "</strong> earlier " + (c.overdue_calls === 1 ? "call is" : "calls are") + " still open</p>");
    if (c.visits_due != null) figs.push('<p class="figure"><strong>' + c.visits_due + "</strong> " + (c.visits_due === 1 ? "customer is" : "customers are") + " due a scheduled visit</p>");
    const figBlock = figs.length ? '<div class="' + (body ? "card-foot figures" : "figures") + '">' + figs.join("") + "</div>" : "";
    return '<p class="card-sum">' + sum + "<small>" + sub + "</small></p>" +
      (body || figBlock ? '<div class="card-body">' + body + figBlock + "</div>" : "");
  }

  // DPR: customers by status as a donut, plus cheques due.
  function donut(rows) {
    const live = rows.filter((x) => x.n), total = live.reduce((s, r) => s + r.n, 0);
    const R = 64, r = 46, c = 66, gap = live.length > 1 ? 2 / ((R + r) / 2) : 0;   // 2px gap between slices
    const pt = (rad, ang) => (c + rad * Math.cos(ang)).toFixed(2) + " " + (c + rad * Math.sin(ang)).toFixed(2);
    let a = -Math.PI / 2, paths = "";
    for (const row of live) {
      const sweep = (row.n / total) * Math.PI * 2;
      let d;
      if (live.length === 1) {   // one status only: a full ring
        d = "M " + pt(R, 0) + " A " + R + " " + R + " 0 1 1 " + pt(R, Math.PI) + " A " + R + " " + R + " 0 1 1 " + pt(R, 0) +
            " M " + pt(r, 0) + " A " + r + " " + r + " 0 1 0 " + pt(r, Math.PI) + " A " + r + " " + r + " 0 1 0 " + pt(r, 0) + " Z";
      } else {
        const a0 = a + gap / 2, a1 = a + sweep - gap / 2, large = a1 - a0 > Math.PI ? 1 : 0;
        d = "M " + pt(R, a0) + " A " + R + " " + R + " 0 " + large + " 1 " + pt(R, a1) +
            " L " + pt(r, a1) + " A " + r + " " + r + " 0 " + large + " 0 " + pt(r, a0) + " Z";
      }
      paths += '<path d="' + d + '" fill="' + row.ink + '" fill-rule="evenodd" class="seg-' + row.status.toLowerCase() + '" data-status="' + row.status + '">' +
        "<title>" + row.status + ": " + plural(row.n, "customer", "customers") + ", Rs " + money(row.due) + "</title></path>";
      a += sweep;
    }
    return '<svg class="donut" viewBox="0 0 132 132" role="img" aria-label="Customers by status: ' + esc(live.map((x) => x.status + " " + x.n).join(", ")) + '">' + paths +
      '<text class="d-total" x="66" y="69" text-anchor="middle">' + total + "</text>" +
      '<text class="d-label" x="66" y="85" text-anchor="middle">customers</text></svg>';
  }
  function dprCard(d) {
    const asOf = d.report_date ? "as of " + TS.fmtAD(d.report_date, false) : "";
    const ch = d.cheques;
    const chequeLine = (style) => ch ? '<p class="cheques"' + (style || "") + '><span class="' + (ch.overdue ? "is-late" : "") + '"><strong>' + ch.overdue + "</strong> " + (ch.overdue === 1 ? "cheque" : "cheques") + " overdue</span>" +
      "<span><strong>" + ch.today + "</strong> due today</span><span><strong>" + ch.tomorrow + "</strong> tomorrow</span></p>" : "";
    if (!d.statuses) {   // PDC-only access: cheques are the whole story
      return '<p class="card-sum">' + plural(ch.overdue + ch.today, "cheque", "cheques") + " to send<small>Cheques " + asOf + "</small></p>" +
        '<div class="card-body">' + chequeLine(' style="border-top:0;padding-top:0;margin-top:0"') + "</div>";
    }
    const by = new Map(d.statuses.map((s) => [s.status, s]));
    const rows = STATUSES.map(([status, ink]) => ({ status, ink, n: (by.get(status) || {}).n || 0, due: (by.get(status) || {}).due || 0 }));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const worst = rows[0].n + rows[1].n;    // Black + Gray: cheques past their date
    const sum = plural(total, "customer", "customers") + (d.role === "agent" && d.agent ? " · " + esc(d.agent) : "");
    const sub = (worst ? worst + " with cheques past their date" : "No cheques past their date") + (asOf ? ", " + asOf : "");
    const legend = '<ul class="legend">' + rows.map((x) =>
      '<li data-status="' + x.status + '" style="--c:' + x.ink + '"><span class="l-sw"></span><span>' + x.status + "</span>" +
      '<span class="l-n">' + x.n + '</span><span class="l-due">' + (x.n ? "Rs " + money(x.due) : "–") + "</span></li>").join("") + "</ul>";
    return '<p class="card-sum">' + sum + "<small>" + sub + "</small></p>" +
      '<div class="card-body"><div class="dpr-body">' + (total ? donut(rows) : "") + legend + "</div>" + chequeLine() + "</div>";
  }
  function wireDonut() {
    const card = $("card-dpr");
    const svg = card && card.querySelector(".donut");
    if (!svg) return;
    const set = (status) => {
      svg.classList.toggle("is-hover", !!status);
      svg.querySelectorAll("path").forEach((p) => p.classList.toggle("is-on", p.dataset.status === status));
      card.querySelectorAll(".legend li").forEach((li) => li.classList.toggle("is-on", li.dataset.status === status));
    };
    card.querySelector(".dpr-body").addEventListener("pointerover", (e) => { const t = e.target.closest("[data-status]"); set(t ? t.dataset.status : null); });
    card.querySelector(".dpr-body").addEventListener("pointerleave", () => set(null));
  }

  // Coverage: customers (cost centres) sent more toner than their usage explains.
  function coverageCard(c) {
    const groups = new Map();
    for (const r of c.rows || []) {
      const g = groups.get(r.cost_centre) || { name: r.cost_centre.replace(/^KM\s*-\s*/i, ""), red: [], excess: 0 };
      if (r.status === "RED") { g.red.push(r); g.excess += Number(r.excess); }
      groups.set(r.cost_centre, g);
    }
    const red = [...groups.values()].filter((g) => g.red.length).sort((a, b) => b.excess - a.excess);
    const watch = [...groups.values()].filter((g) => !g.red.length).length;
    const cut = c.cutoff ? "toner issued up to " + TS.fmtAD(c.cutoff, false) : "";
    const sum = red.length ? plural(red.length, "customer", "customers") + " over-supplied" : "No customer over-supplied";
    const sub = red.length ? "Sent more toner than their machines have used" : "Toner issued matches usage" + (cut ? ", " + cut : "") + ".";
    const body = red.length ? '<ul class="over">' + red.slice(0, 5).map((g) =>
      '<li><span class="o-name">' + esc(g.name) + '</span><span class="o-parts">' +
      g.red.sort((a, b) => b.excess - a.excess).map((r) =>
        '<span class="chip" title="' + esc(r.part + ": " + r.issued + " issued, " + Number(r.expected).toFixed(1) + " used, " + Number(r.excess).toFixed(1) + " over the 1-toner allowance") + '">' +
        esc(r.part) + " <b>+" + Number(r.excess).toFixed(1) + "</b></span>").join("") +
      "</span></li>").join("") + "</ul>" +
      (red.length > 5 ? '<button type="button" class="more" data-open="coverage">' + plural(red.length - 5, "more customer", "more customers") + " in Coverage</button>" : "") : "";
    const foot = (watch ? "<span><strong>" + watch + "</strong> more to watch</span>" : "") +
      "<span>FY " + esc(String(c.fy).replace("-", "/")) + (red.length && cut ? ", " + cut : "") + "</span>";
    return '<p class="card-sum">' + sum + "<small>" + sub + "</small></p>" +
      (body ? '<div class="card-body">' + body + "</div>" : "") + '<div class="card-foot">' + foot + "</div>";
  }

  // Open an app already signed in.
  async function openApp(btn) {
    const app = btn.dataset.open, card = $("card-" + app), err = card && card.querySelector(".card-err");
    if (err) err.textContent = "";
    const all = card ? card.querySelectorAll("[data-open]") : [btn];
    all.forEach((b) => (b.disabled = true));
    try {
      const { url, post } = await callFn("portal-launch", { app });
      if (post) {
        // The coverage site has its own sign-in: hand it this person's token in a form post.
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error("Your session has ended. Sign in again.");
        postForm(post, { access_token: session.access_token });
      } else {
        location.assign(url);
      }
    } catch (e) {
      if (err) err.textContent = e.message;
      all.forEach((b) => (b.disabled = false));
    }
  }
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
  $("cards").addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) openApp(b);
  });
  $("cards").addEventListener("change", (e) => {
    if (e.target.matches('.ticks input[type="checkbox"]')) toggleTask(e.target);
  });
  // Back from an app: reload the cards so changes made there show up, and re-enable the buttons.
  window.addEventListener("pageshow", (e) => { if (e.persisted && me && !$("home-view").classList.contains("hidden")) loadHome(); });

  // ---------- settings: password ----------
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
    $("people").innerHTML = '<table><thead><tr><th>Person</th><th>Apps</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead><tbody>' +
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
      if (saved.id === me.id) { home = null; await enter(); }
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
    $("f-person").innerHTML = '<option value="">Everyone</option>' + people.map((p) => "<option>" + esc(p) + "</option>").join("");
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
    if (event === "SIGNED_OUT" && me) { me = null; home = null; show("signin"); }
  });
  (async () => {
    const { data: { session } } = await sb.auth.getSession();
    if (session) await enter(); else { show("signin"); $("si-user").focus(); }
  })();
})();
