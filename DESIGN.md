---
name: 南京大学苏州校区 · Campus Atlas
description: A spacious, tactile architectural campus model with restrained navigation.
colors:
  background: "#fcfcfb"
  foreground: "#273330"
  primary: "#663849"
  primary-foreground: "#fff"
  muted: "#f0f2ef"
  muted-foreground: "#5e6b61"
  border: "#e3e7e2"
  ring: "#855366"
  selected: "#f0e9ed"
  overlay: "#fcfcfaf2"
  map-ground: "#edf0ea"
  model-brick: "#a4a7a3"
  model-red: "#963e37"
  model-grass: "#87966b"
  model-water: "#527a7d"
typography:
  section-title:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "21px"
    fontWeight: 500
    lineHeight: 1.5
  headline:
    fontFamily: "'Campus Serif', 'Noto Serif SC', 'Songti SC', SimSun, serif"
    fontSize: "26px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: ".03em"
  body:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 400
rounded:
  marker: "5px"
  action: "6px"
  panel: "8px"
  drawer: "10px"
  popover: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "24px"
  map-gutter: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.action}"
    padding: "0 18px"
    height: "42px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "#60725f"
    rounded: "{rounded.panel}"
    padding: "0 10px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "#50644f"
    rounded: "{rounded.marker}"
    size: "35px"
  location-row:
    backgroundColor: "transparent"
    textColor: "#415048"
    rounded: "{rounded.action}"
    padding: "0 12px"
    height: "51px"
  location-row-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.primary}"
    rounded: "{rounded.action}"
    padding: "0 12px"
    height: "51px"
  map-marker:
    backgroundColor: "{colors.overlay}"
    textColor: "#435443"
    rounded: "{rounded.marker}"
    padding: "9px 13px"
  map-marker-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.marker}"
    padding: "9px 13px"
---

# Design System: 南京大学苏州校区 · Campus Atlas

## Overview

**Creative North Star: "Architectural exhibition model"**

The user-pinned direction is simple, spacious and tactile. The later refinement request prioritizes built-campus correspondence and more realistic rendering. The orthographic overview remains, with lower close-scene viewpoints; porcelain interface surfaces and quiet academic typography continue to frame exploration.

This document describes the implemented campus-atlas surface. Runtime React/Three.js was chosen for this build; it establishes no permanent image-first or code-first preference. No approved composition or quality-bar image is recorded. Concept seed 3ab1e5ff ran; the user-pinned aesthetic took precedence.

**Key Characteristics:**

- A continuous architectural model with nine exterior viewpoints.
- Grey masonry, dark red details, wooded terrain and muted water.
- Compact navigation with readable labels and restrained plum selection.

## Colors

Primary plum identifies the wordmark, selected destinations and return action. Porcelain, charcoal and green-grey neutrals keep the interface calm. Model brick, red, grass and water are base material colors; lighting and tone mapping change their rendered appearance. Remaining model materials are in lib/campus-model.ts.

**The Stable Label Rule.** Keep the model caption and modeling note on opaque porcelain backings in close scenes.

## Typography

The locally hosted Campus Serif supplies Chinese headings. System Chinese sans-serif handles controls and descriptions; Helvetica supplies small English labels, and Georgia supplies the typographic NJU mark.

Overview headings use the headline role; selected desktop scene titles increase to 31px. Directory names use 14px, and supporting labels use 12–13px. Descriptions retain generous line spacing.

## Layout

The app occupies 100dvh, with an 82px masthead and 40px footer. The model fills the remaining workspace beside a 274px left directory. The directory becomes 306px at widths of at least 1600px and 238px at widths of at most 1000px. Desktop heights of at most 800px use tighter rows.

At widths of at most 760px, the masthead/footer become 70px/30px and navigation becomes a collapsible bottom drawer, inset 14px horizontally and limited to 62% of workspace height. It closes after selection. Desktop headings, descriptions and features are hidden on phones; the selected name remains in the drawer and breadcrumb. Canvas framing also adapts below 600px.

## Elevation & Depth

The model uses an extruded plinth, photo-referenced building forms, terrain meshes and rounded clustered tree crowns under directional daylight. Building facades use genuinely recessed glazing between masonry piers and spandrels, projecting sills, restrained red trim, four-sided parapets and coping. Slate-grey flat roofs have panel joints; pitched roofs retain a darker tiled finish. The renderer adds a generated sky environment for reflections, localized shadow coverage for close scenes, ambient occlusion on desktop overview and close views, and filtered surface relief for masonry, paving and roof detail. Orthographic projection preserves overview legibility. Soft UI shadows lift markers, controls, the drawer and the information popover; thin borders separate stationary surfaces.

Scene travel lasts 1350ms with a quartic ease-out. Reduced-motion preferences make travel immediate and suppress CSS animation. Manual camera interaction interrupts travel.

## Shapes

Interface corners are gently rounded and compact. Markers combine a rectangular label, a vertical stem and a dot. Model forms combine courtyard blocks, terraces, pitched or folded roofs, curved river edges and irregular wooded terrain.

## Components

- **Directory:** nine destinations—北大楼、图书馆、南雍楼、东区运动场、西区文体中心、仁园与勇园、科创大厦、庄里山、九曲河畔. Hover adds a pale surface and reveals the arrow; selection uses pale plum with primary text and aria-current.
- **Markers:** real buttons projected from model coordinates. Overlapping or offscreen labels are hidden. Selected scenes display their own marker in plum.
- **Camera controls:** drag to orbit, wheel or pinch to zoom, switch between oblique orthographic and top views, and reset. The focused canvas supports arrow keys, plus/minus and Home. Escape, the brand and return controls restore the overview.
- **Scene navigation:** selection updates the URL hash and travels within the shared model. These are exterior viewpoints with orbit and zoom, not interior walkthroughs.
- **Information and recovery:** the map-information popover links the official map and architectural source. Loading and WebGL error states retain the directory; errors offer reload and an official-map link.
- **Accessibility provisions:** native buttons, visible focus outlines, labeled controls, selection announcements and reduced-motion handling are implemented. This is not a complete accessibility audit.
- **Companion:** a masthead entry opens a restrained porcelain sheet with private chat, actual experiences, clearly labeled subjective memories and connection controls. Only the current account's resident is shown on the model; a plum coat identifies the neutral avatar without implying a physical likeness. Its position interpolates only a server-approved journey. “找到他” moves the camera, not the character. Humans share ideas and manage connections; there are no movement controls for the resident.

## Do's and Don'ts

- **Do** preserve the spacious model-first composition and concise navigation.
- **Do** retain the east/west, hill and river relationships when refining geometry.
- **Do** keep source and approximation language visible in the map information.
- **Don't** present modeled heights, facades, vegetation or camera spans as surveyed measurements.
- **Don't** imply indoor access, route guidance or precise real-world navigation.

Horizontal layout now follows the user's standard campus map supplied on 2026-09-09, including building outlines and courtyards, roads, water and hill boundaries. The blue east running track is verified against university photographs; the purple west track is verified against the user's supplied photograph and location identification. The user's architectural visualization image guides material finish, not Suzhou's building shapes. Heights, architectural proportions and unphotographed details remain approximate. The 北大楼 description follows the standard map's 北大楼建筑风貌群 label. See SOURCES.md for reference dates and the boundary between observed features and reconstruction.
