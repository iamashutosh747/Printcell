
  // ---------- Customer list export to PDF (only for codes allowed to export) ----------
  (function () {
    const tools = document.querySelector(".pane-list .tools");
    if (!tools) return;
    // Same inks as the screen: pale tint fill + tint-matched text; Black stays solid key.
    const PDF_COLORS = {
      Black: { fill: [38, 40, 45], text: [253, 252, 249] },
      Gray: { fill: [240, 240, 241], text: [88, 91, 96] },
      Blue: { fill: [220, 234, 242], text: [38, 80, 109] },
      Red: { fill: [246, 225, 227], text: [117, 50, 58] },
      Yellow: { fill: [250, 243, 223], text: [129, 107, 39] },
      Green: { fill: [223, 238, 232], text: [45, 92, 76] },
    };
    const wrap = document.createElement("div");
    wrap.id = "list-export-wrap";
    wrap.className = "hidden";
    wrap.innerHTML =
      '<fieldset id="list-export-st" style="border:1px solid var(--line);border-radius:8px;padding:8px 10px;margin:0 0 8px">' +
        '<legend style="font-size:13px;color:var(--muted);padding:0 4px">Statuses to export</legend>' +
        '<div style="display:flex;flex-wrap:wrap;gap:6px 14px">' +
        STATUSES.map((s) =>
          '<label style="display:inline-flex;align-items:center;gap:6px;font-size:14px;cursor:pointer;margin:0">' +
          '<input type="checkbox" value="' + s + '" checked style="width:auto;height:auto;margin:0;padding:0">' +
          '<span style="width:10px;height:10px;border-radius:2px;background:' + SCOLOR[s] + ';display:inline-block"></span>' + s +
          "</label>").join("") +
        '</div>' +
        '<div style="margin-top:6px;font-size:13px"><a href="#" id="list-export-all">All</a> · <a href="#" id="list-export-none">None</a></div>' +
      "</fieldset>" +
      '<button type="button" class="btn secondary" id="list-export" style="width:100%">Export list to PDF</button>' +
      '<p class="muted" id="list-export-msg" role="status" style="margin:6px 0 0;font-size:13px"></p>';
    tools.appendChild(wrap);

    const boxes = () => Array.from(wrap.querySelectorAll('#list-export-st input[type="checkbox"]'));
    const chosen = () => boxes().filter((b) => b.checked).map((b) => b.value);
    const setAll = (on) => boxes().forEach((b) => { b.checked = on; });
    $("list-export-all").addEventListener("click", (e) => { e.preventDefault(); setAll(true); });
    $("list-export-none").addEventListener("click", (e) => { e.preventDefault(); setAll(false); });

    // Clicking a status tile pre-selects that status here (All tile selects all)
    $("statusbar").addEventListener("click", () => {
      boxes().forEach((b) => { b.checked = filter === "All" || b.value === filter; });
    });

    // Show the export block only when the server says this code may export
    function sync() { wrap.classList.toggle("hidden", !(data && data.can_export === true)); }
    const _showReport = showReport;
    showReport = function (d) { _showReport(d); sync(); };
    const _showLogin = showLogin;
    showLogin = function (msg) { _showLogin(msg); sync(); setAll(true); $("list-export-msg").textContent = ""; };

    // Customers to export: chosen statuses + current search, in the on-screen sort order
    function exportCustomers(statuses) {
      const q = $("search").value.trim().toLowerCase();
      let list = data.customers.filter((c) => statuses.includes(c.status) &&
        (!q || (c.customer_name || "").toLowerCase().includes(q) || String(c.gl_code).includes(q)));
      const sort = $("sort").value;
      if (sort === "due") list = list.slice().sort((a, b) => Number(b.total_due) - Number(a.total_due));
      else if (sort === "risk") list = list.slice().sort((a, b) =>
        STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || Number(b.total_due) - Number(a.total_due));
      return list;
    }

    async function exportList() {
      const msg = $("list-export-msg");
      const statuses = chosen();
      if (!statuses.length) { msg.textContent = "Tick at least one status."; return; }
      const picked = exportCustomers(statuses);
      if (!picked.length) { msg.textContent = "No customers have those statuses" + ($("search").value.trim() ? " with this search." : "."); return; }
      const btn = $("list-export");
      btn.disabled = true; btn.textContent = "Preparing…"; msg.textContent = "";
      try {
        const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/dpr_export_customers", {
          method: "POST",
          headers: await rpcHeaders(),
          body: JSON.stringify({ p_code: code }),
        });
        if (res.status === 403 || res.status === 401) { msg.textContent = "This access code can't export."; return; }
        if (!res.ok) throw new Error("load failed");
        const all = await res.json();
        const byGl = {};
        all.forEach((r) => { byGl[String(r.gl_code)] = r; });
        const rows = picked.map((c) => byGl[String(c.gl_code)]).filter(Boolean);

        await ensurePdf();
        const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
        const L = 40, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
        const INK = [30, 32, 36], MUTED = [95, 98, 104];

        doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor.apply(doc, INK);
        doc.text("Customer list", L, 40);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor.apply(doc, MUTED);
        const allSt = statuses.length === STATUSES.length;
        const so = $("sort"), q = $("search").value.trim();
        doc.text("Data as of " + fmtDate(data.report_date) + "     Statuses: " + (allSt ? "All" : statuses.join(", ")) +
          (q ? "     Search: " + q : "") + "     Sort: " + so.options[so.selectedIndex].text, L, 56);
        // Count per status
        const counts = STATUSES.filter((s) => statuses.includes(s))
          .map((s) => s + " " + rows.filter((r) => r.status === s).length).join("   ·   ");
        doc.text(counts, L, 70);

        const head = [["Customer name", "Agent name", "Status"]];
        const body = rows.map((r) => [r.customer_name || "", r.agent_name || "–", r.status || ""]);
        const foot = [["Total customers: " + rows.length, "", ""]];

        doc.autoTable({
          startY: 82, head: head, body: body, foot: foot, showFoot: "lastPage", theme: "grid",
          margin: { left: L, right: L, bottom: 34 },
          styles: { fontSize: 9.5, cellPadding: 5, textColor: INK, lineColor: [226, 223, 215], lineWidth: 0.5, overflow: "linebreak" },
          headStyles: { fillColor: [30, 32, 36], textColor: [253, 252, 249], fontStyle: "bold" },
          footStyles: { fillColor: [241, 238, 231], textColor: INK, fontStyle: "bold" },
          columnStyles: { 1: { cellWidth: 160 }, 2: { cellWidth: 70, halign: "center", fontStyle: "bold" } },
          didParseCell: (h) => {
            if (h.section === "body" && h.column.index === 2) {
              const c = PDF_COLORS[h.cell.raw];
              if (c) { h.cell.styles.fillColor = c.fill; h.cell.styles.textColor = c.text; }
            }
          },
        });

        const pages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pages; i++) {
          doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(120);
          doc.text("Page " + i + " of " + pages, W - L, H - 18, { align: "right" });
        }
        const slug = (allSt ? "all" : statuses.map((s) => s.toLowerCase()).join("-")) +
          (q ? "-" + q.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() : "");
        doc.save("customers-" + slug + "-" + data.today + ".pdf");
        msg.textContent = "Exported " + plural(rows.length, "customer", "customers") + ".";
      } catch (e) {
        msg.textContent = "Could not create the PDF. Check your connection and try again.";
      } finally {
        btn.disabled = false; btn.textContent = "Export list to PDF";
      }
    }
    $("list-export").addEventListener("click", exportList);

    sync();
  })();
