# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Staff of Print Cell Pvt. Ltd. and Biz Print Pvt. Ltd. (Kathmandu, Nepal), a printer and copier sales and service business. Office staff work at desks on laptops and monitors; service engineers (CSRC) and collection agents (DPR) also open the apps on their phones in the field. Confirmed: a real mix of desk and phone use.

- Portal admin (Ashutosh): manages people, access and activity; uses every app.
- Service manager (Saman): assigns and tracks engineer visits in CSRC.
- Service engineers: see their own calls and fill visit reports (FTR) in CSRC, often on a phone at a customer site.
- Accounts and collection staff, and sales agents: read customer dues, post-dated cheques and sent cheques in DPR; agents see only their own customers.
- Admin staff: work through recurring office tasks in Tasks and submit them for approval; an admin reviews and approves.
- Coverage users: check which cost centres were sent more toner than their machines' usage explains.

## Product Purpose

One sign-in (printcell.ashutosh-sharma.com) opens five internal tools that run the service and collections side of the business. Success is that each person sees what needs doing today, acts on it in the fewest steps, and trusts the numbers.

- **Portal:** sign-in, a home of live cards (today's tasks, today's calls, dues by status, over-supplied toner), people/access admin, and an activity log.
- **CSRC** (Customer Servicing Reporting System): scheduled (SCH) and on-call (OC) engineer visits, assignment with a 4-customers-per-engineer-per-day limit, FTR visit reports with a work-done checklist, log sheet, customer schedules, Nepali (BS) calendar.
- **DPR** (Customer Dues Report): customers by colour status (black, gray, blue, red, yellow, green), bills, post-dated cheques (PDC) due, sent cheques, PDF and Excel exports; roles full, pdc-only and agent.
- **Tasks**: recurring admin tasks on BS-calendar rules (Saturday holiday rolls to Sunday), a Today view with late items, maker submits, admin approves or returns.
- **Coverage**: toner, drum and developer dispatches compared with expected use from meter readings and CMYK coverage, graded Green, Amber, Red per cost centre and part, by fiscal year.
- **Stock** (stock.ashutosh-sharma.com, repo `stock-reorder`, Next.js): current stock, reorder plan by Nepali month, pipeline lots, sales pattern and sales dashboard from SQL Server CSV exports; tables `stock_`; access levels stock, view, full set per person in portal admin; signs in through the portal's `/sso` hand-off.

## Positioning

Built around how this business actually runs: Nepali calendar dates, Konica Minolta machine readings, the colour-coded dues sheet the accounts team already used on paper and Excel, and one login across everything.

## Operating Context

- Dates are shown in both BS (Nepali) and AD; Saturday is the weekly holiday; the business day is Asia/Kathmandu.
- DPR data comes from the accounting system through the accounting-sync job; Coverage readings come from the Konica Minolta CSRC portal; both are read-only in their apps.
- PDF and Excel exports are handed to people outside the apps, so export layouts matter.
- Mobile use happens on site and on the move: short sessions, one task, poor connectivity at times (CSRC has an offline shell).

## Capabilities and Constraints

- One Supabase project (`csrc-system`) holds every app's data; tables are prefixed `csrc_`, `task_list_`, `dpr_`, `cov_`, `portal_`. Row-level security and the portal's SSO hand-off must keep working.
- Each app stays on its own subdomain and Vercel project. Portal, DPR and Tasks deploy from the Printcell repo; CSRC from its `csrc` repo (vanilla JS, PWA); Coverage from `toner-pilferage` (Next.js, own cookie login with `/sso`).
- Tasks has no source; it is being rebuilt in the Printcell repo on the same tables and rules (decided 2026-11-15). The old build stays live until the rebuild is checked.
- Redesign scope (decided 2026-11-15): all five apps, one at a time, starting with the portal, each shown to the user before the next. Wanted interactivity: instant search, filters and drill-down side panels; charts that filter the lists beside them; edit in place with undo; purposeful motion and keyboard shortcuts.
- Existing rules that must survive any redesign: the CSRC daily limit, Tasks schedule rules, DPR role limits, Coverage grading.

## Brand Commitments

- Names: Print Cell, Biz Print, and the app names CSRC, Tasks, DPR, Coverage.
- The DPR status colours (black, gray, blue, red, yellow, green) are business meaning, not decoration; they must stay recognisable.
- CMYK is the house's own subject (printing); the apps have used cyan, magenta, yellow and key as app markers.
- Light, calm interfaces: the user asked for lighter, not dark (2026-11-13).

## Evidence on Hand

Real data lives in the database (customers, calls, dues, cheques, tasks, dispatches). No marketing content, testimonials or public claims exist or are needed; these are internal tools.

## Product Principles

1. Today first: every app opens on what needs attention now.
2. Act where you see it: tick, reschedule or change status in place, with undo, instead of separate forms.
3. Numbers you can trust: totals always add up to the lists beneath them, and every figure says where and when it came from.
4. One family: five apps that feel like one product, so learning one teaches the rest.
5. Works on a phone at a customer site as well as on a desk.

## Accessibility & Inclusion

Status colours must always carry a second cue (label, position or shape). Text contrast at least WCAG AA. Full keyboard use on desktop; touch targets at least 44px on phones.
