// DPR, the customer dues report: customers by status, cheques to send, sent cheques, PDF and Excel exports.
(function () {
  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const STORE_KEY = "dpr_code";
  const PORTAL_KEY = "dpr_portal_session";
  const PORTAL_URL = "https://printcell.ashutosh-sharma.com/";

  // Severity order, worst first, with each status's swatch and short meaning.
  const STATUSES = ["Black", "Gray", "Blue", "Red", "Yellow", "Green"];
  const SCOLOR = { Black: "var(--s-black)", Gray: "var(--s-gray)", Blue: "var(--s-blue)", Red: "var(--s-red)", Yellow: "var(--s-yellow)", Green: "var(--s-green)" };
  const WHEN = { Overdue: "var(--s-red)", Today: "var(--s-yellow)", Tomorrow: "var(--s-blue)" };
  const WHEN_ORDER = ["Overdue", "Today", "Tomorrow"];
  const NO_AGENT = "__none";
  // PDF colours: the same swatches, as pale fills with matching text; Black stays solid.
  const PDF_ST = {
    Black: { fill: [63, 67, 75], text: [255, 255, 255] }, Gray: { fill: [240, 240, 241], text: [88, 91, 96] },
    Blue: { fill: [220, 234, 242], text: [38, 80, 109] }, Red: { fill: [246, 225, 227], text: [117, 50, 58] },
    Yellow: { fill: [250, 243, 223], text: [129, 107, 39] }, Green: { fill: [223, 238, 232], text: [45, 92, 76] },
  };
  const PDF_INK = [29, 32, 36], PDF_MUTED = [85, 90, 98], PDF_LINE = [226, 228, 223];
  const PDF_HEAD = { fillColor: [36, 39, 43], textColor: [255, 255, 255], fontStyle: "bold" };
  const PDF_FOOT = { fillColor: [245, 246, 243], textColor: PDF_INK, fontStyle: "bold" };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || n === "") return "–";
    const v = Number(n);
    return v < 0 ? "(" + fmt.format(-v) + ")" : fmt.format(v);
  }
  function short(n) {
    const v = Math.abs(Number(n || 0));
    const s = v >= 1e7 ? (v / 1e7).toFixed(2) + " Cr" : v >= 1e5 ? (v / 1e5).toFixed(1) + " L" : fmt0.format(v);
    return Number(n) < 0 ? "(" + s + ")" : s;
  }
  const moneyCell = (n) => '<td class="num' + (Number(n) < 0 ? " neg" : "") + '">' + money(n) + "</td>";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(d, shortYear) {
    if (!d) return "–";
    const [y, m, day] = d.split("-");
    return day + "-" + MONTHS[+m - 1] + "-" + (shortYear ? y.slice(2) : y);
  }
  const addDays = (d, n) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
  const groupBy = (list) => { const o = {}; for (const r of list) (o[r.gl_code] = o[r.gl_code] || []).push(r); return o; };
  const sum = (list, f) => list.reduce((s, r) => s + Number((f ? f(r) : r.amount) || 0), 0);

  function reason(c) {
    switch (c.status) {
      case "Black": return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date, and " + money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC.";
      case "Gray": return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date.";
      case "Blue": return money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC.";
      case "Red": return money(c.net_over_credit) + " past credit days not covered by PDC.";
      case "Yellow": return "PDC covers overdue bills, but the oldest bill is " + c.lbp + " days old (credit " + c.credit_days + " days).";
      default: return Number(c.total_due) <= 2500 ? "Dues are Rs 2,500 or less." : "Within credit terms.";
    }
  }

  // ---------- sign-in state ----------
  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { sessionStorage.removeItem(k); } catch (e) {} },
  };
  let portal = null, code = null;
  function takePortalHandoff() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get("access_token") || !h.get("refresh_token")) return null;
    history.replaceState(null, "", location.pathname + location.search);
    return { access_token: h.get("access_token"), refresh_token: h.get("refresh_token"), expires_at: Number(h.get("expires_at")) || 0 };
  }
  // Headers for every call; refreshes the portal token shortly before it expires.
  async function headers() {
    if (portal && portal.expires_at - Date.now() / 1000 < 60) {
      try {
        const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: portal.refresh_token }),
        });
        if (res.ok) {
          const s = await res.json();
          portal = { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in };
          ss.set(PORTAL_KEY, JSON.stringify(portal));
        }
      } catch (e) { /* the request below fails and sends the person back to sign in */ }
    }
    return { apikey: SUPABASE_KEY, Authorization: "Bearer " + (portal ? portal.access_token : SUPABASE_KEY), "Content-Type": "application/json" };
  }
  async function call(fn, body) {
    return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, { method: "POST", headers: await headers(), body: JSON.stringify(body) });
  }
  async function load(c) {
    const res = await call("dpr_data", { p_code: c });
    if (!res.ok) {
      let msg = "Couldn't load the report (" + res.status + "). Try again in a minute.";
      try {
        const e = await res.json();
        if (e && /invalid access code/i.test(e.message || "")) msg = portal
          ? "Your portal login doesn't include DPR. Ask a portal admin, or enter an access code."
          : "That access code isn't valid. Check it and try again.";
      } catch (_) {}
      const err = new Error(msg);
      err.auth = /isn't valid|doesn't include DPR/.test(msg) || res.status === 401 || res.status === 403;
      throw err;
    }
    return res.json();
  }

  // ---------- data ----------
  let data = null, billsBy = {}, pdcsBy = {}, byGl = new Map();
  let filter = "All", selected = null, ageFilter = null, view = "customers", fanned = false;
  function applyData(d) {
    data = d;
    data.customers = data.customers || [];
    billsBy = groupBy(data.bills || []);
    pdcsBy = groupBy(data.pdcs || []);
    byGl = new Map(data.customers.map((c) => [String(c.gl_code), c]));
    let asof = "Data of " + fmtDate(data.report_date);
    if (data.refreshed_at) asof += ", updated " + new Date(data.refreshed_at).toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    $("asof").textContent = asof;
    $("n-customers").textContent = data.customers.length;
    paintPdcCount();
  }

  // ---------- views ----------
  function setView(v) {
    view = v;
    document.querySelectorAll(".view-btn").forEach((b) => { if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    ["customers", "pdc", "sent"].forEach((x) => $(x + "-view").classList.toggle("hidden", x !== v));
    document.body.classList.toggle("fit", v === "customers");
    ss.set("dpr_view", v);
    if (v === "customers") { renderDeck(); renderList(); }
    if (v === "pdc") { renderPdc(); refreshQuiet(); }
    if (v === "sent") initSent();
  }
  $("views").addEventListener("click", (e) => { const b = e.target.closest(".view-btn"); if (b && b.dataset.view !== view) setView(b.dataset.view); });

  // ---------- customers: status swatches filter the list ----------
  function renderDeck() {
    const all = data.customers;
    const tiles = [{ key: "All", list: all, ink: "var(--k)", label: "All customers" }].concat(
      STATUSES.map((s) => ({ key: s, list: all.filter((c) => c.status === s), ink: SCOLOR[s], label: s })));
    const deck = $("deck");
    deck.classList.toggle("filtered", filter !== "All");
    deck.innerHTML = tiles.map((t, i) =>
      '<button type="button" class="sw' + (t.list.length ? "" : " zero") + '" data-status="' + t.key + '" aria-pressed="' + (filter === t.key) +
      '" style="--s:' + t.ink + ";--n:" + i + '"><i></i><span><b>' + t.list.length + "</b><small>" + t.label + "</small><small>Rs " + short(sum(t.list, (c) => c.total_due)) + "</small></span></button>").join("");
    if (!fanned) { deck.classList.add("fan"); fanned = true; setTimeout(() => deck.classList.remove("fan"), 1200); }
  }
  $("deck").addEventListener("click", (e) => {
    const b = e.target.closest(".sw");
    if (!b) return;
    filter = b.dataset.status === filter ? "All" : b.dataset.status;
    renderDeck(); renderList();
  });

  function visibleCustomers() {
    const q = $("search").value.trim().toLowerCase();
    let list = data.customers.filter((c) => (filter === "All" || c.status === filter) &&
      (!q || (c.customer_name || "").toLowerCase().includes(q) || String(c.gl_code).toLowerCase().includes(q)));
    const sort = $("sort").value;
    if (sort === "due") list = list.slice().sort((a, b) => Number(b.total_due) - Number(a.total_due));
    else if (sort === "risk") list = list.slice().sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || Number(b.total_due) - Number(a.total_due));
    else list = list.slice().sort((a, b) => String(a.customer_name).localeCompare(String(b.customer_name), undefined, { sensitivity: "base" }));
    return list;
  }
  let shown = [];
  function renderList() {
    shown = visibleCustomers();
    const total = sum(shown, (c) => c.total_due);
    $("list-sum").textContent = plural(shown.length, "customer", "customers") + " · Rs " + money(total) + (filter !== "All" ? " · " + filter : "");
    $("clist").innerHTML = shown.length
      ? shown.map((c) => '<li><button type="button" class="citem" role="option" data-gl="' + esc(c.gl_code) + '" aria-selected="' + (String(c.gl_code) === String(selected)) +
          '" style="--s:' + (SCOLOR[c.status] || "var(--ink-3)") + '"><i></i><span class="nm">' + esc(c.customer_name) + '</span><span class="amt' + (Number(c.total_due) < 0 ? " neg" : "") + '">' +
          money(c.total_due) + '</span><span class="sub">' + esc(c.status) + " · GL " + esc(c.gl_code) + (c.lbp != null ? " · oldest bill " + c.lbp + "d" : "") + "</span></button></li>").join("")
      : '<li class="cempty">No customers match. Clear the search or pick another status.</li>';
    if ($("search").value.trim() && shown.length === 1 && String(shown[0].gl_code) !== String(selected)) select(shown[0].gl_code, false);
  }
  function select(gl, focus) {
    selected = gl == null ? null : String(gl);
    ageFilter = null;
    $("clist").querySelectorAll(".citem").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.gl === selected)));
    const btn = $("clist").querySelector('.citem[data-gl="' + CSS.escape(selected || "") + '"]');
    if (btn) { btn.scrollIntoView({ block: "nearest" }); if (focus) btn.focus({ preventScroll: true }); }
    showCustomer();
  }
  $("clist").addEventListener("click", (e) => { const b = e.target.closest(".citem"); if (b) select(b.dataset.gl, false); });
  $("clist").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1);
  });
  function move(d) {
    if (!shown.length) return;
    const i = shown.findIndex((c) => String(c.gl_code) === selected);
    const n = i < 0 ? (d > 0 ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, i + d));
    select(shown[n].gl_code, true);
  }
  $("search").addEventListener("input", renderList);
  $("search").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    if (e.key === "Escape") { $("search").value = ""; renderList(); $("search").blur(); }
  });
  $("sort").addEventListener("change", renderList);
  $("detail-back").addEventListener("click", () => { selected = null; showCustomer(); renderList(); });

  // ---------- customer detail ----------
  function bands(c) {
    const cd = Number(c.credit_days || 0), bills = billsBy[c.gl_code] || [];
    const of = (f) => bills.filter((b) => b.age != null && f(Number(b.age)));
    return [
      { key: "ok", cls: "age-ok", label: "Within credit", rows: of((a) => a <= cd) },
      { key: "warn", cls: "age-warn", label: "Past credit days", rows: of((a) => a > cd && a <= cd + 30) },
      { key: "bad", cls: "age-bad", label: "Past credit + 30", rows: of((a) => a > cd + 30) },
    ].map((b) => Object.assign(b, { amt: sum(b.rows) }));
  }
  function showCustomer() {
    const c = selected && byGl.get(selected);
    $("customers-view").querySelector(".work").classList.toggle("has-detail", !!c);
    if (!c) { $("detail").classList.add("hidden"); $("placeholder").classList.remove("hidden"); return; }
    $("placeholder").classList.add("hidden");
    $("d-sw").style.setProperty("--s", SCOLOR[c.status] || "var(--ink-3)");
    $("d-status").textContent = c.status;
    $("d-name").textContent = c.customer_name;
    $("d-code").textContent = "GL " + c.gl_code;
    $("d-why").textContent = reason(c);

    // Ageing bar: each band filters the bills table.
    const bs = bands(c), pos = bs.map((b) => Math.max(0, b.amt)), total = pos.reduce((a, b) => a + b, 0);
    $("age-note").textContent = "credit " + plural(Number(c.credit_days || 0), "day", "days");
    $("age-bar").classList.toggle("filtered", !!ageFilter);
    $("age-bar").innerHTML = total ? bs.map((b, i) => pos[i] ? '<button type="button" class="' + b.cls + '" data-band="' + b.key + '" aria-pressed="' + (ageFilter === b.key) +
      '" style="flex:' + pos[i] + '" title="' + esc(b.label + ": " + money(b.amt)) + '" aria-label="' + esc(b.label + ", " + plural(b.rows.length, "bill", "bills") + ", " + money(b.amt) + ". Show only these bills") + '"></button>' : "").join("") : "";
    $("age-legend").innerHTML = total ? bs.map((b) => '<span class="' + b.cls + '"><i></i>' + b.label + " <b>" + money(b.amt) + "</b> (" + b.rows.length + ")</span>").join("")
      : '<span>No open bills.</span>';

    const pdcs = pdcsBy[c.gl_code] || [];
    const overdueAmt = sum(pdcs.filter((p) => p.age != null && p.age > 0));
    const fact = (k, v, bad) => "<div><dt>" + k + "</dt><dd" + (bad ? ' class="bad"' : "") + ">" + v + "</dd></div>";
    $("facts").innerHTML =
      fact("Total dues", money(c.total_due), Number(c.total_due) < 0) + fact("Total PDC", money(c.total_pdc)) + fact("Credit", c.credit_days != null ? plural(c.credit_days, "day", "days") : "–") +
      fact("Bills past credit", money(c.over_credit), Number(c.over_credit) > 0) + fact("Past credit + 30", money(c.over_credit_30), Number(c.over_credit_30) > 0) +
      fact("Oldest bill (LBP)", c.lbp != null ? plural(c.lbp, "day", "days") : "–") +
      fact("Last bill (LBS)", c.lbs != null ? plural(c.lbs, "day", "days") + " ago" : "–") +
      fact("Cheques past date", String(c.overdue_pdc_count || 0), c.overdue_pdc_count > 0) + fact("Overdue cheques total", money(overdueAmt), overdueAmt > 0);

    renderBills(c);

    $("pdc-count").textContent = plural(pdcs.length, "cheque", "cheques");
    if (!pdcs.length) { $("pdc-split").textContent = ""; $("pdcs").innerHTML = '<p class="empty">No PDC held.</p>'; }
    else {
      const passed = pdcs.filter((p) => p.age != null && p.age > 0), upcoming = pdcs.filter((p) => p.age == null || p.age <= 0);
      $("pdc-split").textContent = "Past cheque date " + money(sum(passed)) + " (" + passed.length + "), upcoming or today " + money(sum(upcoming)) + " (" + upcoming.length + ")";
      $("pdcs").innerHTML = '<table><thead><tr><th>Cheque no.</th><th>Date</th><th class="num">Age</th><th class="num">Amount</th></tr></thead><tbody>' +
        pdcs.map((p) => {
          const age = p.age == null ? "–" : p.age > 0 ? '<span class="t-bad">' + p.age + "d late</span>" : p.age === 0 ? "today" : '<span class="muted">in ' + (-p.age) + "d</span>";
          return "<tr><td>" + esc(p.cheque_no || p.v_number || "–") + "</td><td>" + fmtDate(p.cheque_date, true) + '</td><td class="num">' + age + "</td>" + moneyCell(p.amount) + "</tr>";
        }).join("") + '</tbody><tfoot><tr><td colspan="3">Total</td>' + moneyCell(sum(pdcs)) + "</tr></tfoot></table>";
    }
    $("detail").classList.remove("hidden");
    $("detail-pane").scrollTop = 0;
    if (matchMedia("(max-width: 760px)").matches) $("detail-pane").scrollIntoView({ block: "start" });
  }
  function renderBills(c) {
    const cd = Number(c.credit_days || 0), bills = billsBy[c.gl_code] || [];
    const band = (b) => (b.age == null ? null : b.age > cd + 30 ? "bad" : b.age > cd ? "warn" : "ok");
    const rows = ageFilter ? bills.filter((b) => band(b) === ageFilter) : bills;
    $("bills-count").textContent = ageFilter ? rows.length + " of " + plural(bills.length, "bill", "bills") : plural(bills.length, "bill", "bills");
    $("bills").innerHTML = !bills.length ? '<p class="empty">No open bills.</p>'
      : '<table><thead><tr><th>Bill no.</th><th>Date</th><th class="num">Age</th><th class="num">Amount</th></tr></thead><tbody>' +
        rows.map((b) => { const k = band(b); return "<tr><td>" + esc(b.v_no || "–") + "</td><td>" + fmtDate(b.v_date) + '</td><td class="num' + (k === "bad" ? " t-bad" : k === "warn" ? " t-warn" : "") + '">' +
          (b.age ?? "–") + (b.age != null ? "d" : "") + "</td>" + moneyCell(b.amount) + "</tr>"; }).join("") +
        '</tbody><tfoot><tr><td colspan="3">' + (ageFilter ? "Shown" : "Total") + "</td>" + moneyCell(sum(rows)) + "</tr></tfoot></table>";
  }
  $("age-bar").addEventListener("click", (e) => {
    const b = e.target.closest("[data-band]");
    if (!b) return;
    ageFilter = ageFilter === b.dataset.band ? null : b.dataset.band;
    const c = byGl.get(selected);
    $("age-bar").classList.toggle("filtered", !!ageFilter);
    $("age-bar").querySelectorAll("[data-band]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.band === ageFilter)));
    renderBills(c);
  });

  // ---------- cheques to send ----------
  let pdcWhen = "all", pdcSentF = "all", pending = 0;
  function pdcStatus(p) {
    if (p.age === null || p.age === undefined) return null;
    return p.age > 0 ? "Overdue" : p.age === 0 ? "Today" : p.age === -1 ? "Tomorrow" : null;
  }
  function pdcWindow() {
    return (data.pdcs || []).filter((p) => pdcStatus(p)).slice().sort((a, b) =>
      String(a.customer_name || "").localeCompare(String(b.customer_name || ""), undefined, { sensitivity: "base" }) ||
      String(a.cheque_no || a.v_number || "").localeCompare(String(b.cheque_no || b.v_number || ""), undefined, { numeric: true }) ||
      String(a.cheque_date).localeCompare(String(b.cheque_date)));
  }
  const agentMatch = (p, a) => !a || (a === NO_AGENT ? !p.agent_name : p.agent_name === a);
  const pdcTerms = () => $("pdc-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const termMatch = (hay, terms) => terms.every((t) => hay.includes(t));
  function pdcFiltered() {
    const a = $("pdc-agent").value, terms = pdcTerms();
    return pdcWindow().filter((p) => agentMatch(p, a) && termMatch([p.customer_name, p.v_number, p.cheque_no].join(" ").toLowerCase(), terms) &&
      (pdcWhen === "all" || pdcStatus(p) === pdcWhen) && (pdcSentF === "all" || (pdcSentF === "sent") === !!p.sent));
  }
  function paintPdcCount() {
    const win = pdcWindow(), left = win.filter((p) => !p.sent).length, over = win.filter((p) => !p.sent && pdcStatus(p) === "Overdue").length;
    $("n-pdc").innerHTML = left ? left + " to send" + (over ? ' · <span class="late">' + over + " late</span>" : "") : "All sent";
  }
  function buildAgents() {
    const sel = $("pdc-agent"), keep = sel.value, win = pdcWindow();
    const names = [...new Set(win.map((p) => p.agent_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="">All agents</option>' + names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("") +
      (win.some((p) => !p.agent_name) ? '<option value="' + NO_AGENT + '">No agent</option>' : "");
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : "";
  }
  function renderPdc() {
    const base = pdcWindow().filter((p) => agentMatch(p, $("pdc-agent").value));
    const cnt = (s) => base.filter((p) => pdcStatus(p) === s).length;
    $("pdc-when").innerHTML = '<button type="button" data-v="all" aria-pressed="' + (pdcWhen === "all") + '">All <b>' + base.length + "</b></button>" +
      WHEN_ORDER.map((s) => '<button type="button" data-v="' + s + '" aria-pressed="' + (pdcWhen === s) + '"><i style="--i:' + WHEN[s] + '"></i>' + s + " <b>" + cnt(s) + "</b></button>").join("");
    const sentN = base.filter((p) => p.sent).length;
    const rows = pdcFiltered(), total = sum(rows);
    $("pdc-progress").innerHTML = "<span>Sent today <b>" + sentN + "</b> of <b>" + base.length + '</b></span><span class="track"><i style="width:' +
      (base.length ? (sentN / base.length * 100).toFixed(1) : 0) + '%"></i></span><span>Showing <b>' + rows.length + "</b> · Rs <b>" + money(total) + "</b></span>";
    if (!rows.length) {
      $("pdc-table").innerHTML = '<p class="empty" style="padding:24px 18px">No cheques match these filters.' + (pdcTerms().length ? " Only cheques dated up to tomorrow are listed here." : "") + "</p>";
      return;
    }
    $("pdc-table").innerHTML = '<table><thead><tr><th class="chk">Sent</th><th>Customer</th><th class="d-only">Cheque no.</th><th>Cheque date</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map((p) => {
        const s = pdcStatus(p);
        return "<tr" + (p.sent ? ' class="is-sent"' : "") + '><td class="chk"><input type="checkbox" data-v="' + esc(p.v_number) + '" aria-label="Sent: ' + esc(p.customer_name) + " " + esc(p.cheque_no || "") + '"' + (p.sent ? " checked" : "") + "></td>" +
          '<td class="cust"><span>' + esc(p.customer_name) + "</span><small>" + esc(p.v_number) + (p.agent_name ? " · " + esc(p.agent_name) : "") + '</small></td><td class="d-only">' + esc(p.cheque_no || p.v_number || "–") + "</td>" +
          "<td>" + fmtDate(p.cheque_date, true) + '<br><span class="when' + (s === "Overdue" ? " over" : "") + '" style="--i:' + WHEN[s] + '">' + (s === "Overdue" ? plural(p.age, "day", "days") + " late" : s) + "</span></td>" +
          moneyCell(p.amount) + "</tr>";
      }).join("") + '</tbody><tfoot><tr><td></td><td>Total (' + rows.length + ')</td><td class="d-only"></td><td></td>' + moneyCell(total) + "</tr></tfoot></table>";
  }
  async function setSent(v, sent, quiet) {
    const p = (data.pdcs || []).find((x) => x.v_number === v);
    if (!p) return;
    const prev = !!p.sent;
    p.sent = sent;
    $("pdc-msg").textContent = "";
    renderPdc(); paintPdcCount();
    pending++;
    try {
      const res = await call("dpr_pdc_set_sent", { p_code: code, p_v_number: v, p_sent: sent });
      if (!res.ok) throw new Error("save failed");
      if (!quiet) toast(sent ? "Marked as sent: " + p.customer_name : "Marked as not sent", () => setSent(v, !sent, true));
    } catch (e) {
      p.sent = prev;
      renderPdc(); paintPdcCount();
      $("pdc-msg").textContent = "Couldn't save that tick. Check your connection and try again.";
    } finally { pending--; }
  }
  $("pdc-table").addEventListener("change", (e) => { const b = e.target.closest('input[type="checkbox"]'); if (b && b.dataset.v) setSent(b.dataset.v, b.checked); });
  $("pdc-when").addEventListener("click", (e) => { const b = e.target.closest("button[data-v]"); if (b) { pdcWhen = b.dataset.v; renderPdc(); } });
  $("pdc-sent").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]"); if (!b) return;
    pdcSentF = b.dataset.v;
    $("pdc-sent").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderPdc();
  });
  $("pdc-agent").addEventListener("change", renderPdc);
  $("pdc-q").addEventListener("input", renderPdc);

  // Pick up ticks made on other devices and newly synced data.
  async function refreshQuiet() {
    if ((!code && !portal) || pending) return;
    try {
      const d = await load(code);
      if (pending) return;
      applyData(d); buildAgents();
      if (view === "pdc") renderPdc();
      if (view === "customers") { renderDeck(); renderList(); showCustomer(); }
    } catch (e) { /* keep what is on screen */ }
  }

  // ---------- sent cheques ----------
  let sentRows = [], sentSeq = 0, sentReady = false;
  const sentTerms = () => $("sent-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const sentFiltered = () => sentRows.filter((r) => termMatch([r.customer_name, r.cheque_no, r.v_number].join(" ").toLowerCase(), sentTerms()));
  function setRange(r) {
    const t = data.today;
    const [from, to] = r === "yesterday" ? [addDays(t, -1), addDays(t, -1)] : r === "week" ? [addDays(t, -6), t] : [t, t];
    $("sent-from").value = from; $("sent-to").value = to;
    markRange();
    loadSent();
  }
  function markRange() {
    const t = data.today, f = $("sent-from").value, to = $("sent-to").value;
    const which = f === t && to === t ? "today" : f === addDays(t, -1) && to === f ? "yesterday" : f === addDays(t, -6) && to === t ? "week" : "";
    $("sent-range").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === which)));
  }
  function initSent() { if (!sentReady) { sentReady = true; setRange("today"); } else loadSent(); }
  async function loadSent() {
    const from = $("sent-from").value, to = $("sent-to").value;
    if (!from || !to) { $("sent-msg").textContent = "Pick both dates."; return; }
    if (from > to) { $("sent-msg").textContent = "The first date is after the second. Swap them."; return; }
    const seq = ++sentSeq;
    $("sent-msg").textContent = "";
    $("sent-table").innerHTML = '<p class="empty" style="padding:24px 18px">Loading…</p>';
    try {
      const res = await call("dpr_pdc_sent_list", { p_code: code, p_from: from, p_to: to });
      if (!res.ok) throw new Error("load failed");
      const rows = await res.json();
      if (seq !== sentSeq) return;
      sentRows = Array.isArray(rows) ? rows : [];
      renderSent();
    } catch (e) {
      if (seq !== sentSeq) return;
      sentRows = []; $("sent-table").innerHTML = ""; $("sent-counts").innerHTML = "";
      $("sent-msg").textContent = "Couldn't load sent cheques. Check your connection and try again.";
    }
  }
  function renderSent() {
    const rows = sentFiltered(), total = sum(rows);
    $("sent-counts").innerHTML = "<b>" + plural(rows.length, "cheque", "cheques") + "</b> sent, Rs <b>" + money(total) + "</b>";
    if (!rows.length) { $("sent-table").innerHTML = '<p class="empty" style="padding:24px 18px">No cheques were sent on these dates.</p>'; return; }
    $("sent-table").innerHTML = '<table><thead><tr><th>Sent on</th><th>Customer</th><th class="d-only">Cheque no.</th><th>Cheque date</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map((r) => "<tr><td>" + fmtDate(r.sent_date, true) + '</td><td class="cust"><span>' + esc(r.customer_name || "–") + '</span><small class="m-only">' + esc(r.cheque_no || r.v_number || "") + "</small></td>" +
        '<td class="d-only">' + esc(r.cheque_no || r.v_number || "–") + "</td><td>" + fmtDate(r.cheque_date, true) + "</td>" + moneyCell(r.amount) + "</tr>").join("") +
      '</tbody><tfoot><tr><td></td><td>Total (' + rows.length + ')</td><td class="d-only"></td><td></td>' + moneyCell(total) + "</tr></tfoot></table>";
  }
  $("sent-range").addEventListener("click", (e) => { const b = e.target.closest("button[data-r]"); if (b) setRange(b.dataset.r); });
  ["sent-from", "sent-to"].forEach((id) => $(id).addEventListener("change", () => { markRange(); loadSent(); }));
  $("sent-q").addEventListener("input", renderSent);

  // ---------- exports ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("load " + src));
      document.head.appendChild(s);
    });
  }
  async function ensurePdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    if (typeof new window.jspdf.jsPDF().autoTable !== "function") await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  }
  function pageNumbers(doc) {
    const n = doc.internal.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120); doc.text("Page " + i + " of " + n, W - 40, H - 20, { align: "right" }); }
  }
  async function busy(btn, label, fn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = label;
    try { await fn(); } finally { btn.disabled = false; btn.textContent = old; }
  }
  const slugify = (s) => String(s).replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();

  // Cheques to send, as filtered on screen.
  $("pdc-export").addEventListener("click", () => {
    const rows = pdcFiltered();
    if (!rows.length) { $("pdc-msg").textContent = "Nothing to export with these filters."; return; }
    busy($("pdc-export"), "Preparing…", async () => {
      try {
        await ensurePdf();
        const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
        const ag = $("pdc-agent"), agentTxt = ag.options[ag.selectedIndex].text, showSent = pdcSentF === "all";
        doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...PDF_INK);
        doc.text("Cheques to send", 40, 46);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...PDF_MUTED);
        doc.text("Date: " + fmtDate(data.today) + "     Agent: " + agentTxt, 40, 64);
        doc.text("Cheque date: " + (pdcWhen === "all" ? "Overdue, today and tomorrow" : pdcWhen) + "     Sent today: " +
          ({ all: "All", unsent: "Not sent yet", sent: "Sent" })[pdcSentF] + ($("pdc-q").value.trim() ? "     Search: " + $("pdc-q").value.trim() : ""), 40, 78);
        const head = ["Customer", "Cheque no.", "Cheque date", "Age", "Status"].concat(showSent ? ["Sent"] : [], ["Amount"]);
        const body = rows.map((p) => [p.customer_name || "", p.cheque_no || p.v_number || "", fmtDate(p.cheque_date, true), String(p.age), pdcStatus(p)].concat(showSent ? [p.sent ? "Yes" : ""] : [], [money(p.amount)]));
        const last = head.length - 1, cs = { 3: { halign: "right" } }; cs[last] = { halign: "right" };
        doc.autoTable({ startY: 92, head: [head], body, foot: [["Total (" + rows.length + ")"].concat(new Array(last - 1).fill(""), [money(sum(rows))])], showFoot: "lastPage",
          theme: "grid", margin: { left: 40, right: 40 }, styles: { fontSize: 9, cellPadding: 4, textColor: PDF_INK, lineColor: PDF_LINE }, headStyles: PDF_HEAD, footStyles: PDF_FOOT, columnStyles: cs });
        pageNumbers(doc);
        doc.save("pdc-" + data.today + (ag.value && ag.value !== NO_AGENT ? "-" + slugify(ag.value) : "") + ".pdf");
      } catch (e) { $("pdc-msg").textContent = "Couldn't create the PDF. Check your connection and try again."; }
    });
  });

  // Sent cheques to Excel.
  $("sent-export").addEventListener("click", () => {
    const rows = sentFiltered();
    if (!rows.length) { $("sent-msg").textContent = "Nothing to export for these dates."; return; }
    busy($("sent-export"), "Preparing…", async () => {
      try {
        if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
        const aoa = [["Sent on", "Customer name", "Cheque no.", "Cheque date", "Amount"]];
        rows.forEach((r) => aoa.push([fmtDate(r.sent_date, true), r.customer_name || "", r.cheque_no || r.v_number || "", fmtDate(r.cheque_date, true), Number(r.amount || 0)]));
        aoa.push(["", "Total (" + rows.length + ")", "", "", sum(rows)]);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 14 }, { wch: 38 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
        for (let i = 1; i < aoa.length; i++) { const c = ws["E" + (i + 1)]; if (c) { c.t = "n"; c.z = "#,##0.00"; } }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Sent cheques");
        const f = $("sent-from").value, t = $("sent-to").value;
        XLSX.writeFile(wb, "sent-cheques-" + (f === t ? f : f + "_to_" + t) + ".xlsx");
      } catch (e) { $("sent-msg").textContent = "Couldn't create the Excel file. Check your connection and try again."; }
    });
  });

  // One customer to PDF (no status shown).
  $("cust-export").addEventListener("click", () => {
    const c = byGl.get(selected);
    if (!c) return;
    busy($("cust-export"), "Preparing…", async () => {
      try {
        await ensurePdf();
        const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
        const L = 40, R = doc.internal.pageSize.getWidth() - 40;
        doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor(...PDF_INK);
        doc.text(String(c.customer_name || ""), L, 50, { maxWidth: R - L });
        let y = 50 + (doc.splitTextToSize(String(c.customer_name || ""), R - L).length - 1) * 20 + 18;
        doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor(...PDF_MUTED);
        doc.text("GL " + c.gl_code + "     Report date: " + fmtDate(data.today), L, y);
        y += 14;
        const dash = (v) => (v === null || v === undefined || v === "" ? "–" : String(v));
        const right = { halign: "right" }, R_ = (t) => ({ content: t, styles: right });
        const sty = { fontSize: 9.5, cellPadding: 5, textColor: PDF_INK, lineColor: PDF_LINE, lineWidth: 0.5 };
        const pdcs = pdcsBy[c.gl_code] || [];
        const pairs = [["Total dues", money(c.total_due)], ["Total PDC", money(c.total_pdc)], ["LBS (days since last bill)", dash(c.lbs)], ["LBP (days since oldest bill)", dash(c.lbp)],
          ["Credit days", dash(c.credit_days)], ["Bills past credit days", money(c.over_credit)], ["Bills past credit + 30 days", money(c.over_credit_30)],
          ["Cheques past due date", String(c.overdue_pdc_count || 0)], ["Overdue cheques total", money(sum(pdcs.filter((p) => p.age != null && p.age > 0)))], ["", ""]];
        const srows = [];
        for (let i = 0; i < pairs.length; i += 2) srows.push(pairs[i].concat(pairs[i + 1]));
        const lab = { fontStyle: "bold", fillColor: [245, 246, 243], cellWidth: 150 };
        doc.autoTable({ startY: y, body: srows, theme: "grid", margin: { left: L, right: 40 }, styles: sty,
          columnStyles: { 0: lab, 1: { halign: "right", cellWidth: 105 }, 2: lab, 3: { halign: "right", cellWidth: 110 } } });
        y = doc.lastAutoTable.finalY + 24;
        const section = (title, count) => {
          if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
          doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor(...PDF_INK); doc.text(title, L, y);
          doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...PDF_MUTED); doc.text(count, R, y, { align: "right" });
          y += 8;
        };
        const tbl = (head, body, total) => { doc.autoTable({ startY: y, theme: "grid", margin: { left: L, right: 40 }, styles: sty, headStyles: PDF_HEAD, footStyles: PDF_FOOT, showFoot: "lastPage",
          head: [head], body, foot: [["Total", "", "", R_(money(total))]], columnStyles: { 2: right, 3: right } }); y = doc.lastAutoTable.finalY + 24; };
        const bills = billsBy[c.gl_code] || [];
        section("Bills", plural(bills.length, "bill", "bills"));
        if (!bills.length) { doc.setFontSize(10); doc.text("No open bills.", L, y + 14); y += 34; }
        else tbl(["Bill no.", "Date", R_("Age (days)"), R_("Amount")], bills.map((b) => [b.v_no || "–", fmtDate(b.v_date), dash(b.age), money(b.amount)]), sum(bills));
        section("PDC cheques", plural(pdcs.length, "cheque", "cheques"));
        const ageTxt = (p) => (p.age == null ? "–" : p.age > 0 ? String(p.age) : p.age === 0 ? "today" : "in " + (-p.age) + "d");
        if (!pdcs.length) { doc.setFontSize(10); doc.text("No PDC due.", L, y + 14); }
        else tbl(["Cheque no.", "Cheque date", R_("Age (days)"), R_("Amount")], pdcs.map((p) => [p.cheque_no || p.v_number || "–", fmtDate(p.cheque_date), ageTxt(p), money(p.amount)]), sum(pdcs));
        pageNumbers(doc);
        doc.save(slugify(c.customer_name || "customer") + "-" + data.today + ".pdf");
      } catch (e) { toast("Couldn't create the PDF. Check your connection and try again."); }
    });
  });

  // Customer list (only for codes and people allowed to export).
  function pickBoxes() { return [...$("list-export-st").querySelectorAll('input[type="checkbox"]')]; }
  $("list-export-st").insertAdjacentHTML("beforeend", STATUSES.map((s) =>
    '<label style="--s:' + SCOLOR[s] + '"><input type="checkbox" value="' + s + '" checked><i></i>' + s + "</label>").join(""));
  $("list-export-all").addEventListener("click", () => pickBoxes().forEach((b) => (b.checked = true)));
  $("list-export-none").addEventListener("click", () => pickBoxes().forEach((b) => (b.checked = false)));
  $("list-export-open").addEventListener("click", () => {
    pickBoxes().forEach((b) => (b.checked = filter === "All" || b.value === filter));
    $("list-export-msg").textContent = "";
    openPanel();
  });
  $("list-export").addEventListener("click", () => {
    const msg = $("list-export-msg"), statuses = pickBoxes().filter((b) => b.checked).map((b) => b.value);
    if (!statuses.length) { msg.textContent = "Tick at least one status."; return; }
    const keepFilter = filter; filter = "All";
    const picked = visibleCustomers().filter((c) => statuses.includes(c.status));
    filter = keepFilter;
    if (!picked.length) { msg.textContent = "No customers have those statuses" + ($("search").value.trim() ? " with this search." : "."); return; }
    busy($("list-export"), "Preparing…", async () => {
      msg.textContent = "";
      try {
        const res = await call("dpr_export_customers", { p_code: code });
        if (res.status === 403 || res.status === 401) { msg.textContent = "This login can't export the list."; return; }
        if (!res.ok) throw new Error("load failed");
        const all = await res.json(), by = {};
        all.forEach((r) => { by[String(r.gl_code)] = r; });
        const rows = picked.map((c) => by[String(c.gl_code)]).filter(Boolean);
        await ensurePdf();
        const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
        const L = 40, so = $("sort"), q = $("search").value.trim(), allSt = statuses.length === STATUSES.length;
        doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(...PDF_INK); doc.text("Customer list", L, 40);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...PDF_MUTED);
        doc.text("Data of " + fmtDate(data.report_date) + "     Statuses: " + (allSt ? "All" : statuses.join(", ")) + (q ? "     Search: " + q : "") + "     Sort: " + so.options[so.selectedIndex].text, L, 56);
        doc.text(STATUSES.filter((s) => statuses.includes(s)).map((s) => s + " " + rows.filter((r) => r.status === s).length).join("   ·   "), L, 70);
        doc.autoTable({ startY: 82, head: [["Customer name", "Agent name", "Status"]], body: rows.map((r) => [r.customer_name || "", r.agent_name || "–", r.status || ""]),
          foot: [["Total customers: " + rows.length, "", ""]], showFoot: "lastPage", theme: "grid", margin: { left: L, right: L, bottom: 34 },
          styles: { fontSize: 9.5, cellPadding: 5, textColor: PDF_INK, lineColor: PDF_LINE, lineWidth: 0.5, overflow: "linebreak" }, headStyles: PDF_HEAD, footStyles: PDF_FOOT,
          columnStyles: { 1: { cellWidth: 160 }, 2: { cellWidth: 70, halign: "center", fontStyle: "bold" } },
          didParseCell: (h) => { if (h.section === "body" && h.column.index === 2) { const c = PDF_ST[h.cell.raw]; if (c) { h.cell.styles.fillColor = c.fill; h.cell.styles.textColor = c.text; } } } });
        pageNumbers(doc);
        doc.save("customers-" + (allSt ? "all" : statuses.map((s) => s.toLowerCase()).join("-")) + (q ? "-" + slugify(q) : "") + "-" + data.today + ".pdf");
        msg.textContent = "Exported " + plural(rows.length, "customer", "customers") + ".";
      } catch (e) { msg.textContent = "Couldn't create the PDF. Check your connection and try again."; }
    });
  });

  // ---------- panel and toast ----------
  let opener = null;
  function openPanel() {
    opener = document.activeElement;
    $("panel").hidden = false; $("scrim").classList.remove("hidden");
    $("panel-close").focus({ preventScroll: true });
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
    toastTimer = setTimeout(() => $("toast").classList.add("hidden"), undo ? 7000 : 5000);
  }
  $("toast-undo").addEventListener("click", () => { const f = toastUndo; toastUndo = null; $("toast").classList.add("hidden"); if (f) f(); });

  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (e.key === "Escape" && !$("panel").hidden) { e.preventDefault(); closePanel(); return; }
    if (typing || !data || !$("panel").hidden) return;
    if (e.key === "/") { e.preventDefault(); const s = view === "pdc" ? $("pdc-q") : view === "sent" ? $("sent-q") : $("search"); s.focus(); }
    else if (view === "customers" && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "j" || e.key === "k")) {
      e.preventDefault(); move(e.key === "ArrowDown" || e.key === "j" ? 1 : -1);
    }
  });

  // ---------- screens ----------
  function showReport(d) {
    applyData(d);
    $("boot").classList.add("hidden");
    $("login-view").classList.add("hidden");
    $("shell").classList.remove("hidden");
    const pdcOnly = d.role === "pdc", agentOnly = d.role === "agent";
    document.querySelector('.view-btn[data-view="customers"]').classList.toggle("hidden", pdcOnly);
    document.querySelector('.view-btn[data-view="pdc"]').classList.toggle("hidden", agentOnly);
    document.querySelector('.view-btn[data-view="sent"]').classList.toggle("hidden", agentOnly);
    $("portal-link").classList.toggle("hidden", !portal);
    $("list-export-open").classList.toggle("hidden", d.can_export !== true);
    buildAgents();
    const want = ss.get("dpr_view");
    setView(pdcOnly ? (want === "sent" ? "sent" : "pdc") : agentOnly ? "customers" : want || view);
  }
  function showLogin(msg) {
    data = null; selected = null; filter = "All"; code = null; view = "customers"; sentReady = false; sentRows = [];
    document.body.classList.remove("fit");
    $("boot").classList.add("hidden");
    $("shell").classList.add("hidden");
    $("login-view").classList.remove("hidden");
    $("login-error").textContent = msg || "";
    $("code").value = "";
    $("code").focus();
  }
  async function open(c, silent) {
    $("open").disabled = true;
    if (!silent) $("login-error").textContent = "Opening…";
    try {
      const d = await load(c);
      code = c;
      if (c) ss.set(STORE_KEY, c);
      showReport(d);
    } catch (e) {
      if (e.auth) { ss.del(STORE_KEY); ss.del(PORTAL_KEY); portal = null; }
      showLogin(silent && e.auth ? "" : e.message);
    } finally { $("open").disabled = false; }
  }
  $("login").addEventListener("submit", (e) => { e.preventDefault(); const c = $("code").value.trim(); if (c) open(c, false); });
  $("signout").addEventListener("click", () => {
    ss.del(STORE_KEY); ss.del("dpr_view");
    if (portal) { ss.del(PORTAL_KEY); portal = null; location.assign(PORTAL_URL); return; }
    $("search").value = "";
    showLogin("");
  });

  const handoff = takePortalHandoff();
  if (handoff) { portal = handoff; ss.set(PORTAL_KEY, JSON.stringify(portal)); ss.del(STORE_KEY); open(null, false); }
  else { try { portal = JSON.parse(ss.get(PORTAL_KEY)); } catch (e) { portal = null; }
    if (portal) open(null, true);
    else { const saved = ss.get(STORE_KEY); if (saved) open(saved, true); else showLogin(""); } }
})();
