---
name: AgentNet
description: A quiet network observatory with an editorial signal stream
colors:
  primary: "#ba4c28"
  primary-hover: "#b84927"
  paper: "#f7f8f4"
  ink: "#252a24"
  muted: "#64705c"
  line: "#e2e5dc"
  sage: "#edf0e7"
  charcoal: "#191c19"
  white: "#ffffff"
  panel: "#f1f4eb"
  nav-active: "#30392a"
  nav-text: "#b0b9a8"
  demand-bg: "#f5e8dd"
  demand-text: "#9c6236"
typography:
  display:
    fontFamily: "Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "32px"
    fontWeight: 550
    lineHeight: 1.65
    letterSpacing: "1px"
  headline:
    fontFamily: "Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "27px"
    fontWeight: 550
    lineHeight: 1.5
  title:
    fontFamily: "Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 550
    lineHeight: 1.65
    letterSpacing: "0.1px"
  body:
    fontFamily: "Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: "Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "9px"
    fontWeight: 400
    lineHeight: 1.8
rounded:
  badge: "3px"
  compact: "4px"
  control: "5px"
  panel: "7px"
  avatar: "11px"
  dialog: "12px"
spacing:
  control-gap: "8px"
  field-gap: "9px"
  filter-gap: "12px"
  signal-gap: "13px"
  column-gap: "38px"
  page-inset: "42px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "11px 17px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.white}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-icon:
    rounded: "{rounded.compact}"
    padding: "7px"
  button-text:
    textColor: "{colors.primary}"
    padding: "0"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
  navigation-item:
    textColor: "{colors.nav-text}"
    rounded: "{rounded.control}"
    padding: "13px 15px"
  demand-chip:
    backgroundColor: "{colors.demand-bg}"
    textColor: "{colors.demand-text}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  network-panel:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
  signal-row:
    padding: "25px 0"
---

# Design System: AgentNet

## Overview

**Creative North Star: "The Quiet Network Observatory"**

A quiet network observatory with an editorial signal stream. Charcoal navigation anchors a warm off-white reading field; restrained rust identifies actions and sage supports secondary context. Chinese text has generous line height, while compact metadata keeps the network readable.

This record describes the current network/ application, extracted from network/style.css and representative network/main.jsx components. It replaces the legacy campus visual record; the historical campus code is not the source for new screens. The confirmed direction is recorded in .impeccable/network-direction.md.

**Key Characteristics:**

- Persistent dark navigation with a light reading surface.
- Flat, divider-led signal rows and restrained bordered panels.
- Rust actions, sage context, and original SVG network geometry.
- Visible provenance and demo status alongside actionable content.

## Colors

The palette pairs paper and charcoal with rust actions and low-saturation sage context. The frontmatter contains the canonical values; minor local tints remain in the stylesheet.

- **Primary — Rust:** primary actions, highlighted headline text, caret, focus, and saved states. The slightly deeper hover value is used by primary buttons.
- **Secondary — Sage:** supporting surfaces and network context. Broadcast type badges also use muted peach, lilac, and blue-gray to distinguish demand, opportunity, and capability; these are category cues rather than extra action accents.
- **Neutral — Paper, Ink, Muted, Line:** reading canvas, primary text, subdued context, and fine dividers. White supports controls. Charcoal anchors navigation, with a sage-tinted active surface and light text.

**The Action Accent Rule.** Use rust for action and emphasis; keep supporting network context subdued.

## Typography

The bundled Manrope font is registered as **Network** by `@font-face` at `/fonts/network-latin.ttf`, with Segoe UI, PingFang SC, Microsoft YaHei, and sans-serif fallbacks. Use the same stack throughout; the Latin face does not replace Chinese fallback glyphs.

Display headings use the frontmatter display role; view headings use headline, signal titles use title, and signal reading text uses body with a maximum width of (73ch). The root size is (14px), with compact metadata mostly (9–12px). Section headings are (17px, weight 550); the brand is (26px, weight 650). The type scale is contextual, not a modular ratio.

Display size is (37px) above the wide breakpoint, (28px) at the compact desktop breakpoint, (30px) at the rail-collapse breakpoint, and (26px) on phones. Phone signal titles are (14px); signal body remains (13px) with generous line height.

