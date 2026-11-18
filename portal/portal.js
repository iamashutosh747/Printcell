// Print Cell portal: one sign-in, today across every app, drill-down panels, and one-click access to each app.
(function () {
  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const EMAIL_DOMAIN = "printcell.internal";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  const TS = window.TaskSchedule;

  // "key" matches the portal_me / portal_home field and the portal-launch app name.
  const APPS = {
    tasks: { name: "Tasks", ink: "var(--m)" },
    csrc: { name: "CSRC", ink: "var(--c)" },
    dpr: { name: "DPR", ink: "var(--y)" },
    coverage: { name: "Coverage", ink: "var(--g)" },
    stock: { name: "Stock", ink: "var(--o)" },
  };
  const ORDER = ["tasks", "csrc", "dpr", "coverage", "stock"];
  // DPR statuses in DPR's own order (worst first), their swatch and what they mean.
  const STATUSES = [
    ["Black", "var(--s-black)", "Cheque late and credit +30"], ["Gray", "var(--s-gray)", "Cheque past its date"],
    ["Blue", "var(--s-blue)", "Past credit + 30 days"], ["Red", "var(--s-red)", "Past credit days"],
    ["Yellow", "var(--s-yellow)", "PDC covers, old bill"], ["Green", "var(--s-green)", "Within terms"],
  ];
  const INK_OF = Object.fromEntries(STATUSES.map(([s, ink]) => [s, ink]));
  const DPR_LABEL = { full: "Full report", pdc: "PDC cheques only", agent: "Agent" };
  const EVENT_LABEL = { sign_in: "Signed in", open_csrc: "Opened CSRC", open_tasks: "Opened Tasks", open_dpr: "Opened DPR", open_coverage: "Opened Coverage", open_stock: "Opened Stock" };
  const STOCK_API = "https://stock.ashutosh-sharma.com/api/portal-home";
  // Reorder statuses that need action, as labelled swatches (the same inks the Stock app uses).
  const STOCK_INK = { "Order now": "var(--st-now)", "Order soon": "var(--st-soon)" };
  const STOCK_LABEL = { stock: "stock and reorder only", view: "all reports, view only", full: "full access" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const when = (iso) => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu",
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  const rs = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  const money = (n) => { const v = Number(n || 0); return v < 0 ? "(" + rs.format(-v) + ")" : rs.format(v); };
  function short(n) {                       // compact rupees: 1.25 Cr, 4.3 L, 2,500
    const v = Math.abs(Number(n || 0));
    const s = v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(1) + " L" : rs.format(v);
    return Number(n) < 0 ? "(" + s + ")" : s;
  }
  const hhmm = (t) => (t ? String(t).slice(0, 5) : "");
  const num1 = (n) => { const v = Number(n || 0); return Number.isInteger(v) ? String(v) : v.toFixed(1); };
  const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  let me = null;          // portal_me() for the signed-in person
  let home = null;        // portal_home() data
  let roster = null;      // admin: portal-admin "list" result
  let editing = null;     // admin: id of the person being edited, or "" for a new one
  let fanned = false;     // the swatch deck fans out once per visit

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
  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw new Error("Couldn't load this. Check your connection and try again.");
    return data;
  }

  // ---------- views ----------
  const VIEWS = ["home", "settings", "admin", "activity"];
  function show(view) {
    $("boot").classList.add("hidden");
    $("signin-view").classList.toggle("hidden", view !== "signin");
    $("shell").classList.toggle("hidden", view === "signin");
    VIEWS.forEach((v) => $(v + "-view").classList.toggle("hidden", v !== view));
    document.querySelectorAll("[data-nav]").forEach((a) => {
      if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    document.body.classList.toggle("fit", view === "home");
    closePanel(); closeResults();
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
    } else {
      show("home");
      if (home) renderHome(); else loadHome();
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
    $("who-name").textContent = me.full_name;
    $("who-role").textContent = me.is_admin ? "Portal admin" : plural(myApps().length, "app", "apps");
    document.querySelectorAll(".admin-only").forEach((el) => el.classList.toggle("hidden", !me.is_admin));
    const t = TS.todayNepal();
    $("today-en").textContent = TS.WEEKDAYS[TS.weekday(t)] + ", " + TS.fmtAD(t, false);
    $("today-np").textContent = TS.fmtBS(t);
    renderChips();
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

  // ---------- rail: one swatch chip per app ----------
  const myApps = () => ORDER.filter((k) => me && me[k]);
  function renderChips() {
    $("chips").innerHTML =
      '<a class="chip" href="#/" data-nav="home" style="--i:var(--k)"><i></i><span><b>Today</b><small>Home</small></span></a>' +
      myApps().map((k) => '<button type="button" class="chip" data-open="' + k + '" style="--i:' + APPS[k].ink + '"><i></i><span><b>' +
        APPS[k].name + '</b><small id="chip-' + k + '">Open</small></span></button>').join("") +
      '<p class="err" id="chip-err" role="alert"></p>';
  }
  function setChip(k, html) { const el = $("chip-" + k); if (el) el.innerHTML = html; }

  // Open an app already signed in.
  async function openApp(app, from) {
    const chip = $("chips").querySelector('[data-open="' + app + '"]');
    const errEl = (from && from.closest(".area") && from.closest(".area").querySelector(".area-err")) || $("chip-err");
    errEl.textContent = "";
    if (chip) chip.classList.add("busy");
    document.querySelectorAll('[data-open="' + app + '"]').forEach((b) => (b.disabled = true));
    try {
      const { url, post } = await callFn("portal-launch", { app });
      if (post) {
        // Coverage and Stock have their own sign-in: hand them this person's token in a form post.
        const { data: { session } } = await sb.auth.getSession();
        if (!session) throw new Error("Your session has ended. Sign in again.");
        postForm(post, { access_token: session.access_token });
      } else {
        location.assign(url);
      }
    } catch (e) {
      errEl.textContent = e.message;
      if (chip) chip.classList.remove("busy");
      document.querySelectorAll('[data-open="' + app + '"]').forEach((b) => (b.disabled = false));
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
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) { e.preventDefault(); openApp(b.dataset.open, b); }
  });
  // Back from an app: reload so changes made there show up, and re-enable the buttons.
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted || !me) return;
    document.querySelectorAll(".chip.busy").forEach((c) => c.classList.remove("busy"));
    document.querySelectorAll("[data-open]").forEach((b) => (b.disabled = false));
    if (!$("home-view").classList.contains("hidden")) loadHome();
  });

  // ---------- home ----------
  const LIST_CAP = 40;   // rows rendered per list before fitting; the rest only count towards "more"
  const FIT = window.matchMedia("(min-width: 1000px) and (min-height: 600px)");
  const PHONE = window.matchMedia("(max-width: 760px)");

  function areaShell(k, sum, body, foot) {
    return '<section class="area" data-app="' + k + '" id="area-' + k + '" style="--i:' + APPS[k].ink + '" aria-labelledby="h-' + k + '">' +
      '<div class="area-head"><h2 id="h-' + k + '">' + areaTitle(k) + '</h2><span class="sum" id="sum-' + k + '">' + sum + "</span>" +
      '<button type="button" class="link open" data-open="' + k + '">Open ' + APPS[k].name + "</button></div>" +
      '<p class="area-err" role="alert"></p><div class="area-body">' + body + "</div>" + (foot ? '<div class="area-foot">' + foot + "</div>" : "") + "</section>";
  }
  function areaTitle(k) {
    if (k === "dpr") return home && home.dpr && !home.dpr.statuses ? "Cheques" : "Customer dues";
    return { tasks: "Tasks", csrc: "Calls today", coverage: "Over-supplied toner", stock: "Stock to order" }[k];
  }
  // Grid placement: the first area runs the full height on the left; DPR's swatch deck leads on the right.
  function layout(keys) {
    const a = keys.includes("tasks") ? "tasks" : keys.includes("csrc") ? "csrc" : keys[0];
    const rest = keys.filter((k) => k !== a).sort((x, y) => (x === "dpr" ? -1 : y === "dpr" ? 1 : 0));
    const placed = [a, ...rest], names = "abcde";
    const v = { cols: "minmax(0,1fr)", rows: "minmax(0,1fr)", areas: '"a"' };
    const deckTop = rest[0] === "dpr" && home.dpr && home.dpr.statuses;
    if (placed.length === 2) Object.assign(v, { cols: "minmax(0,1fr) minmax(0,1.5fr)", areas: '"a b"' });
    if (placed.length === 3) Object.assign(v, { cols: "minmax(0,1fr) minmax(0,1.5fr)", areas: '"a b" "a c"',
      rows: deckTop ? "auto minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)" });
    if (placed.length === 4) Object.assign(v, { cols: "minmax(0,1.05fr) minmax(0,1fr) minmax(0,1fr)", areas: '"a b b" "a c d"',
      rows: deckTop ? "auto minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)" });
    if (placed.length === 5) Object.assign(v, { cols: "minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", areas: '"a b b b" "a c d e"',
      rows: deckTop ? "auto minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)" });
    const el = $("areas");
    el.style.setProperty("--cols", v.cols); el.style.setProperty("--rows", v.rows); el.style.setProperty("--areas", v.areas);
    return placed.map((k, i) => [k, names[i]]);
  }

  function renderSkeletons() {
    const keys = myApps();
    if (!keys.length) {
      $("areas").innerHTML = '<section class="area" style="--i:var(--k)"><p class="empty-note" style="padding:18px">You don\'t have any apps yet. Ask an admin to add you.</p></section>';
      return;
    }
    $("areas").innerHTML = keys.map((k) => '<section class="area" style="--i:' + APPS[k].ink + '"><div class="area-head"><h2>' + APPS[k].name + '</h2><span class="sum">Loading…</span></div></section>').join("");
  }
  async function loadHome() {
    $("home-msg").innerHTML = "";
    if (!home) renderSkeletons();
    if (!myApps().length) return;
    const { data, error } = await sb.rpc("portal_home");
    if (error || !data) {
      $("home-msg").innerHTML = 'Couldn\'t load today\'s work. <button type="button" class="link" id="home-retry">Try again</button>';
      $("home-retry").addEventListener("click", loadHome);
      return;
    }
    home = data;
    renderHome();
    if (me.stock) loadStock();
  }
  function renderHome() {
    const keys = myApps().filter((k) => home[k] || k === "stock");
    const placed = layout(keys);
    $("areas").innerHTML = placed.map(([k]) => k === "stock" ? stockArea(stock) : ({ tasks: tasksArea, csrc: csrcArea, dpr: dprArea, coverage: coverageArea })[k](home[k])).join("");
    placed.forEach(([k, n]) => $("area-" + k).style.setProperty("--ga", n));
    if (!fanned) { const d = $("areas").querySelector(".deck"); if (d) d.classList.add("fan"); fanned = true; }
    fitLists();
    buildIndex();
  }

  // A "more" line counts rows not shown: ones never rendered (data-base) plus ones hidden to fit.
  const moreBtn = (k, base) => '<button type="button" class="more" data-open="' + k + '" data-base="' + base + '" hidden></button>';
  const MORE_TEXT = {
    tasks: (n) => plural(n, "more task", "more tasks") + " in Tasks",
    csrc: (n) => plural(n, "more call", "more calls") + " in CSRC",
    coverage: (n) => plural(n, "more customer", "more customers") + " in Coverage",
    stock: (n) => plural(n, "more product", "more products") + " in Stock",
  };
  function fitLists() {
    for (const area of $("areas").querySelectorAll(".area[data-app]")) {
      const body = area.querySelector(".area-body"), more = body.querySelector(".more");
      const items = [...body.querySelectorAll(".fit")];
      if (!items.length) continue;
      items.forEach((i) => (i.hidden = false));
      let hidden = 0;
      const update = () => {
        if (more) {
          const n = Number(more.dataset.base) + hidden;
          more.hidden = n === 0;
          more.textContent = n ? MORE_TEXT[area.dataset.app](n) : "";
        }
        body.querySelectorAll(".fit-group").forEach((g) => (g.hidden = !g.querySelector(".fit:not([hidden])")));
      };
      update();
      if (!FIT.matches || !document.body.classList.contains("fit")) continue;
      for (let i = items.length - 1; i >= 1 && body.scrollHeight > body.clientHeight + 1; i--) {
        items[i].hidden = true; hidden++; update();
      }
    }
  }
  window.addEventListener("resize", debounce(() => { if (home && !$("home-view").classList.contains("hidden")) fitLists(); }, 120));

  // ----- Tasks: today first, then late; tick to send for approval, with undo -----
  function taskState(t) {
    const { late, due, waiting } = TS.today(t.tasks, t.completions, home.today);
    return { late: late.slice().sort((a, b) => (a.due < b.due ? 1 : -1)), due, waiting };
  }
  function taskMeta(o, isLate) {
    const ret = o.completion && o.completion.status === "returned";
    if (ret) return "Sent back" + (o.completion.admin_note ? ": " + o.completion.admin_note : "");
    const co = o.task.company ? o.task.company : "";
    if (isLate) return [co, "was due " + TS.fmtBS(o.due, false)].filter(Boolean).join(" · ");
    return [co, o.due > home.today ? "due by " + TS.fmtBS(o.due, false) : ""].filter(Boolean).join(" · ");
  }
  function taskRow(o, isLate) {
    const days = TS.diffDays(home.today, o.due), meta = taskMeta(o, isLate);
    return '<li class="fit"><label class="row tick" data-key="' + esc(o.task.id + "|" + o.due) + '">' +
      '<input type="checkbox" data-task="' + esc(o.task.id) + '" data-due="' + o.due + '" aria-describedby="m-' + esc(o.task.id) + o.due + '">' +
      '<span class="t"><span>' + esc(o.task.name) + '</span><small id="m-' + esc(o.task.id) + o.due + '" data-meta="' + esc(meta) + '">' + esc(meta) + "</small></span>" +
      (isLate ? '<span class="late-mark">' + plural(days, "day", "days") + " late</span>" : "") + "</label></li>";
  }
  function tasksArea(t) {
    const { late, due, waiting } = taskState(t);
    const open = late.length + due.length;
    const shownDue = due.slice(0, LIST_CAP), shownLate = late.slice(0, Math.max(0, LIST_CAP - shownDue.length));
    let body = "";
    if (!open) body = '<p class="empty-note">' + (waiting.length ? "Everything is ticked off. " : "Nothing is due. ") + "Open Tasks to see the week ahead.</p>";
    else {
      if (shownDue.length) body += '<div class="fit-group"><p class="group">Today</p><ul class="rows">' + shownDue.map((o) => taskRow(o, false)).join("") + "</ul></div>";
      if (shownLate.length) body += '<div class="fit-group"><p class="group">Late</p><ul class="rows">' + shownLate.map((o) => taskRow(o, true)).join("") + "</ul></div>";
      body += moreBtn("tasks", open - shownDue.length - shownLate.length);
    }
    const foot = '<span><b id="t-waiting">' + waiting.length + "</b> waiting for approval</span>" +
      (t.is_admin && t.to_review != null ? "<span><b>" + t.to_review + "</b> for you to review</span>" : "");
    tasksCounts = { open, late: late.length, waiting: waiting.length, ticked: 0, tickedLate: 0 };
    paintTaskCounts();
    return areaShell("tasks", taskSum(), body, foot);
  }
  let tasksCounts = null;
  function taskSum() {
    const c = tasksCounts, left = c.open - c.ticked, lateLeft = c.late - c.tickedLate;
    if (!left) return "nothing left today";
    return plural(left, "to do", "to do") + (lateLeft ? ", " + lateLeft + " late" : "");
  }
  function paintTaskCounts() {
    const c = tasksCounts, left = c.open - c.ticked, lateLeft = c.late - c.tickedLate;
    setChip("tasks", left ? left + " open" + (lateLeft ? ' · <span class="late">' + lateLeft + " late</span>" : "") : "All done");
    if ($("sum-tasks")) $("sum-tasks").textContent = taskSum();
    if ($("t-waiting")) $("t-waiting").textContent = c.waiting + c.ticked;
  }
  // Submit or withdraw one task occurrence. Updates the row if it is on screen.
  async function setTask(taskId, due, on, opts) {
    const label = $("areas").querySelector('.tick[data-key="' + CSS.escape(taskId + "|" + due) + '"]');
    const box = label && label.querySelector("input"), small = label && label.querySelector("small");
    const isLate = label && !!label.querySelector(".late-mark");
    if (box) { box.checked = on; box.disabled = true; label.classList.add("saving"); }
    try {
      const { data, error } = await sb.rpc(on ? "portal_task_submit" : "portal_task_unsubmit", { p_task: taskId, p_due: due });
      if (error) throw new Error(/assigned to someone|Already approved|can't be submitted/i.test(error.message) ? error.message : "Couldn't save. Check your connection and try again.");
      if (!on && data === false) throw new Error("It has already been reviewed, so it can't be unticked here. Open Tasks.");
      if (label) {
        label.classList.toggle("done", on);
        small.textContent = on ? "Sent for approval" : small.dataset.meta;
        small.classList.toggle("sent", on);
      }
      if (tasksCounts) { tasksCounts.ticked += on ? 1 : -1; if (isLate) tasksCounts.tickedLate += on ? 1 : -1; paintTaskCounts(); }
      if (on && !(opts && opts.quiet)) toast("Sent for approval", () => setTask(taskId, due, false, { quiet: true }));
      return true;
    } catch (e) {
      if (box) box.checked = !on;
      if (label) { const err = label.closest(".area").querySelector(".area-err"); err.textContent = e.message; }
      else toast(e.message);
      return false;
    } finally {
      if (box) { box.disabled = false; label.classList.remove("saving"); }
    }
  }
  $("areas").addEventListener("change", (e) => {
    const box = e.target.closest('.tick input[type="checkbox"]');
    if (box) { box.closest(".area").querySelector(".area-err").textContent = ""; setTask(box.dataset.task, box.dataset.due, box.checked); }
  });

  // ----- CSRC: today's calls; click one for its details -----
  function csrcArea(c) {
    // Time order; calls with no time go last.
    const calls = (c.calls || []).sort((a, b) => (a.from || "99") < (b.from || "99") ? -1 : (a.from || "99") > (b.from || "99") ? 1 : 0);
    const done = calls.filter((x) => x.status === "completed").length;
    const sum = calls.length ? plural(calls.length, "call", "calls") + ", " + done + " done" : "none booked";
    setChip("csrc", calls.length ? plural(calls.length - done, "call", "calls") + " left" : "No calls");
    const shown = calls.slice(0, LIST_CAP);
    const body = shown.length ? '<ul class="rows">' + shown.map((x, i) =>
      '<li class="fit"><button type="button" class="row" data-call="' + i + '"><span class="time">' + (hhmm(x.from) || "–") + "</span>" +
      '<span class="t"><span>' + esc(x.customer) + "</span><small>" + (x.type === "SCH" ? "Scheduled" : "On call") + " · " +
      esc(x.engineers || "No engineer assigned") + "</small></span>" +
      (x.status === "completed" ? '<span class="tag ok">Done</span>' : "") + "</button></li>").join("") + "</ul>" + moreBtn("csrc", calls.length - shown.length)
      : '<p class="empty-note">' + (c.role === "manager" ? "No calls are booked for today." : "You have no calls today.") + "</p>";
    const foot = [];
    if (c.overdue_calls) foot.push('<span class="' + (c.overdue_calls ? "" : "") + '"><b>' + c.overdue_calls + "</b> earlier " + (c.overdue_calls === 1 ? "call" : "calls") + " still open</span>");
    if (c.visits_due != null) foot.push("<span><b>" + c.visits_due + "</b> due a scheduled visit</span>");
    return areaShell("csrc", sum, body, foot.join(""));
  }
  function callPanel(x) {
    const time = x.from ? hhmm(x.from) + (x.to ? "–" + hhmm(x.to) : "") : "Not set";
    const done = x.status === "completed";
    openPanel(esc(x.customer), "var(--c)",
      '<dl class="facts"><dt>Status</dt><dd' + (done ? ' style="color:var(--ok);font-weight:600"' : "") + ">" + (done ? "Done" : "Booked") + "</dd>" +
      "<dt>Visit</dt><dd>" + (x.type === "SCH" ? "Scheduled visit" : "On call") + "</dd>" +
      "<dt>Time</dt><dd>" + esc(time) + "</dd>" +
      "<dt>Engineers</dt><dd>" + esc(x.engineers || "No engineer assigned") + "</dd>" +
      (x.problem ? "<dt>Problem</dt><dd>" + esc(x.problem) + "</dd>" : "") +
      (x.address ? "<dt>Address</dt><dd>" + esc(x.address) + "</dd>" : "") +
      (x.contact ? "<dt>Contact</dt><dd>" + esc(x.contact) + "</dd>" : "") +
      (x.phone ? '<dt>Phone</dt><dd><a href="tel:' + esc(String(x.phone).replace(/[^\d+]/g, "")) + '">' + esc(x.phone) + "</a></dd>" : "") +
      '</dl><div class="actions"><button type="button" class="btn" data-open="csrc">Open in CSRC</button></div>');
  }

  // ----- DPR: statuses as swatches; each opens its customers -----
  function dprArea(d) {
    const asOf = d.report_date ? "report of " + TS.fmtAD(d.report_date, false) : "";
    const ch = d.cheques;
    const chequeFoot = ch ? '<button type="button" class="fig' + (ch.overdue ? " bad" : "") + '" data-cheques="overdue"><b>' + ch.overdue + "</b> " + (ch.overdue === 1 ? "cheque" : "cheques") + " overdue</button>" +
      '<button type="button" class="fig" data-cheques="today"><b>' + ch.today + '</b> due today</button><button type="button" class="fig" data-cheques="tomorrow"><b>' + ch.tomorrow + "</b> tomorrow</button>" : "";
    if (!d.statuses) {   // PDC-only access: cheques are the whole story
      setChip("dpr", plural(ch.overdue + ch.today, "cheque", "cheques") + " due");
      return areaShell("dpr", asOf, '<p class="empty-note">Pick a figure below to see the cheques.</p>', chequeFoot);
    }
    const by = new Map(d.statuses.map((s) => [s.status, s]));
    const rows = STATUSES.map(([status, ink, what]) => ({ status, ink, what, n: (by.get(status) || {}).n || 0, due: (by.get(status) || {}).due || 0 }));
    const total = rows.reduce((s, r) => s + r.n, 0);
    const red = rows.slice(0, 4).reduce((s, r) => s + r.n, 0);    // Black, Gray, Blue, Red: past terms
    setChip("dpr", red ? red + " past terms" : plural(total, "customer", "customers"));
    const deck = '<div class="deck">' + rows.map((x, i) =>
      '<button type="button" class="sw' + (x.n ? "" : " zero") + '" data-status="' + x.status + '" aria-pressed="false" style="--s:' + x.ink + ";--n:" + i + '"' +
      (x.n ? "" : " disabled") + ' aria-label="' + x.status + ": " + plural(x.n, "customer", "customers") + ", Rs " + short(x.due) + ". " + x.what + '">' +
      "<i></i><span><b>" + x.n + "</b><small>" + x.status + "</small><small>" + (x.n ? "Rs " + short(x.due) : "–") + "</small></span></button>").join("") + "</div>";
    const sum = plural(total, "customer", "customers") + (d.role === "agent" && d.agent ? " of " + esc(d.agent) : "") + (asOf ? ", " + asOf : "");
    return areaShell("dpr", sum, deck, chequeFoot);
  }
  function reason(c) {
    switch (c.status) {
      case "Black": return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date, and Rs " + money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC.";
      case "Gray": return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date.";
      case "Blue": return "Rs " + money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC.";
      case "Red": return "Rs " + money(c.net_over_credit) + " past credit days not covered by PDC.";
      case "Yellow": return "PDC covers overdue bills, but the oldest bill is " + c.lbp + " days old (credit " + c.credit_days + " days).";
      default: return Number(c.total_due) <= 2500 ? "Dues are Rs 2,500 or less." : "Within credit terms.";
    }
  }
  function customerTable(list, back) {
    const total = list.reduce((s, c) => s + Number(c.total_due || 0), 0);
    return "<table><thead><tr><th>Customer</th><th class=\"n\">Due (Rs)</th><th class=\"n hide-sm\">Oldest bill</th></tr></thead><tbody>" +
      list.map((c, i) => '<tr class="pick" data-cust="' + i + '" tabindex="0"><td>' + (back ? "" : "") + esc(c.name) + (c.agent ? '<span class="sub muted" style="display:block;font-size:13px">' + esc(c.agent) + "</span>" : "") +
        '</td><td class="n">' + money(c.total_due) + '</td><td class="n hide-sm">' + (c.lbp != null ? plural(c.lbp, "day", "days") : "–") + "</td></tr>").join("") +
      '</tbody><tfoot><tr class="tot"><td>' + plural(list.length, "customer", "customers") + '</td><td class="n">' + money(total) + '</td><td class="hide-sm"></td></tr></tfoot></table>';
  }
  async function statusPanel(status, sw) {
    document.querySelectorAll(".sw").forEach((s) => s.setAttribute("aria-pressed", String(s === sw)));
    const what = STATUSES.find((s) => s[0] === status)[2];
    const body = openPanel(status + " customers", INK_OF[status], '<p class="loading">Loading customers…</p>', () =>
      document.querySelectorAll(".sw").forEach((s) => s.setAttribute("aria-pressed", "false")));
    try {
      const list = await rpc("portal_dpr_customers", { p_status: status, p_query: null });
      if (!panelIs(body)) return;
      body.innerHTML = '<p class="why"><i class="dot" style="--i:' + INK_OF[status] + '"></i>' + esc(what) + ". Largest dues first.</p>" +
        (list.length ? customerTable(list) : '<p class="empty-note">No customers in this status.</p>') +
        '<div class="actions"><button type="button" class="btn" data-open="dpr">Open DPR</button></div>';
      wirePick(body, "cust", (i) => customerPanel(list[i], () => statusPanel(status, sw)));
    } catch (e) { if (panelIs(body)) body.innerHTML = '<p class="msg error">' + esc(e.message) + "</p>"; }
  }
  function customerPanel(c, back) {
    openPanel(esc(c.name), INK_OF[c.status] || "var(--y)",
      (back ? '<button type="button" class="link" id="p-back">Back to the list</button>' : "") +
      '<p class="why"><i class="dot" style="--i:' + (INK_OF[c.status] || "var(--g)") + '"></i><b>' + esc(c.status) + ".</b> " + esc(reason(c)) + "</p>" +
      '<dl class="facts"><dt>Total due</dt><dd>Rs ' + money(c.total_due) + "</dd>" +
      "<dt>PDC held</dt><dd>Rs " + money(c.total_pdc) + "</dd>" +
      "<dt>Past credit</dt><dd" + (Number(c.net_over_credit) > 0 ? ' class="bad"' : "") + ">Rs " + money(c.net_over_credit) + " not covered</dd>" +
      "<dt>Past credit + 30</dt><dd" + (Number(c.net_over_credit_30) > 0 ? ' class="bad"' : "") + ">Rs " + money(c.net_over_credit_30) + " not covered</dd>" +
      "<dt>Oldest bill</dt><dd>" + (c.lbp != null ? plural(c.lbp, "day", "days") + " old" : "–") + "</dd>" +
      "<dt>Credit</dt><dd>" + (c.credit_days != null ? plural(c.credit_days, "day", "days") : "–") + "</dd>" +
      (c.overdue_pdc_count ? "<dt>Cheques late</dt><dd class=\"bad\">" + c.overdue_pdc_count + "</dd>" : "") +
      (c.agent ? "<dt>Agent</dt><dd>" + esc(c.agent) + "</dd>" : "") +
      "<dt>Code</dt><dd>" + esc(c.gl_code) + "</dd></dl>" +
      '<div class="actions"><button type="button" class="btn" data-open="dpr">Open DPR</button></div>');
    if (back) $("p-back").addEventListener("click", back);
  }
  async function chequePanel(kind) {
    const title = { overdue: "Overdue cheques", today: "Cheques due today", tomorrow: "Cheques due tomorrow" }[kind];
    const body = openPanel(title, "var(--y)", '<p class="loading">Loading cheques…</p>');
    try {
      const list = await rpc("portal_dpr_cheques", { p_when: kind });
      if (!panelIs(body)) return;
      const total = list.reduce((s, c) => s + Number(c.amount || 0), 0);
      body.innerHTML = list.length
        ? "<table><thead><tr><th>Customer</th><th class=\"hide-sm\">Cheque</th><th>Date</th><th class=\"n\">Amount (Rs)</th></tr></thead><tbody>" +
          list.map((c) => "<tr><td>" + esc(c.customer) + '</td><td class="hide-sm">' + esc(c.cheque_no || "–") + "</td><td>" + (c.cheque_date ? TS.fmtAD(c.cheque_date, false) : "–") +
            '</td><td class="n">' + money(c.amount) + "</td></tr>").join("") +
          '</tbody><tfoot><tr class="tot"><td>' + plural(list.length, "cheque", "cheques") + '</td><td class="hide-sm"></td><td></td><td class="n">' + money(total) + "</td></tr></tfoot></table>" +
          '<div class="actions"><button type="button" class="btn" data-open="dpr">Open DPR</button></div>'
        : '<p class="empty-note">No cheques here.</p>';
    } catch (e) { if (panelIs(body)) body.innerHTML = '<p class="msg error">' + esc(e.message) + "</p>"; }
  }

  // ----- Coverage: cost centres sent more toner than their usage explains -----
  let covGroups = { red: [], watch: [] };
  function coverageArea(c) {
    const groups = new Map();
    for (const r of c.rows || []) {
      const g = groups.get(r.cost_centre) || { name: r.cost_centre.replace(/^KM\s*-\s*/i, ""), rows: [], red: [], excess: 0 };
      g.rows.push(r);
      if (r.status === "RED") { g.red.push(r); g.excess += Number(r.excess); }
      groups.set(r.cost_centre, g);
    }
    const red = [...groups.values()].filter((g) => g.red.length).sort((a, b) => b.excess - a.excess);
    const watch = [...groups.values()].filter((g) => !g.red.length);
    covGroups = { red, watch };
    setChip("coverage", red.length ? plural(red.length, "customer", "customers") + " over" : "All in line");
    const cut = c.cutoff ? "issued up to " + TS.fmtAD(c.cutoff, false) : "";
    const shown = red.slice(0, LIST_CAP);
    const body = shown.length ? '<ul class="rows">' + shown.map((g, i) =>
      '<li class="fit"><button type="button" class="row" data-cc="' + i + '"><span class="t"><span>' + esc(g.name) + "</span><small>" +
      plural(g.red.length, "part", "parts") + " over</small></span><span class=\"parts\">" +
      g.red.slice().sort((a, b) => b.excess - a.excess).slice(0, 2).map((r) => '<span class="part">' + esc(r.part) + " <b>+" + num1(r.excess) + "</b></span>").join("") +
      "</span></button></li>").join("") + "</ul>" + moreBtn("coverage", red.length - shown.length)
      : '<p class="empty-note">Toner issued matches usage' + (cut ? ", " + cut : "") + ".</p>";
    const foot = (watch.length ? '<button type="button" class="fig" data-watch="1"><b>' + watch.length + "</b> more to watch</button>" : "") +
      "<span>FY " + esc(String(c.fy).replace("-", "/")) + (cut ? ", " + cut : "") + "</span>";
    return areaShell("coverage", red.length ? plural(red.length, "customer", "customers") + " sent too much" : "nothing over", body, foot);
  }
  function ccPanel(g, back) {
    const rows = g.rows.slice().sort((a, b) => b.excess - a.excess);
    const max = Math.max(1, ...rows.map((r) => Math.max(Number(r.issued), Number(r.expected))));
    openPanel(esc(g.name), "var(--g)",
      (back ? '<button type="button" class="link" id="p-back">Back to the list</button>' : "") +
      '<p class="why">Toner sent compared with what the machines\' readings say they used.</p>' +
      '<div class="legend"><span><i style="background:var(--g);opacity:.55"></i>Used</span><span><i style="border:2px solid var(--bad)"></i>Sent</span></div>' +
      '<div class="bars">' + rows.map((r) => '<div class="b"><span>' + esc(r.part) + '</span><span class="track" title="' + esc(r.part + ": " + r.issued + " sent, " + num1(r.expected) + " used") + '">' +
        '<i class="used" style="width:' + (Number(r.expected) / max * 100).toFixed(1) + '%"></i><i class="sent" style="width:' + (Number(r.issued) / max * 100).toFixed(1) + '%"></i></span>' +
        '<span class="' + (r.status === "RED" ? "tag bad" : "") + '" style="text-align:right">+' + num1(r.excess) + "</span></div>").join("") + "</div>" +
      "<table><thead><tr><th>Part</th><th class=\"n\">Sent</th><th class=\"n\">Used</th><th class=\"n\">Over</th></tr></thead><tbody>" +
      rows.map((r) => "<tr><td>" + esc(r.part) + (r.status === "RED" ? "" : ' <span class="muted">(watch)</span>') + '</td><td class="n">' + num1(r.issued) + '</td><td class="n">' + num1(r.expected) +
        '</td><td class="n' + (r.status === "RED" ? " " : "") + '">' + (r.status === "RED" ? '<b style="color:var(--bad)">+' + num1(r.excess) + "</b>" : "+" + num1(r.excess)) + "</td></tr>").join("") + "</tbody></table>" +
      '<div class="actions"><button type="button" class="btn" data-open="coverage">Open Coverage</button></div>');
    if (back) $("p-back").addEventListener("click", back);
  }
  function watchPanel() {
    const list = covGroups.watch;
    const body = openPanel("To watch", "var(--g)",
      '<p class="why">Cost centres close to the limit: sent a little more than usage explains, but within the allowance.</p>' +
      "<table><thead><tr><th>Cost centre</th><th class=\"n\">Parts</th></tr></thead><tbody>" +
      list.map((g, i) => '<tr class="pick" data-w="' + i + '" tabindex="0"><td>' + esc(g.name) + '</td><td class="n">' + g.rows.length + "</td></tr>").join("") + "</tbody></table>");
    wirePick(body, "w", (i) => ccPanel(list[i], watchPanel));
  }

  // ----- Stock: what to order now and soon, from the Stock app's reorder plan -----
  let stock = null;   // { loading } | { error } | the Stock app's /api/portal-home answer
  async function loadStock() {
    if (!stock || stock.error) paintStock({ loading: true });
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) throw new Error("Your session has ended. Sign in again.");
      let res;
      try { res = await fetch(STOCK_API, { headers: { Authorization: "Bearer " + session.access_token } }); }
      catch (e) { throw new Error("Can't reach Stock. Check your connection and try again."); }
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Stock couldn't load (" + res.status + ").");
      paintStock(out);
    } catch (e) { paintStock({ error: e.message }); }
  }
  function paintStock(s) {
    stock = s;
    const el = $("area-stock");
    if (!el) return;
    const ga = el.style.getPropertyValue("--ga");
    el.outerHTML = stockArea(s);
    $("area-stock").style.setProperty("--ga", ga);
    fitLists();
    buildIndex();
  }
  function stockWhen(x) {
    if (x.months_late > 0) return "Was due to order by " + x.order_by;
    return (x.order_by ? "Order by " + x.order_by : "") + (x.need ? ", needed in " + x.need : "");
  }
  // One short line under the product: how urgent, then when it is needed.
  function stockMeta(x) {
    const mark = x.months_late > 0 ? '<span class="late-mark">' + plural(x.months_late, "month", "months") + " late</span>"
      : '<span class="st" style="--s:' + STOCK_INK[x.status] + '">' + esc(x.status) + "</span>";
    return mark + (x.need ? " <span>need " + esc(x.need) + "</span>" : "");
  }
  function stockArea(s) {
    if (!s || s.loading) { setChip("stock", "Open"); return areaShell("stock", "Loading…", '<p class="empty-note">Loading the reorder plan…</p>', ""); }
    if (s.error) {
      setChip("stock", "Open");
      return areaShell("stock", "", '<p class="empty-note">' + esc(s.error) + ' <button type="button" class="link" data-stock-retry="1">Try again</button></p>', "");
    }
    const c = s.counts || {}, now = c["Order now"] || 0, soon = c["Order soon"] || 0;
    setChip("stock", now || soon ? plural(now + soon, "to order", "to order") : "Nothing to order");
    if (!s.as_of) return areaShell("stock", "no data yet", '<p class="empty-note">Nothing imported yet. Open Stock and import the CSV files.</p>', "");
    const items = (s.items || []).slice(0, PHONE.matches ? 8 : LIST_CAP);   // phones: a short list, the rest in Stock
    const body = items.length ? '<ul class="rows">' + items.map((x, i) =>
      '<li class="fit"><button type="button" class="row" data-stock="' + i + '"><span class="t"><span>' + esc(x.name) + '</span><small class="stock-meta">' + stockMeta(x) + "</small></span>" +
      "</button></li>").join("") + "</ul>" +
      moreBtn("stock", (s.total || 0) - items.length)
      : '<p class="empty-note">Nothing needs ordering this month or next.</p>';
    const fig = (n, what) => "<span><b>" + n + "</b> " + what + "</span>";
    const foot = fig(c.Overstock || 0, "overstock") + "<span>posted to " + esc(s.as_of) + " BS</span>";
    return areaShell("stock", now || soon ? now + " now, " + soon + " soon" : "nothing due", body, foot);
  }
  const qtyFmt = (n, unit) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(n || 0)) + (unit ? " " + esc(unit) : "");
  function stockPanel(x) {
    openPanel(esc(x.name), "var(--o)",
      '<p class="why"><i class="dot" style="--i:' + STOCK_INK[x.status] + '"></i><b>' + esc(x.status) + ".</b> " +
      (x.months_late > 0 ? "The order-by month has passed: " + esc(x.order_by) + "." : esc(stockWhen(x)) + ".") + "</p>" +
      '<dl class="facts"><dt>In stock</dt><dd' + (Number(x.stock) < 0 ? ' class="bad"' : "") + ">" + qtyFmt(x.stock, x.unit) + "</dd>" +
      "<dt>Suggested order</dt><dd>" + (x.qty ? qtyFmt(x.qty, x.unit) : "–") + "</dd>" +
      "<dt>Order by</dt><dd" + (x.months_late > 0 ? ' class="bad"' : "") + ">" + esc(x.order_by || "–") + (x.months_late > 0 ? ", " + plural(x.months_late, "month", "months") + " late" : "") + "</dd>" +
      "<dt>Needed in</dt><dd>" + esc(x.need || "–") + "</dd>" +
      "<dt>Group</dt><dd>" + esc(x.group) + (x.sub ? " / " + esc(x.sub) : "") + "</dd>" +
      "<dt>Code</dt><dd>" + esc(x.code) + "</dd></dl>" +
      '<div class="actions"><button type="button" class="btn" data-open="stock">Open Stock</button></div>');
  }

  // Clicks inside the work areas
  $("areas").addEventListener("click", (e) => {
    const t = e.target;
    const call = t.closest("[data-call]"); if (call) return callPanel(home.csrc.calls[Number(call.dataset.call)]);
    const sw = t.closest(".sw[data-status]"); if (sw && !sw.disabled) return statusPanel(sw.dataset.status, sw);
    const chq = t.closest("[data-cheques]"); if (chq) return chequePanel(chq.dataset.cheques);
    const cc = t.closest("[data-cc]"); if (cc) return ccPanel(covGroups.red[Number(cc.dataset.cc)]);
    if (t.closest("[data-watch]")) return watchPanel();
    const st = t.closest("[data-stock]"); if (st && stock && stock.items) return stockPanel(stock.items[Number(st.dataset.stock)]);
    if (t.closest("[data-stock-retry]")) return loadStock();
  });

  // ---------- drill-down panel ----------
  let panelOpener = null, panelOnClose = null, panelToken = 0;
  function openPanel(title, band, html, onClose) {
    if ($("panel").hidden) panelOpener = document.activeElement;
    if (panelOnClose && panelOnClose !== onClose) { const f = panelOnClose; panelOnClose = null; f(); }
    panelOnClose = onClose || null;
    $("panel-title").innerHTML = title;
    $("panel").querySelector(".panel-head").style.setProperty("--band", band);
    $("edit").classList.add("hidden");
    const body = $("panel-body");
    body.classList.remove("hidden");
    body.innerHTML = html;
    body.scrollTop = 0;
    body.dataset.token = String(++panelToken);
    $("panel").hidden = false;
    $("scrim").classList.remove("hidden");
    $("panel-close").focus({ preventScroll: true });
    return body;
  }
  const panelIs = (body) => !$("panel").hidden && body.dataset.token === String(panelToken);
  function closePanel() {
    if ($("panel").hidden) return;
    $("panel").hidden = true;
    $("scrim").classList.add("hidden");
    panelToken++;
    if (panelOnClose) { const f = panelOnClose; panelOnClose = null; f(); }
    editing = null;
    if (panelOpener && document.contains(panelOpener)) panelOpener.focus({ preventScroll: true });
    panelOpener = null;
  }
  function wirePick(body, key, fn) {
    body.querySelectorAll("tr.pick[data-" + key + "]").forEach((tr) => {
      const go = () => fn(Number(tr.dataset[key]));
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
    });
  }
  $("panel-close").addEventListener("click", closePanel);
  $("scrim").addEventListener("click", closePanel);
  // Keep keyboard focus inside the open panel.
  $("panel").addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...$("panel").querySelectorAll('button, a[href], input, select, tr[tabindex]')].filter((el) => !el.disabled && el.offsetParent);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // ---------- toast with undo ----------
  let toastTimer = 0, toastUndo = null;
  function toast(text, undo) {
    clearTimeout(toastTimer);
    $("toast-text").textContent = text;
    toastUndo = undo || null;
    $("toast-undo").hidden = !undo;
    $("toast").classList.remove("hidden");
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), undo ? 7000 : 5000);
  }
  $("toast-undo").addEventListener("click", () => {
    const f = toastUndo; toastUndo = null;
    $("toast").classList.add("hidden");
    if (f) f();
  });

  // ---------- search: everything on today's page, plus DPR customers ----------
  let index = [], results = [], sel = -1;
  function buildIndex() {
    index = [];
    if (home.tasks) {
      const { late, due } = taskState(home.tasks);
      for (const o of [...due, ...late]) index.push({ app: "tasks", text: o.task.name + " " + (o.task.company || ""), label: o.task.name,
        hint: late.includes(o) ? "Late" : "Today", go: () => taskPanel(o, late.includes(o)) });
    }
    if (home.csrc) (home.csrc.calls || []).forEach((x) => index.push({ app: "csrc", text: x.customer + " " + (x.engineers || "") + " " + (x.address || ""),
      label: x.customer, hint: (hhmm(x.from) || "") + (x.engineers ? " · " + x.engineers : ""), go: () => callPanel(x) }));
    if (home.coverage) [...covGroups.red, ...covGroups.watch].forEach((g) => index.push({ app: "coverage", text: g.name + " " + g.rows.map((r) => r.part).join(" "),
      label: g.name, hint: g.red.length ? "Over-supplied" : "To watch", go: () => ccPanel(g) }));
    if (stock && stock.items) stock.items.forEach((x) => index.push({ app: "stock", text: x.name + " " + x.code + " " + (x.group || ""),
      label: x.name, hint: x.months_late > 0 ? "Order now, late" : x.status, go: () => stockPanel(x) }));
  }
  function taskPanel(o, isLate) {
    const label = $("areas").querySelector('.tick[data-key="' + CSS.escape(o.task.id + "|" + o.due) + '"]');
    const sent = label && label.classList.contains("done");
    openPanel(esc(o.task.name), "var(--m)",
      '<dl class="facts"><dt>Due</dt><dd' + (isLate ? ' class="bad"' : "") + ">" + esc(TS.fmtBS(o.due)) + (isLate ? ", " + plural(TS.diffDays(home.today, o.due), "day", "days") + " late" : "") + "</dd>" +
      (o.task.company ? "<dt>Company</dt><dd>" + esc(o.task.company) + "</dd>" : "") +
      "<dt>Status</dt><dd id=\"p-task-state\">" + (sent ? "Sent for approval" : esc(taskMeta(o, isLate).split(" · ").pop() || "To do")) + "</dd></dl>" +
      '<div class="actions">' + (sent ? "" : '<button type="button" class="btn" id="p-task-go" style="--i:var(--m)">Send for approval</button>') +
      '<button type="button" class="btn quiet" data-open="tasks">Open Tasks</button></div>');
    const go = $("p-task-go");
    if (go) go.addEventListener("click", async () => {
      go.disabled = true;
      if (await setTask(o.task.id, o.due, true)) { $("p-task-state").textContent = "Sent for approval"; go.remove(); } else go.disabled = false;
    });
  }
  const dprSearch = debounce(async (q, token) => {
    if (!home || !home.dpr || !home.dpr.statuses || q.length < 2) return;
    try {
      const list = await rpc("portal_dpr_customers", { p_status: null, p_query: q });
      if (token !== searchToken) return;
      results = results.filter((r) => r.app !== "dpr").concat(list.map((c) => ({ app: "dpr", label: c.name, hint: c.status + " · Rs " + short(c.total_due), go: () => customerPanel(c) })));
      paintResults(q, false);
    } catch (e) { /* local results stay */ }
  }, 220);
  let searchToken = 0;
  function runSearch() {
    const q = $("search").value.trim();
    searchToken++;
    if (!q) { closeResults(); return; }
    const words = q.toLowerCase().split(/\s+/);
    results = index.filter((r) => words.every((w) => r.text.toLowerCase().includes(w))).slice(0, 12);
    sel = results.length ? 0 : -1;
    const waitingDpr = home && home.dpr && home.dpr.statuses && q.length >= 2;
    paintResults(q, waitingDpr);
    if (waitingDpr) dprSearch(q, searchToken);
  }
  function paintResults(q, pending) {
    const box = $("search-results");
    const groups = ORDER.map((k) => [k, results.filter((r) => r.app === k)]).filter(([, l]) => l.length);
    let i = 0;
    box.innerHTML = groups.map(([k, list]) => "<p>" + (k === "dpr" ? "DPR customers" : APPS[k].name) + "</p>" + list.map((r) =>
      '<button type="button" class="opt" role="option" id="opt-' + i + '" data-i="' + (i++) + '" aria-selected="false"><i class="dot" style="--i:' + APPS[k].ink + '"></i><span>' +
      esc(r.label) + "</span><small>" + esc(r.hint || "") + "</small></button>").join("")).join("") +
      (pending ? '<p class="empty">Searching DPR…</p>' : !results.length ? '<p class="empty">Nothing matches “' + esc(q) + "”.</p>" : "");
    results = groups.flatMap(([, l]) => l);
    if (sel >= results.length) sel = results.length - 1;
    if (sel < 0 && results.length) sel = 0;
    box.classList.remove("hidden");
    $("search").closest(".search").setAttribute("aria-expanded", "true");
    markSel();
  }
  function markSel() {
    $("search-results").querySelectorAll(".opt").forEach((o) => o.setAttribute("aria-selected", String(Number(o.dataset.i) === sel)));
    $("search").setAttribute("aria-activedescendant", sel >= 0 ? "opt-" + sel : "");
    const cur = $("opt-" + sel); if (cur) cur.scrollIntoView({ block: "nearest" });
  }
  function closeResults() {
    $("search-results").classList.add("hidden");
    $("search").closest(".search").setAttribute("aria-expanded", "false");
  }
  function choose(i) {
    const r = results[i];
    if (!r) return;
    closeResults();
    $("search").blur();
    r.go();
  }
  $("search").addEventListener("input", runSearch);
  $("search").addEventListener("focus", () => { if ($("search").value.trim()) runSearch(); });
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (results.length) { sel = (sel + 1) % results.length; markSel(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (results.length) { sel = (sel - 1 + results.length) % results.length; markSel(); } }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    else if (e.key === "Escape") { $("search").value = ""; closeResults(); $("search").blur(); }
  });
  $("search-results").addEventListener("mousedown", (e) => e.preventDefault());
  $("search-results").addEventListener("click", (e) => { const o = e.target.closest(".opt"); if (o) choose(Number(o.dataset.i)); });
  $("search").addEventListener("blur", () => setTimeout(closeResults, 100));

  // Keyboard: / to search, Esc to close.
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing && !$("home-view").classList.contains("hidden") && $("panel").hidden) { e.preventDefault(); $("search").focus(); }
    else if (e.key === "Escape" && !$("panel").hidden) { e.preventDefault(); closePanel(); }
  });

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
    $("people-msg").className = "msg";
    if (!roster) $("people").innerHTML = '<p class="empty">Loading people…</p>';
    try {
      roster = await callFn("portal-admin", { action: "list" });
      renderPeople();
    } catch (e) { $("people-msg").className = "msg error"; $("people-msg").textContent = e.message; }
  }
  function acctLabel(list, id) {
    const a = (list || []).find((x) => x.id === id);
    return a ? a.username + ", " + a.role + (a.active ? "" : ", inactive") : null;
  }
  function renderPeople() {
    const q = $("people-q").value.trim().toLowerCase();
    const rows = roster.users.filter((u) => !q || (u.full_name + " " + u.username).toLowerCase().includes(q));
    const access = (ink, name, text) => text ? '<span class="acc" style="display:block;font-size:14px"><i class="dot" style="--i:' + ink + '"></i>' + name +
      ' <span class="muted">' + esc(text) + "</span></span>" : "";
    $("people").innerHTML = rows.length ? '<table><thead><tr><th>Person</th><th>Apps</th><th class="hide-sm">Last sign-in</th><th>Status</th></tr></thead><tbody>' +
      rows.map((u) => {
        const dpr = u.dpr_role ? (u.dpr_role === "agent" ? "agent " + u.dpr_agent_name : DPR_LABEL[u.dpr_role].toLowerCase()) + (u.dpr_can_export ? ", export" : "") : null;
        const cov = u.coverage_user ? u.coverage_user + (((roster.coverage_accounts || []).find((x) => x.username === u.coverage_user) || {}).active === false ? ", inactive" : "") : null;
        const apps = access("var(--m)", "Tasks", acctLabel(roster.task_accounts, u.task_user_id)) + access("var(--c)", "CSRC", acctLabel(roster.csrc_accounts, u.csrc_user_id)) +
          access("var(--y)", "DPR", dpr) + access("var(--g)", "Coverage", cov) +
          access("var(--o)", "Stock", u.stock_role ? STOCK_LABEL[u.stock_role] : null);
        const state = !u.active ? '<span class="state">Can\'t sign in</span>' : !u.password_set ? '<span class="state warn">Needs a password</span>' : '<span class="state on">Active</span>';
        return '<tr class="pick" data-edit="' + u.id + '" tabindex="0"><td><strong>' + esc(u.full_name) + "</strong>" + (u.is_admin ? " · Admin" : "") +
          '<span class="sub">' + esc(u.username) + "</span></td><td>" + (apps || '<span class="muted">No apps</span>') + "</td>" +
          '<td class="hide-sm">' + (u.last_sign_in ? when(u.last_sign_in) : '<span class="muted">Never</span>') + "</td><td>" + state + "</td></tr>";
      }).join("") + "</tbody></table>" : '<p class="empty">Nobody matches “' + esc(q) + "”.</p>";
  }
  $("people-q").addEventListener("input", () => roster && renderPeople());

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
      return '<option value="' + esc(a.username) + '"' + (other ? " disabled" : "") + ">" + esc((a.full_name || a.username) + " (" + a.username + ")") +
        (a.active ? "" : " – inactive") + (other ? " – linked to someone else" : "") + "</option>";
    }).join("");
    $("e-coverage").value = current || "";
  }
  function syncDprFields() {
    const r = $("e-dpr").value;
    $("e-agent-wrap").classList.toggle("hidden", r !== "agent");
    $("e-export-wrap").classList.toggle("hidden", !r);
  }
  function openEditor(u) {
    openPanel(u ? "Edit " + esc(u.full_name) : "Add person", "var(--k)", "");
    editing = u ? u.id : "";
    $("panel-body").classList.add("hidden");
    $("edit").classList.remove("hidden");
    const isSelf = u && u.id === me.id;
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
    $("e-stock").value = (u && u.stock_role) || "";
    $("e-dpr").value = (u && u.dpr_role) || "";
    $("e-agent").innerHTML = '<option value="">Pick an agent</option>' + roster.dpr_agents.map((n) => '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("");
    $("e-agent").value = (u && u.dpr_agent_name) || "";
    $("e-export").checked = !!(u && u.dpr_can_export);
    syncDprFields();
    $("e-msg").textContent = "";
    $("edit").scrollTop = 0;
    $("e-name").focus({ preventScroll: true });
  }
  $("add-person").addEventListener("click", () => roster && openEditor(null));
  $("people").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-edit]");
    if (tr) openEditor(roster.users.find((u) => u.id === tr.dataset.edit));
  });
  $("people").addEventListener("keydown", (e) => {
    const tr = e.target.closest("tr[data-edit]");
    if (tr && e.key === "Enter") { e.preventDefault(); openEditor(roster.users.find((u) => u.id === tr.dataset.edit)); }
  });
  $("e-dpr").addEventListener("change", syncDprFields);
  $("e-cancel").addEventListener("click", closePanel);
  $("edit").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("e-msg");
    const pass = $("e-pass").value;
    if (!$("e-name").value.trim()) { msg.textContent = "Add their full name."; $("e-name").focus(); return; }
    if (!/^[a-z0-9._\-]{2,32}$/.test($("e-user").value.trim().toLowerCase())) { msg.textContent = "Usernames use 2 to 32 lowercase letters, numbers, dots or dashes."; $("e-user").focus(); return; }
    if (pass && pass.length < 8) { msg.textContent = "Passwords need at least 8 characters."; $("e-pass").focus(); return; }
    if ($("e-dpr").value === "agent" && !$("e-agent").value) { msg.textContent = "Pick the agent whose customers they see."; $("e-agent").focus(); return; }
    const user = {
      id: editing || undefined,
      full_name: $("e-name").value.trim(), username: $("e-user").value.trim().toLowerCase(),
      password: pass || undefined, active: $("e-active").checked, is_admin: $("e-admin").checked,
      csrc_user_id: $("e-csrc").value || null, task_user_id: $("e-tasks").value || null,
      coverage_user: $("e-coverage").value || null,
      stock_role: $("e-stock").value || null,
      dpr_role: $("e-dpr").value || null, dpr_agent_name: $("e-agent").value || null, dpr_can_export: $("e-export").checked,
    };
    $("e-save").disabled = true; msg.textContent = "";
    try {
      const { user: saved } = await callFn("portal-admin", { action: "save", user });
      closePanel();
      toast("Saved " + saved.full_name + "." + (saved.password_set ? "" : " Set a password before they can sign in."));
      await loadPeople();
      if (saved.id === me.id) { home = null; await enter(); location.hash = "#/admin"; }
    } catch (ex) { msg.textContent = ex.message; }
    finally { $("e-save").disabled = false; }
  });

  // ---------- admin: activity ----------
  let activityRows = [], activityEvent = "";
  async function loadActivity() {
    $("activity-msg").className = "msg"; $("activity-msg").textContent = "";
    $("activity").innerHTML = '<p class="empty">Loading activity…</p>';
    const { data, error } = await sb.from("portal_activity").select("username, event, at, user_agent").order("at", { ascending: false }).limit(500);
    if (error) { $("activity").innerHTML = '<p class="empty">Can\'t load activity. Check your connection and try again.</p>'; return; }
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
    const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
    const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
    return [br, os].filter(Boolean).join(" on ");
  }
  const EVENT_INK = { open_csrc: "var(--c)", open_tasks: "var(--m)", open_dpr: "var(--y)", open_coverage: "var(--g)", open_stock: "var(--o)", sign_in: "var(--k)" };
  function renderActivity() {
    const p = $("f-person").value;
    const rows = activityRows.filter((r) => (!p || r.username === p) && (!activityEvent || r.event === activityEvent));
    $("activity").innerHTML = rows.length
      ? '<table><thead><tr><th>When</th><th>Person</th><th>What</th><th class="hide-sm">Device</th></tr></thead><tbody>' +
        rows.map((r) => "<tr><td>" + when(r.at) + "</td><td>" + esc(r.username || "–") + '</td><td><i class="dot" style="--i:' + (EVENT_INK[r.event] || "var(--g)") + '"></i>' +
          (EVENT_LABEL[r.event] || esc(r.event)) + '</td><td class="muted hide-sm">' + esc(device(r.user_agent)) + "</td></tr>").join("") + "</tbody></table>"
      : '<p class="empty">Nothing matches these filters.</p>';
  }
  $("f-person").addEventListener("change", renderActivity);
  $("f-event").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-ev]");
    if (!b) return;
    activityEvent = b.dataset.ev;
    $("f-event").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderActivity();
  });

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
