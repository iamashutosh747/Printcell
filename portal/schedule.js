// Task schedule rules, ported from the Tasks app (tasks.ashutosh-sharma.com) so the portal's Tasks card
// shows exactly the same "due today" and "late" lists as the app's Today page. If the Tasks app changes
// its rules or extends the Bikram Sambat (BS) calendar table, change this file to match.
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

  window.TaskSchedule = { today, occurrences, state, addDays, diffDays, weekday, todayNepal, fmtBS, fmtAD, WEEKDAYS };
})();
