  const SUPABASE_URL = "https://fbtddbcypmevfokpiyzo.supabase.co";
  const SUPABASE_KEY = "sb_publishable_kPJUJh8ap5h1boN8uXwY1g_3cJfvfq-";
  const STORE_KEY = "dpr_code";
  const PORTAL_KEY = "dpr_portal_session";
  const PORTAL_URL = "https://printcell.ashutosh-sharma.com/";
  // Portal sign-in: printcell.ashutosh-sharma.com hands over a Supabase session in the URL hash.
  // With it, requests carry the person's token and no access code (DPR reads their portal role).
  let portal = null;

  // Severity order: worst first
  const STATUSES = ["Black", "Gray", "Blue", "Red", "Yellow", "Green"];
  const SCOLOR = {
    Black: "var(--s-black)", Gray: "var(--s-gray)", Blue: "var(--s-blue)",
    Red: "var(--s-red)", Yellow: "var(--s-yellow)", Green: "var(--s-green)",
  };
  const SINK = { Black: "var(--s-black-ink)", Yellow: "var(--s-yellow-ink)" };

  const $ = (id) => document.getElementById(id);
  let data = null, billsBy = {}, pdcsBy = {};
  let filter = "All", selected = null;

  // ---------- helpers ----------
  const store = {
    get() { try { return sessionStorage.getItem(STORE_KEY); } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem(STORE_KEY, v); } catch (e) {} },
    clear() { try { sessionStorage.removeItem(STORE_KEY); } catch (e) {} },
  };
  const portalStore = {
    get() { try { return JSON.parse(sessionStorage.getItem(PORTAL_KEY)); } catch (e) { return null; } },
    set(v) { try { sessionStorage.setItem(PORTAL_KEY, JSON.stringify(v)); } catch (e) {} },
    clear() { try { sessionStorage.removeItem(PORTAL_KEY); } catch (e) {} },
  };
  function takePortalHandoff() {
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.get("access_token") || !h.get("refresh_token")) return null;
    history.replaceState(null, "", location.pathname + location.search);
    return { access_token: h.get("access_token"), refresh_token: h.get("refresh_token"),
             expires_at: Number(h.get("expires_at")) || 0 };
  }
  // Headers for every RPC call; refreshes the portal token shortly before it expires.
  async function rpcHeaders() {
    if (portal && portal.expires_at - Date.now() / 1000 < 60) {
      try {
        const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
          method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: portal.refresh_token }),
        });
        if (res.ok) {
          const s = await res.json();
          portal = { access_token: s.access_token, refresh_token: s.refresh_token,
                     expires_at: s.expires_at || Math.floor(Date.now() / 1000) + s.expires_in };
          portalStore.set(portal);
        }
      } catch (e) { /* the request below fails and sends the person back to sign in */ }
    }
    return { apikey: SUPABASE_KEY, Authorization: "Bearer " + (portal ? portal.access_token : SUPABASE_KEY),
             "Content-Type": "application/json" };
  }
  const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmt0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || n === "") return "–";
    const v = Number(n);
    return v < 0 ? "(" + fmt.format(-v) + ")" : fmt.format(v);
  }
  function short(n) {               // compact amounts for the status bar
    const v = Math.abs(Number(n || 0));
    if (v >= 1e7) return (v / 1e7).toFixed(2) + " Cr";
    if (v >= 1e5) return (v / 1e5).toFixed(1) + " L";
    return fmt0.format(v);
  }
  function moneyCell(n) {
    return '<td class="num' + (Number(n) < 0 ? " neg" : "") + '">' + money(n) + "</td>";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmtDate(d, shortYear) {
    if (!d) return "–";
    const [y, m, day] = d.split("-");
    return day + "-" + MONTHS[+m - 1] + "-" + (shortYear ? y.slice(2) : y);
  }
  function groupBy(list) {
    const out = {};
    for (const r of list) (out[r.gl_code] = out[r.gl_code] || []).push(r);
    return out;
  }
  const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

  function reason(c) {
    const f = Number(c.total_pdc || 0);
    switch (c.status) {
      case "Black": return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date, and " +
                           money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC";
      case "Gray":  return plural(c.overdue_pdc_count, "cheque", "cheques") + " past due date";
      case "Blue":  return money(c.net_over_credit_30) + " past credit + 30 days not covered by PDC";
      case "Red":   return money(c.net_over_credit) + " past credit days not covered by PDC";
      case "Yellow":return "PDC covers overdue bills, but the oldest bill is " + c.lbp + " days old (credit " +
                           c.credit_days + " days)";
      default:      return Number(c.total_due) <= 2500 ? "Dues are Rs 2,500 or less" : "Within credit terms";
    }
  }

  // ---------- data ----------
  async function load(code) {
    const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/dpr_data", {
      method: "POST",
      headers: await rpcHeaders(),
      body: JSON.stringify({ p_code: code }),
    });
    if (!res.ok) {
      let msg = "Could not load the report (" + res.status + "). Try again in a minute.";
      try {
        const e = await res.json();
        if (e && /invalid access code/i.test(e.message || "")) msg = portal
          ? "Your portal login doesn't include DPR. Ask a portal admin, or enter an access code."
          : "That access code is not valid.";
      } catch (_) {}
      const err = new Error(msg);
      err.auth = /not valid|doesn't include DPR/.test(msg) || res.status === 401 || res.status === 403;
      throw err;
    }
    return res.json();
  }

  // ---------- status bar ----------
  function renderStatusBar() {
    const all = data.customers;
    const sum = (list) => list.reduce((s, c) => s + Number(c.total_due || 0), 0);
    const tiles = [{ key: "All", list: all, color: "var(--accent)" }].concat(
      STATUSES.map((s) => ({ key: s, list: all.filter((c) => c.status === s), color: SCOLOR[s] })));
    $("statusbar").innerHTML = tiles.map((t) =>
      '<button type="button" class="sbtn" data-status="' + t.key + '" aria-pressed="' + (filter === t.key) +
      '" style="--c:' + t.color + '">' +
      '<div class="n">' + t.list.length + '</div>' +
      '<div class="k">' + (t.key === "All" ? "All customers" : t.key) + '</div>' +
      '<div class="v">Rs ' + short(sum(t.list)) + '</div></button>').join("");
  }

  // ---------- customer list + dropdown ----------
  function visibleCustomers() {
    const q = $("search").value.trim().toLowerCase();
    let list = data.customers.filter((c) =>
      (filter === "All" || c.status === filter) &&
      (!q || (c.customer_name || "").toLowerCase().includes(q) || String(c.gl_code).includes(q)));
    const sort = $("sort").value;
    if (sort === "due") list = list.slice().sort((a, b) => Number(b.total_due) - Number(a.total_due));
    else if (sort === "risk") list = list.slice().sort((a, b) =>
      STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || Number(b.total_due) - Number(a.total_due));
    return list;
  }

  function renderList() {
    const list = visibleCustomers();

    $("clist").innerHTML = list.length
      ? list.map((c) =>
          '<li><button type="button" class="citem" data-gl="' + esc(c.gl_code) + '" aria-current="' +
          (String(c.gl_code) === String(selected)) + '" style="--c:' + (SCOLOR[c.status] || "var(--muted)") + '">' +
          '<span class="nm">' + esc(c.customer_name) + '</span>' +
          '<span class="amt' + (Number(c.total_due) < 0 ? " neg" : "") + '">' + money(c.total_due) + '</span>' +
          '<span class="sub">' + esc(c.status) + ', GL ' + esc(c.gl_code) + '</span></button></li>').join("")
      : '<li class="cempty">No customers match. Clear the search or pick another status.</li>';

    const sel = $("customer");
    sel.innerHTML = '<option value="">— Select a customer —</option>' +
      list.map((c) => '<option value="' + esc(c.gl_code) + '">' + esc(c.customer_name) + " (" + esc(c.status) + ")</option>").join("");
    if (list.some((c) => String(c.gl_code) === String(selected))) sel.value = selected;
    else if ($("search").value.trim() && list.length === 1) { select(list[0].gl_code); return; }
    else sel.value = "";
  }

  function select(gl) {
    selected = gl || null;
    renderList();
    showCustomer(selected);
  }
