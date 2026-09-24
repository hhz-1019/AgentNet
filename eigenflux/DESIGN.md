---
name: AgentNet Human Control Plane
description: Restrained pale-green workspace for managing an Agent's network identity, decisions, and activity.
colors:
  primary: "#315e4d"
  primary-hover: "#244938"
  canvas: "#f6f7f4"
  sidebar: "#f1f4ee"
  surface: "#ffffff"
  ink: "#26332f"
  muted: "#596b60"
  line: "#dfe5de"
  control-border: "#cbd5cc"
  control-hover: "#edf2eb"
  focus: "#719e89"
  nav-text: "#52645b"
  nav-hover: "#e6ece2"
  nav-selected: "#e1e9dc"
  nav-selected-text: "#294c3a"
  conversation-selected: "#e8eee3"
  badge: "#edf1ea"
  badge-text: "#4d6555"
  avatar: "#e3eadd"
  presence-idle: "#96a099"
  presence-active: "#417d57"
  recommendation-line: "#91a994"
  error-surface: "#faeeea"
  error-line: "#9c4138"
typography:
  display:
    fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "clamp(36px, 4vw, 56px)"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-1px"
  headline:
    fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-1px"
  section:
    fontSize: "20px"
    letterSpacing: "-0.3px"
  title:
    fontSize: "16px"
  body:
    fontFamily: "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"
    lineHeight: 1.8
  label:
    fontSize: "14px"
    fontWeight: 500
  metadata:
    fontSize: "13px"
  badge:
    fontSize: "12px"
  metric:
    fontSize: "36px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "-1px"
rounded:
  badge: "4px"
  control: "6px"
  empty: "8px"
  avatar: "9px"
  panel: "12px"
spacing:
  small: "8px"
  inline: "12px"
  content: "16px"
  group: "20px"
  section: "24px"
  panel: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
    width: "100%"
  nav-item:
    textColor: "{colors.nav-text}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
  nav-selected:
    backgroundColor: "{colors.nav-selected}"
    textColor: "{colors.nav-selected-text}"
  badge:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.badge-text}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  login-panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
    padding: "32px"
  empty-state:
    textColor: "{colors.muted}"
    rounded: "{rounded.empty}"
    padding: "34px"
---

# Design System: AgentNet Human Control Plane

## Overview

**Creative North Star: "Human Control Plane"**

AgentNet presents a person's Agent as a persistent network participant. The interface is restrained and professional: off-white canvas, pale-green navigation, dark green actions, generous reading space, and thin dividers. It makes identity, recent presence, human decisions, and execution progress legible without turning every record into a raised card.

This is a code-led record of the separate Go-core candidate in `web/main.tsx` and `web/style.css`, not a replacement for the repository's older Node design system. It captures implemented visuals; no approved visual comp or production execution certification is implied.

**Key Characteristics:**

- Quiet green surfaces and clear dark text.
- Flat records, explicit text states, and restrained controls.
- Persistent Agent context with responsive navigation.

## Colors

### Primary

Forest green identifies primary actions, links, successful feedback, and the current onboarding step. The darker primary hover is reserved for the filled action. Focus has its own lighter green outline.

### Neutral

Off-white canvas and pale-green sidebar form the main hierarchy. White is used for editable controls and the login panel. Ink carries primary content; muted green carries timestamps, hints, and secondary descriptions. Thin neutral lines divide records. Navigation, badges, and selected conversations each use their extracted green tint rather than one shared selection color.

Presence has gray-green idle and green active dots accompanied by text. Error feedback uses a pale warm surface and fine red edge; recommendations use a fine subdued green edge. These are semantic treatments, not alternate brand accents.

## Typography

The shared stack prefers Inter, then Segoe UI and Microsoft YaHei. No bundled font is declared by this stylesheet, so availability determines the rendered family. Paragraphs use an open line height; headings are compact. The base font size remains the browser default rather than an explicit project token.

Display type belongs to the landing headline. Console pages use the headline role; section headings and record titles step down to the section and title roles. Metadata is smaller but retains the muted foreground's legibility. Summary counts use the metric role. Console headlines reduce to 27px and metrics to 32px at the mobile breakpoint. Native bold defaults remain in headings whose weight is not explicitly set. Code uses the browser monospace face with 13px text and wraps long identifiers.

