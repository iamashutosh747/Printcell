
  // ---------- views ----------
  let view = "customers";
  function setView(v) {
    view = v;
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.view === v)));
    $("statusbar").classList.toggle("hidden", v !== "customers");
    $("work").classList.toggle("hidden", v !== "customers");
    $("pdcview").classList.toggle("hidden", v !== "pdc");
    $("sentview").classList.toggle("hidden", v !== "sent");
    document.body.classList.toggle("pdcmode", v === "pdc" || v === "sent");
    if (v === "pdc") { renderPdc(); refreshQuiet(); }
    if (v === "sent") initSent();
  }
  // Pick up ticks made on other devices and newly synced data
  async function refreshQuiet() {
    if ((!code && !portal) || pending) return;
    try {
      const d = await load(code);
      if (pending) return;
      applyData(d);
      renderStatusBar(); renderList(); showCustomer(selected); buildAgents();
      if (view === "pdc") renderPdc();
    } catch (e) { /* keep what is on screen */ }
  }

  // ---------- screens ----------
  function applyData(d) {
    data = d;
    data.customers = data.customers || [];
    billsBy = groupBy(data.bills || []);
    pdcsBy = groupBy(data.pdcs || []);

    let asof = "Data as of " + fmtDate(data.report_date);
    if (data.refreshed_at) {
      asof += ", updated " + new Date(data.refreshed_at).toLocaleString("en-GB", {
        timeZone: "Asia/Kathmandu", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    $("asof").textContent = asof;
  }

  function showReport(d) {
    applyData(d);
    $("login").classList.add("hidden");
    const pdcOnly = d.role === "pdc";
    if (pdcOnly) view = "pdc";
    document.querySelector('.tab[data-view="customers"]').classList.toggle("hidden", pdcOnly);
    const agentOnly = d.role === "agent";
    if (agentOnly) view = "customers";
    $("tabs").classList.toggle("hidden", agentOnly);
    $("signout").classList.remove("hidden");
    $("portal-link").classList.toggle("hidden", !portal);
    document.body.classList.add("app");
    renderStatusBar();
    renderList();
    showCustomer(selected);
    buildAgents();
    setView(view);
  }

  function showLogin(msg) {
    data = null; selected = null; filter = "All"; code = null; view = "customers";
    document.body.classList.remove("app", "pdcmode");
    $("statusbar").classList.add("hidden");
    $("work").classList.add("hidden");
    $("pdcview").classList.add("hidden");
    $("sentview").classList.add("hidden");
    resetSent();
    $("tabs").classList.add("hidden");
    $("signout").classList.add("hidden");
    $("portal-link").classList.add("hidden");
    $("asof").textContent = "";
    $("login").classList.remove("hidden");
    $("login-error").textContent = msg || "";
    $("code").value = "";
    $("code").focus();
  }

  async function open(c, silent) {
    $("open").disabled = true;
    $("login-error").textContent = silent ? "" : "Loading…";
    try {
      const d = await load(c);
      code = c;
      if (c) store.set(c);
      showReport(d);
    } catch (e) {
      if (e.auth) { store.clear(); portalStore.clear(); portal = null; }
      showLogin(silent && e.auth ? "" : e.message);
    } finally {
      $("open").disabled = false;
    }
  }

  // ---------- events ----------
  $("login").addEventListener("submit", (e) => {
    e.preventDefault();
    const c = $("code").value.trim();
    if (c) open(c, false);
  });
  $("signout").addEventListener("click", (e) => {
    e.preventDefault();
    store.clear();
    if (portal) { portalStore.clear(); portal = null; location.assign(PORTAL_URL); return; }
    $("search").value = "";
    showLogin("");
  });
  $("statusbar").addEventListener("click", (e) => {
    const b = e.target.closest(".sbtn");
    if (!b) return;
    filter = b.dataset.status === filter ? "All" : b.dataset.status;
    renderStatusBar();
    renderList();
  });
  $("clist").addEventListener("click", (e) => {
    const b = e.target.closest(".citem");
    if (b) select(b.dataset.gl);
  });
  $("customer").addEventListener("change", (e) => select(e.target.value));
  $("search").addEventListener("input", renderList);
  $("sort").addEventListener("change", renderList);
  $("tabs").addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (t && t.dataset.view !== view) setView(t.dataset.view);
  });
  ["pdc-agent", "pdc-status", "pdc-sent"].forEach((id) => $(id).addEventListener("change", renderPdc));
  $("pdc-q").addEventListener("input", renderPdc);
  $("pdc-table").addEventListener("change", (e) => {
    const b = e.target.closest('input[type="checkbox"]');
    if (b && b.dataset.v) setSent(b.dataset.v, b.checked);
  });
  $("pdc-export").addEventListener("click", exportPdf);

  const handoff = takePortalHandoff();
  if (handoff) { portal = handoff; portalStore.set(portal); store.clear(); open(null, false); }
  else if ((portal = portalStore.get())) open(null, true);
  else { const saved = store.get(); if (saved) open(saved, true); else $("code").focus(); }
