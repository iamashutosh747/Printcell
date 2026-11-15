---
name: Print Cell
description: Five internal apps that read as pages of one ink swatch book.
colors:
  desk: "#eef0ec"
  paper: "#ffffff"
  soft: "#f5f6f3"
  ink: "#1d2024"
  ink-2: "#555a62"
  ink-3: "#62676f"
  rule: "#e2e4df"
  rule-2: "#cdd0ca"
  ink-k: "#24272b"
  ink-m: "#c8237a"
  ink-c: "#0093c9"
  ink-y: "#f2c500"
  ink-g: "#7b808a"
  m-text: "#a3165f"
  c-text: "#00698f"
  y-text: "#7a5f00"
  s-black: "#3f434b"
  s-gray: "#a5a9b0"
  s-blue: "#3d8dc6"
  s-red: "#d65d69"
  s-yellow: "#e8be3e"
  s-green: "#4ca680"
  bad: "#b3343a"
  bad-soft: "#fbeceb"
  ok: "#2a7a50"
  ok-soft: "#e8f4ed"
typography:
  page-title:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.25
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.35
  swatch-figure:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.2
  nepali-date:
    fontFamily: "Mukta, Hanken Grotesk, sans-serif"
    fontSize: "18px"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "6px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "22px"
  xl: "28px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-quiet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "40px"
  app-chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  status-swatch:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    typography: "{typography.swatch-figure}"
  area:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.md}"
---

# Design System: Print Cell

## Overview

Every Print Cell app is a page from a printer's ink swatch book. White chip stock sits on a cool pale desk; colour arrives as solid ink fields with a white label strip underneath, the way a swatch carries its name and code. Each app owns one process ink, and every status the business tracks is a swatch you can pick up.

These are working tools used at desks and on phones at customer sites, so the world contributes only type, palette, density and one signature move (swatches). Layout, navigation and controls stay the standard ones staff already know.

The portal (printcell.ashutosh-sharma.com) is the reference build. CSRC, DPR, Coverage and Tasks adopt the same tokens and components.

## Colors

### App inks (one per app)
- **Key** `#24272b`: the portal and "Today".
- **Magenta** `#c8237a`: Tasks. Text-safe version `#a3165f`.
- **Cyan** `#0093c9`: CSRC. Text-safe version `#00698f`.
- **Yellow** `#f2c500`: DPR. Text-safe version `#7a5f00`; text on a yellow field is always ink.
- **Grey** `#7b808a`: Coverage.

### DPR statuses
Black `#3f434b`, Gray `#a5a9b0`, Blue `#3d8dc6`, Red `#d65d69`, Yellow `#e8be3e`, Green `#4ca680`, always in this order (worst first) and always labelled.

### Neutral
Desk `#eef0ec` is the page ground; Paper `#ffffff` is every sheet, panel and chip; Soft `#f5f6f3` is hover and quiet fills. Ink `#1d2024` for text, `#555a62` secondary, `#62676f` meta (at least 4.9:1 on the desk). Rules `#e2e4df`, stronger rules and control borders `#cdd0ca`.

### State
Bad `#b3343a` (late, over, overdue), OK `#2a7a50` (done, active).

### Named Rules
**The One Ink Rule.** An app's ink appears as fields (a 6px band atop its work area, the chip's ink block, a swatch), never as text. Text uses the text-safe versions.
**The Labelled Swatch Rule.** A swatch always carries its name and figure in its label strip; colour alone never carries meaning.
**The Second Cue Rule.** Late and over-limit states carry words plus a small screen-tint hatch mark, never colour alone.

## Typography

Hanken Grotesk for everything, with tabular figures on by default. Mukta for Nepali (BS) dates.

### Hierarchy
- Page title: 28px / 600 / -0.015em (23px on phones).
- Heading: 17px / 600, the work-area and panel titles.
- Body: 15px / 400 / 1.45.
- Meta: 13px / 400, second lines, labels, counts.
- Swatch figure: 20px / 600.

### Named Rules
**The Weight Rule.** Rank comes from weight and size steps above, never from colour or all-caps labels. There are no eyebrows or kickers.

## Layout

A 232px left rail (name, then a stack of app chips, account links at the foot) beside a fluid main column with 28px gutters. On computer screens (at least 1000×600) the home page fits one window: the first work area runs full height on the left; DPR's swatch deck leads the right, with the remaining areas beneath. Lists show as many rows as fit and end with "N more in …".

Under 760px the rail becomes a top bar with the chips scrolling sideways; work areas stack; today's tasks and calls page sideways as cards with the next one peeking. The drill-down panel becomes a bottom sheet.

## Elevation & Depth

Flat by default: sheets sit on the desk with no shadow. Only lifted things get the one shadow: the drill-down panel, search results, the toast, and a swatch on hover.

### Shadow Vocabulary
- **lift** `0 1px 2px rgba(29,32,36,.06), 0 12px 32px -12px rgba(29,32,36,.22)`.

## Shapes

Small radii: 4px on controls, chips and swatches, 6px on sheets and panels. No pills.

## Components

### Buttons
Primary is ink-filled, 40px high, 4px radius; quiet is paper with a rule border. Inline actions ("Open Tasks") are underlined text links.

### App chip (rail)
An ink block over a white label strip: the app name and a live count ("7 open · 3 late"). Other apps show the ink at 30%; the current page's chip is solid with an ink outline. Clicking an app chip opens that app already signed in.

### Status swatch (signature)
A button: a 56px ink field, then the figure (20px/600), the status name and the amount. Pressing one opens its customers in the panel. Empty statuses fade to 25% and are disabled. On first load the deck fans out from a stack once; this is the single authored motion moment.

### Work area
A paper sheet with a 6px band of its app's ink on top, a heading with its summary, an "Open" link, a list body and a foot of clickable figures.

### Drill-down panel
Slides in from the right (bottom sheet on phones), banded with the relevant ink. It holds facts as a two-column list, tables with totals, and one primary action to open the full app. Esc closes it; focus returns to what opened it.

### Inputs / Fields
40px, paper, `#cdd0ca` border, ink border and a soft 3px ring on focus.

### Toast
Ink background, white text, with Undo for anything done in place.

## Do's and Don'ts

### Do:
- Do act in place: tick, open a panel, undo. Leave for the full app only when the work needs it.
- Do show totals that add up to the rows beneath them, with where and when the data came from.
- Do keep every status labelled, in DPR's order.
- Do give every list an empty state that says what to do next.

### Don't:
- Don't use an app's ink as text colour or as a background for long text.
- Don't add eyebrow labels, gradient text, glass, or extra shadows.
- Don't use the Tasks magenta, CSRC cyan, DPR yellow or Coverage grey for anything other than that app.
- Don't introduce a dark theme; the user asked for light interfaces.
