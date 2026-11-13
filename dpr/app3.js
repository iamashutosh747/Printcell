
  // ---------- PDC details ----------
  const PDC_COLOR = { Overdue: "var(--s-red)", Today: "var(--s-yellow)", Tomorrow: "var(--s-blue)" };
  const PDC_ORDER = ["Overdue", "Today", "Tomorrow"];
  const NO_AGENT = "__none";
  let code = null, pending = 0;

  function pdcStatus(p) {
    if (p.age === null || p.age === undefined) return null;
    return p.age > 0 ? "Overdue" : p.age === 0 ? "Today" : p.age === -1 ? "Tomorrow" : null;
  }
  // Cheques that are overdue, today or tomorrow (later ones are not shown here)
  function pdcWindow() {
    return (data.pdcs || []).filter((p) => pdcStatus(p)).slice().sort((a, b) =>
      String(a.customer_name || "").localeCompare(String(b.customer_name || ""), undefined, { sensitivity: "base" }) ||
      String(a.cheque_no || a.v_number || "").localeCompare(String(b.cheque_no || b.v_number || ""), undefined, { numeric: true }) ||
      String(a.cheque_date).localeCompare(String(b.cheque_date)));
  }
  function agentMatch(p, agent) {
    return !agent || (agent === NO_AGENT ? !p.agent_name : p.agent_name === agent);
  }
  function searchTerms() {
    return $("pdc-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  function searchMatch(p, terms) {
    if (!terms.length) return true;
    const hay = [p.customer_name, p.v_number, p.cheque_no].join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  }
  function pdcFiltered() {
    const agent = $("pdc-agent").value, st = $("pdc-status").value, sent = $("pdc-sent").value;
    const terms = searchTerms();
    return pdcWindow().filter((p) =>
      agentMatch(p, agent) && searchMatch(p, terms) &&
      (st === "all" || pdcStatus(p) === st) &&
      (sent === "all" || (sent === "sent") === !!p.sent));
  }
  function buildAgents() {
    const sel = $("pdc-agent"), keep = sel.value;
    const win = pdcWindow();
    const names = Array.from(new Set(win.map((p) => p.agent_name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
    let html = '<option value="">All agents</option>' +
      names.map((n) => '<option value="' + esc(n) + '">' + esc(n) + "</option>").join("");
    if (win.some((p) => !p.agent_name)) html += '<option value="' + NO_AGENT + '">(No agent)</option>';
    sel.innerHTML = html;
    sel.value = Array.from(sel.options).some((o) => o.value === keep) ? keep : "";
  }
  function renderPdc() {
    const rows = pdcFiltered();
    const base = pdcWindow().filter((p) => agentMatch(p, $("pdc-agent").value));
    const cnt = (s) => base.filter((p) => pdcStatus(p) === s).length;
    const sentN = base.filter((p) => p.sent).length;
    const total = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
    $("pdc-counts").innerHTML =
      PDC_ORDER.map((s) => "<span>" + s + " <strong>" + cnt(s) + "</strong></span>").join("") +
      "<span>Sent today <strong>" + sentN + "</strong> of <strong>" + base.length + "</strong></span>" +
      "<span>Showing <strong>" + rows.length + "</strong> · Rs <strong>" + money(total) + "</strong></span>";

    if (!rows.length) {
      $("pdc-table").innerHTML = '<p class="empty" style="padding-top:16px">No cheques match.' +
        (searchTerms().length ? " Only overdue, today and tomorrow cheques are listed here." : "") + "</p>";
      return;
    }
    $("pdc-table").innerHTML =
      '<table><thead><tr><th class="chk" title="Sent today">Sent</th><th>Customer</th><th class="d-only">Cheque no.</th>' +
      '<th>Cheque date</th><th class="num d-only">Age</th><th class="d-only">Status</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map((p) => {
        const s = pdcStatus(p);
        return '<tr' + (p.sent ? ' class="is-sent"' : "") + '><td class="chk"><input type="checkbox" data-v="' + esc(p.v_number) +
          '" aria-label="Sent: ' + esc(p.customer_name) + " " + esc(p.cheque_no || "") + '"' + (p.sent ? " checked" : "") + "></td>" +
          '<td class="cust">' + esc(p.customer_name) + '<span class="sub-m">' + esc(p.v_number) + '</span><span class="sub-m m-only">' + esc(p.cheque_no || p.v_number || "–") + "</span></td>" +
          '<td class="wrap d-only">' + esc(p.cheque_no || p.v_number || "–") + "</td>" +
          "<td>" + fmtDate(p.cheque_date, true) + '<span class="m-only"><span class="badge badge-m" style="--c:' + PDC_COLOR[s] + '">' + s + (s === "Overdue" ? " " + p.age + "d" : "") + "</span></span></td>" +
          '<td class="num d-only' + (s === "Overdue" ? " age-bad" : "") + '">' + p.age + "</td>" +
          '<td class="d-only"><span class="badge" style="--c:' + PDC_COLOR[s] + '">' + s + "</span></td>" +
          moneyCell(p.amount) + "</tr>";
      }).join("") +
      '</tbody><tfoot><tr><td></td><td>Total (' + rows.length + ')</td><td class="d-only"></td><td></td><td class="d-only"></td><td class="d-only"></td>' + moneyCell(total) + "</tr></tfoot></table>";
  }

  async function setSent(v, sent) {
    const p = (data.pdcs || []).find((x) => x.v_number === v);
    if (!p) return;
    const prev = !!p.sent;
    p.sent = sent;
    $("pdc-msg").textContent = "";
    renderPdc();
    pending++;
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/dpr_pdc_set_sent", {
        method: "POST",
        headers: await rpcHeaders(),
        body: JSON.stringify({ p_code: code, p_v_number: v, p_sent: sent }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch (e) {
      p.sent = prev;
      renderPdc();
      $("pdc-msg").textContent = "Could not save that tick. Check your connection and try again.";
    } finally { pending--; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("load " + src));
      document.head.appendChild(s);
    });
  }
  async function ensurePdf() {
    if (!(window.jspdf && window.jspdf.jsPDF)) {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    }
    const probe = new window.jspdf.jsPDF();
    if (typeof probe.autoTable !== "function") {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
    }
  }

  async function exportPdf() {
    const rows = pdcFiltered();
    if (!rows.length) { $("pdc-msg").textContent = "Nothing to export with these filters."; return; }
    const btn = $("pdc-export");
    btn.disabled = true; btn.textContent = "Preparing…"; $("pdc-msg").textContent = "";
    try {
      await ensurePdf();
      const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      const agentSel = $("pdc-agent"), agentTxt = agentSel.options[agentSel.selectedIndex].text;
      const stSel = $("pdc-status"), snSel = $("pdc-sent");
      const showSent = snSel.value === "all";
      doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(30, 32, 36);
      doc.text("PDC cheques to send", 40, 46);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(95, 98, 104);
      doc.text("Date: " + fmtDate(data.today) + "     Agent: " + agentTxt, 40, 64);
      doc.text("Cheque date: " + stSel.options[stSel.selectedIndex].text + "     Sent today: " +
               snSel.options[snSel.selectedIndex].text +
               ($("pdc-q").value.trim() ? "     Search: " + $("pdc-q").value.trim() : ""), 40, 78);
      const total = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
      const head = ["Customer", "Cheque no.", "Cheque date", "Age", "Status"].concat(showSent ? ["Sent"] : [], ["Amount"]);
      const body = rows.map((p) => [p.customer_name || "", p.cheque_no || p.v_number || "", fmtDate(p.cheque_date, true),
        String(p.age), pdcStatus(p)].concat(showSent ? [p.sent ? "Yes" : ""] : [], [money(p.amount)]));
      const last = head.length - 1;
      const foot = [["Total (" + rows.length + ")"].concat(new Array(last - 1).fill(""), [money(total)])];
      const right = { halign: "right" };
      const cs = { 3: right }; cs[last] = right;
      doc.autoTable({
        startY: 92, head: [head], body: body, foot: foot, showFoot: "lastPage",
        theme: "grid", margin: { left: 40, right: 40 },
        styles: { fontSize: 9, cellPadding: 4, textColor: [30, 32, 36], lineColor: [226, 223, 215] },
        headStyles: { fillColor: [30, 122, 176], textColor: [255, 255, 255] },
        footStyles: { fillColor: [241, 238, 231], textColor: [30, 32, 36], fontStyle: "bold" },
        columnStyles: cs,
        didDrawPage: (h) => {
          doc.setFontSize(8); doc.setTextColor(120);
          doc.text("Page " + doc.internal.getNumberOfPages(), doc.internal.pageSize.getWidth() - 40,
                   doc.internal.pageSize.getHeight() - 20, { align: "right" });
        },
      });
      const slug = agentSel.value && agentSel.value !== NO_AGENT ? "-" + agentSel.value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() : "";
      doc.save("pdc-" + data.today + slug + ".pdf");
    } catch (e) {
      $("pdc-msg").textContent = "Could not create the PDF. Check your connection and try again.";
    } finally {
      btn.disabled = false; btn.textContent = "Export PDF";
    }
  }
