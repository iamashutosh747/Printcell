---
version: 1
slug: "portal-index-html"
primary_target: "portal/index.html"
related_targets: ["dpr/index.html","tasks/index.html"]
---

# Surface: Print Cell family (portal home first; CSRC, DPR, Coverage, Tasks follow)

Mode: Operate. Audience: Print Cell and Biz Print staff at desks and on phones in the field. Job: see what needs doing today and act on it in place. Rollout one app at a time, portal first, each shown to the user before the next (decided 2026-11-15). Interactivity wanted: instant search, filters and drill-down side panels, charts that filter lists, edit in place with undo, purposeful motion and keyboard shortcuts.

## Direction contract

THESIS: Every app is a page from a printer's ink swatch book: each app owns one process ink, and every status the business tracks is a labelled swatch you can pick up. It refuses the grey dashboard with one blue accent and identical KPI cards.

OWN-WORLD: White chip stock on a cool pale desk ground; solid ink fields with a white label strip beneath (name, count, code in tabular figures). Tasks magenta, CSRC cyan, DPR yellow, Coverage key grey, portal registration black. Each ink runs a tint ramp (100/60/30/12) for selection, hover and quiet states. DPR's six statuses are swatches. Hanken Grotesk for UI and figures, Mukta for Nepali dates. Thin rules, small radii (4–6px), no shadows except on lifted panels.

STORY: The visitor sees today across every app they can use, acts in place (tick a task, open a call, pick a status swatch to filter), and leaves for the full app only when the work needs it.

FIRST VIEWPORT: Left rail: the person's name, then a vertical stack of app swatch chips (ink band over a label strip with a live count); the current app's chip is solid with a black outline, others at 30% tint; Settings and Sign out at the rail foot. Main: date in English with the BS date beside it, a search field with the / shortcut at top right. Work areas each topped by a 6px band of their app's ink: Tasks (tall, left), DPR status swatch deck (wide, top right), CSRC calls and Coverage over-supply below. Primary action per area: its Open link, plus in-place ticks.

FORM: Grounded candidate 4 of 7 (ink swatch fan deck). seed:514d180d088945b9. Raises: from the exposure-record sheets, state never by colour alone (late and over-limit carry a screen-tint hatch mark and words); from the metro tiles, no boxed chrome beyond the work-area sheets, type and swatches carry structure; from the vertical feed, on phones today's items page as full-width snap cards with the next one peeking; from the timetable rack, a three-step type scale with rank carried by weight.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- DPR drill-down needs a per-status customer list from the database (new read-only function, role-limited).
- Tasks is rebuilt from scratch in this repo; CSRC and Coverage live in their own repos.
