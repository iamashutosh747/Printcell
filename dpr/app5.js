
  // ---------- Sent cheques ----------
  let sentRows = [], sentSeq = 0, sentReady = false;

  function sentTerms() {
    return $("sent-q").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }
  function sentFiltered() {
    const terms = sentTerms();
    return sentRows.filter((r) => {
      if (!terms.length) return true;
      const hay = [r.customer_name, r.cheque_no, r.v_number].join(" ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }
  function resetSent() {
    sentRows = []; sentReady = false; sentSeq++;
    $("sent-from").value = ""; $("sent-to").value = ""; $("sent-q").value = "";
    $("sent-table").innerHTML = ""; $("sent-counts").innerHTML = ""; $("sent-msg").textContent = "";
  }
  function initSent() {
    if (!sentReady) {
      sentReady = true;
      $("sent-from").value = data.today; $("sent-to").value = data.today;
    }
    loadSent();
  }
  async function loadSent() {
    const from = $("sent-from").value, to = $("sent-to").value;
    if (!from || !to) { $("sent-msg").textContent = "Pick both dates."; return; }
    if (from > to) { $("sent-msg").textContent = "The first date is after the second date."; return; }
    const seq = ++sentSeq;
    $("sent-msg").textContent = "";
    $("sent-table").innerHTML = '<p class="empty" style="padding-top:16px">Loading…</p>';
    try {
      const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/dpr_pdc_sent_list", {
        method: "POST",
        headers: await rpcHeaders(),
        body: JSON.stringify({ p_code: code, p_from: from, p_to: to }),
      });
      if (!res.ok) throw new Error("load failed");
      const rows = await res.json();
      if (seq !== sentSeq) return;
      sentRows = Array.isArray(rows) ? rows : [];
      renderSent();
    } catch (e) {
      if (seq !== sentSeq) return;
      sentRows = [];
      $("sent-table").innerHTML = "";
      $("sent-counts").innerHTML = "";
      $("sent-msg").textContent = "Could not load sent cheques. Check your connection and try again.";
    }
  }
  function renderSent() {
    const rows = sentFiltered();
    const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    $("sent-counts").innerHTML =
      "<span>Cheques <strong>" + rows.length + "</strong></span><span>Total Rs <strong>" + money(total) + "</strong></span>";
    if (!rows.length) {
      $("sent-table").innerHTML = '<p class="empty" style="padding-top:16px">No sent cheques for these dates.</p>';
      return;
    }
    $("sent-table").innerHTML =
      '<table><thead><tr><th class="d-only">Sent on</th><th>Customer</th><th class="d-only">Cheque no.</th>' +
      '<th>Cheque date</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map((r) =>
        '<tr><td class="d-only">' + fmtDate(r.sent_date, true) + "</td>" +
        '<td class="cust">' + esc(r.customer_name || "–") + '<span class="sub-m m-only">' + esc(r.cheque_no || r.v_number || "–") + "</span></td>" +
        '<td class="wrap d-only">' + esc(r.cheque_no || r.v_number || "–") + "</td>" +
        "<td>" + fmtDate(r.cheque_date, true) + '<span class="sub-m m-only">Sent ' + fmtDate(r.sent_date, true) + "</span></td>" +
        moneyCell(r.amount) + "</tr>").join("") +
      '</tbody><tfoot><tr><td class="d-only"></td><td>Total (' + rows.length + ')</td><td class="d-only"></td><td></td>' + moneyCell(total) + "</tr></tfoot></table>";
  }

  async function exportSentExcel() {
    const rows = sentFiltered();
    if (!rows.length) { $("sent-msg").textContent = "Nothing to export for these dates."; return; }
    const btn = $("sent-export");
    btn.disabled = true; btn.textContent = "Preparing…"; $("sent-msg").textContent = "";
    try {
      if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      const aoa = [["Sent on", "Customer name", "Cheque no.", "Cheque date", "Amount"]];
      rows.forEach((r) => aoa.push([fmtDate(r.sent_date, true), r.customer_name || "", r.cheque_no || r.v_number || "",
        fmtDate(r.cheque_date, true), Number(r.amount || 0)]));
      const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
      aoa.push(["", "Total (" + rows.length + ")", "", "", total]);
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 14 }, { wch: 38 }, { wch: 16 }, { wch: 14 }, { wch: 16 }];
      for (let i = 1; i < aoa.length; i++) {
        const c = ws["E" + (i + 1)];
        if (c) { c.t = "n"; c.z = "#,##0.00"; }
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Sent cheques");
      const from = $("sent-from").value, to = $("sent-to").value;
      XLSX.writeFile(wb, "sent-cheques-" + (from === to ? from : from + "_to_" + to) + ".xlsx");
    } catch (e) {
      $("sent-msg").textContent = "Could not create the Excel file. Check your connection and try again.";
    } finally {
      btn.disabled = false; btn.textContent = "Export Excel";
    }
  }

  ["sent-from", "sent-to"].forEach((id) => $(id).addEventListener("change", loadSent));
  $("sent-q").addEventListener("input", renderSent);
  $("sent-export").addEventListener("click", exportSentExcel);

  // ---------- Customer PDF (selected customer only, no status) ----------
  async function exportCustomerPdf() {
    const c = data && data.customers.find((x) => String(x.gl_code) === String(selected));
    if (!c) return;
    const btn = $("cust-export");
    btn.disabled = true; btn.textContent = "Preparing…";
    try {
      await ensurePdf();
      const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
      const L = 40, R = doc.internal.pageSize.getWidth() - 40;
      const INK = [30, 32, 36], MUTED = [95, 98, 104], LINE = [226, 223, 215];
      doc.setFont("helvetica", "bold"); doc.setFontSize(17); doc.setTextColor.apply(doc, INK);
      doc.text(String(c.customer_name || ""), L, 50, { maxWidth: R - L });
      const nameLines = doc.splitTextToSize(String(c.customer_name || ""), R - L).length;
      let y = 50 + (nameLines - 1) * 20 + 18;
      doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.setTextColor.apply(doc, MUTED);
      doc.text("GL " + c.gl_code + "     Report date: " + fmtDate(data.today), L, y);
      y += 14;

      const dash = (v) => (v === null || v === undefined || v === "" ? "–" : String(v));
      const right = { halign: "right" };
      const R_ = (t) => ({ content: t, styles: right });
      const sty = { fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: LINE, lineWidth: 0.5 };
      const head = { fillColor: [30, 122, 176], textColor: [255, 255, 255], fontStyle: "bold" };
      const foot = { fillColor: [241, 238, 231], textColor: INK, fontStyle: "bold" };

      // Summary: label / value pairs, two per row
      const pairs = [
        ["Total dues", money(c.total_due)], ["Total PDC", money(c.total_pdc)],
        ["LBS (days since last bill)", dash(c.lbs)], ["LBP (days since oldest bill)", dash(c.lbp)],
        ["Credit days", dash(c.credit_days)], ["Bills past credit days", money(c.over_credit)],
        ["Bills past credit + 30 days", money(c.over_credit_30)], ["Cheques past due date", String(c.overdue_pdc_count || 0)],
        ["Overdue cheques total", money((pdcsBy[c.gl_code] || []).filter((p) => p.age !== null && p.age > 0).reduce((s, p) => s + Number(p.amount || 0), 0))], ["", ""],
      ];
      const srows = [];
      for (let i = 0; i < pairs.length; i += 2) srows.push(pairs[i].concat(pairs[i + 1]));
      doc.autoTable({
        startY: y, body: srows, theme: "grid", margin: { left: L, right: 40 }, styles: sty,
        columnStyles: {
          0: { fontStyle: "bold", fillColor: [241, 238, 231], cellWidth: 150 }, 1: { halign: "right", cellWidth: 105 },
          2: { fontStyle: "bold", fillColor: [241, 238, 231], cellWidth: 150 }, 3: { halign: "right", cellWidth: 110 } },
      });
      y = doc.lastAutoTable.finalY + 24;

      const section = (title, count) => {
        if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = 50; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.setTextColor.apply(doc, INK);
        doc.text(title, L, y);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor.apply(doc, MUTED);
        doc.text(count, R, y, { align: "right" });
        y += 8;
      };
      const sum = (list) => list.reduce((s, r) => s + Number(r.amount || 0), 0);
      const cd = Number(c.credit_days || 0);

      const bills = billsBy[c.gl_code] || [];
      section("Bills", plural(bills.length, "bill", "bills"));
      if (!bills.length) {
        doc.setFontSize(10); doc.text("No open bills.", L, y + 14); y += 34;
      } else {
        doc.autoTable({
          startY: y, theme: "grid", margin: { left: L, right: 40 }, styles: sty, headStyles: head, footStyles: foot, showFoot: "lastPage",
          head: [["Bill no.", "Date", R_("Age (days)"), R_("Amount")]],
          body: bills.map((b) => [b.v_no || "–", fmtDate(b.v_date), dash(b.age), money(b.amount)]),
          foot: [["Total", "", "", R_(money(sum(bills)))]],
          columnStyles: { 2: right, 3: right },
        });
        y = doc.lastAutoTable.finalY + 24;
      }

      const pdcs = pdcsBy[c.gl_code] || [];
      section("PDC cheques", plural(pdcs.length, "cheque", "cheques"));
      if (!pdcs.length) {
        doc.setFontSize(10); doc.text("No PDC due.", L, y + 14);
      } else {
        const ageTxt = (p) => (p.age === null || p.age === undefined ? "–" : p.age > 0 ? String(p.age) : p.age === 0 ? "today" : "in " + (-p.age) + "d");
        doc.autoTable({
          startY: y, theme: "grid", margin: { left: L, right: 40 }, styles: sty, headStyles: head, footStyles: foot, showFoot: "lastPage",
          head: [["Cheque no.", "Cheque date", R_("Age (days)"), R_("Amount")]],
          body: pdcs.map((p) => [p.cheque_no || p.v_number || "–", fmtDate(p.cheque_date), ageTxt(p), money(p.amount)]),
          foot: [["Total", "", "", R_(money(sum(pdcs)))]],
          columnStyles: { 2: right, 3: right },
        });
      }

      const pages = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
        doc.text("Page " + i + " of " + pages, R, doc.internal.pageSize.getHeight() - 20, { align: "right" });
      }
      const slug = String(c.customer_name || "customer").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
      doc.save(slug + "-" + data.today + ".pdf");
    } catch (e) {
      btn.textContent = "Could not export, try again";
      setTimeout(() => { btn.textContent = "Export PDF"; }, 2500);
      btn.disabled = false;
      return;
    }
    btn.disabled = false; btn.textContent = "Export PDF";
  }
  $("cust-export").addEventListener("click", exportCustomerPdf);
