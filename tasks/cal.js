// Tasks: the Bikram Sambat (BS) calendar and the task schedule rules.
// The rules are the same as portal/schedule.js (the portal's Tasks card); keep the two in step.
// Saturday is the holiday: anything that falls on a Saturday is due on the Sunday after.
(function () {
  const BS_FIRST_YEAR = 2078;
  // Days in each BS month, from Baisakh 2078 onwards (same table as the Tasks app).
  const BS_MONTH_DAYS = [
    [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30], [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30], [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
    [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30], [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
    [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30], [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
    [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30], [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
    [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30], [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
    [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  ];
  const BS_EPOCH = Date.UTC(2021, 3, 14); // 1 Baisakh 2078
  const DAY = 864e5;
  const HOLIDAY = 6; // Saturday
  const BS_MONTHS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Asoj", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
  const AD_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const ms = (d) => { const [y, m, dd] = d.split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  const addDays = (d, n) => iso(ms(d) + n * DAY);
  const diffDays = (a, b) => Math.round((ms(a) - ms(b)) / DAY);
  const weekday = (d) => new Date(ms(d)).getUTCDay();
  const todayNepal = () => iso(Date.now() + 207e5); // Nepal is UTC+5:45
  const yearDays = (row) => row.reduce((a, b) => a + b, 0);

  function bsMonthDays(y, m) {
    const row = BS_MONTH_DAYS[y - BS_FIRST_YEAR];
    if (!row) throw new RangeError("BS year " + y + " is outside the supported range");
    return row[m - 1];
  }
  const adMonthDays = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  function inRange(d) {
    const t = diffDays(d, iso(BS_EPOCH));
    return t >= 0 && t < BS_MONTH_DAYS.reduce((n, row) => n + yearDays(row), 0);
  }
  function toBS(d) {
    let t = diffDays(d, iso(BS_EPOCH));
    if (t < 0) throw new RangeError(d + " is before the supported BS range");
    for (let y = 0; y < BS_MONTH_DAYS.length; y++)
      for (let m = 0; m < 12; m++) {
        const len = BS_MONTH_DAYS[y][m];
        if (t < len) return { y: BS_FIRST_YEAR + y, m: m + 1, d: t + 1 };
        t -= len;
      }
    throw new RangeError(d + " is after the supported BS range");
  }
  function calDate(cal, d) {
    if (cal === "BS") return toBS(d);
    const [y, m, dd] = d.split("-").map(Number);
    return { y, m, d: dd };
  }
  const monthDays = (cal, y, m) => (cal === "BS" ? bsMonthDays(y, m) : adMonthDays(y, m));

  // Does the rule fall on day d? Returns { from } (the first day it can be done) or null.
  function baseMatch(rule, d) {
    const wd = weekday(d);
    switch (rule.type) {
      case "daily": return wd === HOLIDAY ? null : { from: d };
      case "weekdays": return rule.days.includes(wd) ? { from: d } : null;
      case "everyOtherWeek": {
        const gap = diffDays(d, rule.anchor);
        return wd === rule.day && ((gap % 14) + 14) % 14 === 0 ? { from: d } : null;
      }
      case "monthDay": {
        const c = calDate(rule.cal, d), len = monthDays(rule.cal, c.y, c.m);
        return c.d === Math.min(rule.day, len) ? { from: d } : null;
      }
      case "nthWeekday": {
        if (wd !== rule.day) return null;
        const c = calDate(rule.cal, d), len = monthDays(rule.cal, c.y, c.m);
        if (rule.n === -1) return c.d + 7 > len ? { from: d } : null;
        return Math.ceil(c.d / 7) === rule.n ? { from: d } : null;
      }
      case "lastWeek": {
        const c = calDate(rule.cal, d), len = monthDays(rule.cal, c.y, c.m);
        return c.d === len ? { from: addDays(d, -6) } : null;
      }
      case "yearly": {
        if (rule.month == null || rule.day == null) return null;
        const c = calDate(rule.cal, d);
        if (c.m !== rule.month) return null;
        return c.d === Math.min(rule.day, monthDays(rule.cal, c.y, c.m)) ? { from: d } : null;
      }
      case "once": return d === rule.date ? { from: d } : null;
      default: return null; // adhoc: no fixed day
    }
  }
  // Saturday is the holiday: anything that falls on a Saturday is due on Sunday instead.
  function match(rule, d) {
    const wd = weekday(d);
    if (wd === HOLIDAY) return null;
    const hit = baseMatch(rule, d);
    if (hit) return hit;
    if (wd === 0) {
      const sat = addDays(d, -1), prev = baseMatch(rule, sat);
      if (prev) return { from: prev.from === sat ? d : prev.from };
    }
    return null;
  }
  function occurrences(tasks, completions, from, to) {
    const byKey = new Map(completions.map((c) => [c.task_id + "|" + c.due_date, c]));
    const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!inRange(d)) continue;
      for (const task of tasks) {
        if (!task.active || d < task.start_date) continue;
        const hit = match(task.rule, d);
        if (hit) out.push({ task, due: d, from: hit.from, completion: byKey.get(task.id + "|" + d) || null });
      }
    }
    return out;
  }
  function state(o, today) {
    const s = o.completion && o.completion.status;
    if (s === "approved" || s === "submitted" || s === "returned") return s;
    return o.due < today ? "overdue" : "pending";
  }
  // The Tasks app's Today page, reduced to what the card shows.
  function today(tasks, completions, day) {
    const occ = occurrences(tasks, completions, addDays(day, -45), addDays(day, 7));
    const late = [], due = [], waiting = [];
    for (const o of occ) {
      const s = state(o, day);
      if (o.due < day) {
        if (s === "overdue" || s === "returned") late.push(o);
        else if (s === "submitted") waiting.push(o);
      } else if (o.from <= day) {
        if (s === "submitted") waiting.push(o);
        else if (s !== "approved") due.push(o);
      }
    }
    return { late, due, waiting };
  }
  const fmtBS = (d, year = true) => { const b = toBS(d); return BS_MONTHS[b.m - 1] + " " + b.d + (year ? ", " + b.y : ""); };
  function fmtAD(d, year = true) {
    const [y, m, dd] = d.split("-").map(Number);
    return dd + " " + AD_MONTHS[m - 1] + (year ? " " + y : "");
  }


  // ---------- extras for the Tasks app: names, conversions, labels ----------
  const NP_MONTHS = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज", "कार्तिक", "मंसिर", "पुस", "माघ", "फागुन", "चैत"];
  const WD_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const NP_WD = ["आइत", "सोम", "मंगल", "बुध", "बिही", "शुक्र", "शनि"];
  const npDigits = (n) => String(n).replace(/\d/g, (d) => "०१२३४५६७८९"[+d]);
  const BS_LAST_YEAR = BS_FIRST_YEAR + BS_MONTH_DAYS.length - 1;
  // A BS date back to an ISO date.
  function fromBS(y, m, d) {
    let t = 0;
    for (let yy = BS_FIRST_YEAR; yy < y; yy++) t += yearDays(BS_MONTH_DAYS[yy - BS_FIRST_YEAR]);
    for (let mm = 1; mm < m; mm++) t += bsMonthDays(y, mm);
    return iso(BS_EPOCH + (t + d - 1) * DAY);
  }
  const dateOf = (cal, y, m, d) => (cal === "BS" ? fromBS(y, m, d) : iso(Date.UTC(y, m - 1, d)));
  const shiftMonth = (y, m, n) => { const k = y * 12 + (m - 1) + n; return { y: Math.floor(k / 12), m: (k % 12) + 1 }; };
  const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
  const fmtADShort = (d, year = true) => { const [y, m, dd] = d.split("-").map(Number); return AD_MONTHS[m - 1].slice(0, 3) + " " + dd + (year ? ", " + y : ""); };
  // The next date a task falls due, from day d onwards (null for "as needed" or retired tasks).
  function nextDue(task, d, limit = 400) {
    if (task.rule.type === "adhoc" || !task.active) return null;
    let x = d < task.start_date ? task.start_date : d;
    for (let i = 0; i < limit; i++, x = addDays(x, 1)) { if (!inRange(x)) return null; if (match(task.rule, x)) return x; }
    return null;
  }
  // The next working day after d (skips Saturday).
  const nextWorkingDay = (d) => { let x = addDays(d, 1); while (weekday(x) === HOLIDAY) x = addDays(x, 1); return x; };
  const NTH = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", "-1": "Last" };
  const dayList = (days) => { const n = [...days].sort().map((x) => WEEKDAYS[x]); return n.length <= 1 ? n.join("") : n.slice(0, -1).join(", ") + " and " + n[n.length - 1]; };
  function describe(r) {
    switch (r.type) {
      case "daily": return "Every working day (Sun–Fri)";
      case "weekdays": return r.days.length ? "Every " + dayList(r.days) : "No days picked";
      case "everyOtherWeek": return "Every other " + WEEKDAYS[r.day];
      case "monthDay": return ordinal(r.day) + " of the " + r.cal + " month";
      case "nthWeekday": return NTH[r.n] + " " + WEEKDAYS[r.day] + " of the " + r.cal + " month";
      case "lastWeek": return "Last week of the " + r.cal + " month";
      case "yearly": return r.month == null || r.day == null ? "Yearly, date not set" : "Every year, " + (r.cal === "BS" ? BS_MONTHS : AD_MONTHS)[r.month - 1] + " " + r.day + " (" + r.cal + ")";
      case "once": return "Once, on " + fmtADShort(r.date);
      case "adhoc": return "As needed, no fixed day";
    }
    return "";
  }
  function frequencyOf(r) {
    switch (r.type) {
      case "daily": return "Daily";
      case "weekdays": return r.days.length >= 3 ? "Daily" : "Weekly";
      case "everyOtherWeek": return "Fortnightly";
      case "monthDay": case "nthWeekday": case "lastWeek": return "Monthly";
      case "yearly": return "Yearly";
      case "once": return "One-time";
      case "adhoc": return "Adhoc";
    }
    return "";
  }

  window.Cal = { today, occurrences, state, match, addDays, diffDays, weekday, todayNepal, fmtBS, fmtAD, fmtADShort,
    toBS, fromBS, calDate, dateOf, monthDays, inRange, shiftMonth, ordinal, nextDue, nextWorkingDay, describe, frequencyOf,
    npDigits, BS_MONTHS, AD_MONTHS, NP_MONTHS, WEEKDAYS, WD_SHORT, NP_WD, BS_FIRST_YEAR, BS_LAST_YEAR, HOLIDAY };
})();