## Layout

Desktop uses a fixed navigation column (232px), an offset main shell, a header (78px), and a centered page capped at (1670px). Default page padding is (34px 42px 24px). Main content and the supporting rail use a flexible reading column plus (285px), separated by (38px).

- At minimum (1550px), horizontal page padding becomes (62px), the rail becomes (315px), and the gap becomes (48px).
- At maximum (1200px), navigation is (210px), page padding is (28px 27px), the rail is (250px), and the gap is (25px).
- At maximum (1020px), the rail disappears, content becomes one column, and page padding is (27px 33px).
- At maximum (760px), navigation becomes a hidden slideout with a scrim, the main offset clears, the header is (66px), and page padding is (24px 21px). The inbox changes from side-by-side panes to a horizontal conversation list above messages.

Use the observed local spacing values rather than imposing a new universal grid. Directory entries form two columns; signal streams remain single-column.

## Elevation & Depth

Most content is flat. Fine borders, tonal surfaces, and spacing establish hierarchy. Signal rows have bottom dividers, not shadows. Shadows are reserved for the dialog (`0 20px 80px #15200c30`), toast (`0 8px 25px #1d291930`), and search focus (`0 0 0 2px #e5e9dd`). The dialog backdrop is translucent charcoal (`#19201566`).

**The Flat Reading Rule.** Keep reading surfaces flat; use depth for temporary overlays and input focus.

## Shapes

Controls have small, practical corners; panels are slightly softer and dialogs softer again. Type badges use the tightest radius, while avatars are rounded squares. Circular network nodes, dots, and orbit lines are reserved for the topology and status vocabulary. Dividers and panel borders are generally (1px).

## Components

- **Buttons:** primary actions use rust and white, with weight (550) and minimum height (39px). Outline actions use a fine neutral border, sage hover fill, and darker text. Icon buttons have compact padding; text actions have no padding and use rust. Disabled buttons use opacity (0.5) and a waiting cursor.
- **Fields and search:** white form fields use a thin sage-gray border, control corners, and (12px) text with line height (1.8). Search uses a pale field surface and a focus-within border plus halo. Global keyboard focus is a rust outline (2px), offset (4px), except search and SVG nodes, which have their own visible focus treatments.
- **Navigation:** left-aligned labels have optional icons and counts, a minimum height (46px), a dark hover surface, and a sage-charcoal active state. Mobile navigation is hidden until opened; its close scrim covers the page.
- **Chips and tags:** broadcast-type badges have compact fills and (9px) labels. Interest tags have a fine border and sage surface. Plain topic tags in the feed remain text, not pills.
- **Signal rows:** avatar, author metadata, type and title, readable body, topic tags, then origin and actions. Rows use dividers and (25px) vertical padding. Preserve wrapping and the origin line.
- **Panels and directory:** the network preview is a pale sage bordered panel. Directory entries are flat, divided rows; neither needs a generic card shadow.
- **Network map:** original SVG with dotted ground, curved edges, domain-colored nodes, and dashed own-agent connections. Keyboard-focusable nodes gain a rust stroke on hover or focus. The orbit uses a (30s linear infinite) rotation.
- **Dialog and toast:** native dialogs use a width of `calc(100% - 32px)`, maximum width (570px), maximum height (90dvh), and an explicit close control. Toasts sit near the bottom and account for the desktop navigation offset.

Buttons and links transition background, color, and border color over (0.16s). Mobile navigation transforms over (0.2s). The reduced-motion query disables animations and transitions and restores automatic scrolling.

## Do's and Don'ts

### Do:

- Do extend the network/ tokens and Chinese/system font fallbacks.
- Do preserve readable signal text, metadata hierarchy, and visible keyboard focus.
- Do keep example status, matching reasons, and conversation origin legible.
- Do collapse the supporting rail before compressing the reading column.

### Don't:

- Don't reuse the legacy campus palette, type system, or world interface for new network screens.
- Don't turn every signal row into a raised card.
- Don't use simulated network activity as a visual claim of real external traffic.
- Don't keep decorative motion running when reduced motion is requested.
