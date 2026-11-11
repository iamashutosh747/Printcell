
  // ---------- detail ----------
  function showCustomer(gl) {
    const c = data.customers.find((x) => String(x.gl_code) === String(gl));
    if (!c) { $("detail").classList.add("hidden"); $("placeholder").classList.remove("hidden"); return; }
    $("placeholder").classList.add("hidden");

    const band = $("d-band");
    band.style.setProperty("--c", SCOLOR[c.status] || "var(--muted)");
    band.dataset.status = c.status || "";
    $("d-status").textContent = c.status;
    $("d-why").textContent = reason(c);
    $("d-name").textContent = c.customer_name;
    $("d-code").textContent = "GL " + c.gl_code;

    const setV = (id, text, neg) => { const el = $(id); el.textContent = text; el.classList.toggle("neg", !!neg); };
    setV("s-due", money(c.total_due), Number(c.total_due) < 0);
    setV("s-pdc", money(c.total_pdc));
    setV("s-lbs", c.lbs ?? "–");
    setV("s-lbp", c.lbp ?? "–");
    setV("s-cd", c.credit_days ?? "–");
    setV("s-l", money(c.over_credit));
    setV("s-l30", money(c.over_credit_30));
    setV("s-p", String(c.overdue_pdc_count ?? 0), c.overdue_pdc_count > 0);
    const overdueAmt = (pdcsBy[c.gl_code] || []).filter((p) => p.age !== null && p.age > 0).reduce((s, p) => s + Number(p.amount || 0), 0);
    setV("s-pa", money(overdueAmt), overdueAmt > 0);

    const cd = Number(c.credit_days || 0);

    // Bills: age past credit days in amber, past credit + 30 in red
    const bills = billsBy[c.gl_code] || [];
    $("bills-count").textContent = plural(bills.length, "bill", "bills");
    if (!bills.length) {
      $("bills").innerHTML = '<p class="empty">No open bills.</p>';
    } else {
      const total = bills.reduce((s, b) => s + Number(b.amount || 0), 0);
      $("bills").innerHTML =
        '<table><thead><tr><th>Bill no.</th><th>Date</th><th class="num">Age</th><th class="num">Amount</th></tr></thead><tbody>' +
        bills.map((b) => {
          const cls = b.age > cd + 30 ? "age-bad" : b.age > cd ? "age-warn" : "";
          return "<tr><td>" + esc(b.v_no || "–") + "</td><td>" + fmtDate(b.v_date) + '</td><td class="num ' + cls + '">' +
                 (b.age ?? "–") + "</td>" + moneyCell(b.amount) + "</tr>";
        }).join("") +
        '</tbody><tfoot><tr><td colspan="3">Total</td>' + moneyCell(total) + "</tr></tfoot></table>";
    }

    // PDC: cheque date passed in red, upcoming as "in N d"
    const pdcs = pdcsBy[c.gl_code] || [];
    $("pdc-count").textContent = plural(pdcs.length, "cheque", "cheques");
    if (!pdcs.length) {
      $("pdc-split").textContent = "";
      $("pdcs").innerHTML = '<p class="empty">No PDC due.</p>';
    } else {
      const sum = (list) => list.reduce((s, p) => s + Number(p.amount || 0), 0);
      const passed = pdcs.filter((p) => p.age !== null && p.age > 0);
      const upcoming = pdcs.filter((p) => p.age === null || p.age <= 0);
      $("pdc-split").textContent = "Past cheque date: " + money(sum(passed)) + " (" + passed.length +
        ") · Upcoming or today: " + money(sum(upcoming)) + " (" + upcoming.length + ")";
      $("pdcs").innerHTML =
        '<table><thead><tr><th>Cheque no.</th><th>Cheque date</th><th class="num">Age</th><th class="num">Amount</th></tr></thead><tbody>' +
        pdcs.map((p) => {
          let age = '<td class="num">–</td>';
          if (p.age !== null && p.age !== undefined) {
            age = p.age > 0 ? '<td class="num age-bad">' + p.age + "</td>"
                : p.age === 0 ? '<td class="num">today</td>'
                : '<td class="num muted">in ' + (-p.age) + "d</td>";
          }
          return '<tr><td class="wrap">' + esc(p.cheque_no || p.v_number || "–") + "</td><td>" + fmtDate(p.cheque_date, true) +
                 "</td>" + age + moneyCell(p.amount) + "</tr>";
        }).join("") +
        '</tbody><tfoot><tr><td colspan="3">Total</td>' + moneyCell(sum(pdcs)) + "</tr></tfoot></table>";
    }

    $("detail").classList.remove("hidden");
  }