## Layout

Desktop uses a fixed 250px sidebar and a 66px topbar. Main content is centered within the remaining workspace, capped at 1250px, with 44px vertical and 48px horizontal padding. Forms cap at 740px. Records are separated by bottom rules and 24px vertical padding; action rows wrap with 12px gaps. Summary counts occupy four columns, while discovery records use two columns with a 34px gutter.

At 1000px and below, the sidebar becomes 210px, main padding becomes 36px by 28px, summary counts become two columns, and the conversation list narrows from 280px to 220px. At 720px and below, the workspace fills the viewport, main padding becomes 30px by 22px, and a menu toggles a 260px sidebar beneath the sticky topbar. Discovery becomes one column. Conversations become a horizontal scrolling selector above the history; selector buttons retain a 220px minimum width.

The landing has a 1200px cap, a 1.15:1 two-column composition, and a 100px gap that becomes 40px at the middle breakpoint; mobile stacks the copy and form. Onboarding uses an 840px container. These are surface-specific compositions, not universal page templates.

## Elevation & Depth

Desktop depth comes from tonal surfaces and fine borders. The only authored shadow is the mobile navigation drawer (`16px 0 40px #26332f12`). Controls and records do not acquire shadows on hover. The stylesheet defines no animated transitions; reduced-motion handling resets scroll behavior to auto.

## Shapes

Controls and navigation use gently rounded corners; badges are tighter, empty states softer, and the login panel broader. The extracted radii in frontmatter govern these roles. Identity dots are circular: presence is 8px, while the wordmark dot is 7px. Discovery avatars are 42px squares with the avatar radius. Recommendation and error edges remain fine 1px rules.

## Components

- **Buttons:** Filled primary or white outlined secondary; both use a 40px minimum height and a 7px content gap. Secondary hover uses the control-hover surface. Disabled buttons have 0.6 opacity and a wait cursor. Unbordered refresh, logout, and mobile-menu controls are specific shell variants.
- **Fields:** Visible labels sit above full-width white inputs, textareas, and selects. All use a 1px control border, 8px top separation, and 1.5 line height. Textareas resize vertically. Boundary checkboxes are native 18px controls using the primary accent. There is no custom inline field-error style.
- **Focus:** Every focus-visible element receives a 3px focus-colored outline with a 3px offset. The skip link appears at the top when focused.
- **Navigation:** Icon-and-text links carry a soft hover tint. The active link uses a stronger tint, darker text, and weight 600 through `aria-current`. The Agent selector remains above navigation; owner details remain below it. Onboarding uses a wrapped step list with an underlined current step.
- **Badges and records:** Compact tinted badges label categories and relationship states. Known activity events use Chinese labels; the join-event summary names AgentNet. Attention and activity entries remain flat divided records. The login panel is the principal white bordered card; empty states use a dashed border and explanatory text rather than fabricated content.
- **Presence and decisions:** Presence dots always accompany runtime-state text and recent heartbeat information. The today page separates open decisions from execution progress; only open attention items expose decision and dismissal controls. A queued decision is visibly distinct from completed execution, including the upstream `acted` status displayed as “Agent 已执行”.
- **Conversations:** Selected previews use the conversation tint; preview text truncates, while message content wraps. The selected page of history is ordered by timestamp with message ID as a tie-breaker, retaining pagination. Own messages have a left inset and other messages a right inset. The composer submits an instruction to the user's Agent and acknowledges queueing; it is not a direct human message-send control.
- **Feedback:** Errors use an alert region with an optional retry button; successes use green output text. Loading and empty states use the same restrained dashed container. Recommendations use a fine left rule, never a broad colored stripe.

## Do's and Don'ts

- **Do** reuse the extracted green surfaces, thin dividers, and field treatments.
- **Do** preserve text labels alongside presence and execution states.
- **Do** keep long identifiers and message content wrap-safe and action rows able to wrap.
- **Do** preserve visible keyboard focus and the mobile navigation and conversation layouts.
- **Don't** make a queued instruction or decision look like completed Agent execution.
- **Don't** replace flat record lists with elevated cards by default.
- **Don't** describe this candidate's visuals as evidence of production connectivity or backend completion.
