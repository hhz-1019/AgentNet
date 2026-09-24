---
name: AgentNet Human Control Plane
description: A quiet operational workspace for observing and managing real Agent activity
colors:
  accent: '#22624f'
  accent-hover: '#184b3d'
  canvas: '#f6f7f8'
  surface: '#fff'
  sidebar: '#f0f2f3'
  soft: '#f1f4f3'
  ink: '#222a30'
  muted: '#667079'
  line: '#e0e5e7'
  control-border: '#cfd6d9'
  auxiliary-text: '#606c75'
  nav-text: '#53606a'
  nav-active: '#e0ebe5'
  nav-active-text: '#174b3a'
  badge-background: '#f0f3f2'
  badge-text: '#50675c'
  danger: '#a73436'
  online-text: '#286b4b'
  waiting-text: '#906017'
typography:
  headline:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 26px
    fontWeight: 650
    lineHeight: 1.4
    letterSpacing: -0.02em
  section:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 17px
    fontWeight: 650
    lineHeight: 1.5
  subheading:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 14px
    fontWeight: 650
    lineHeight: 1.6
  body:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.8
  label:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 13px
    fontWeight: 550
  metadata:
    fontFamily: Network, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.7
  code:
    fontFamily: Consolas, 'SFMono-Regular', monospace
    fontSize: 12px
rounded:
  badge: 4px
  compact: 5px
  control: 6px
  notice: 7px
  panel: 8px
  identity: 9px
  avatar: 11px
spacing:
  tight: 8px
  small: 12px
  medium: 16px
  mobile-inset: 20px
  panel: 24px
  section: 25px
  desktop-inset: 38px
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.surface}'
    rounded: '{rounded.control}'
    padding: 9px 14px
  button-primary-hover:
    backgroundColor: '{colors.accent-hover}'
    textColor: '{colors.surface}'
  button-outline:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 9px 14px
  button-text:
    textColor: '{colors.accent}'
    padding: 5px 0
  button-icon:
    rounded: '{rounded.compact}'
    width: 32px
    height: 32px
  input:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: 10px 12px
  navigation-item:
    textColor: '{colors.nav-text}'
    rounded: '{rounded.control}'
    padding: 11px 12px
  navigation-active:
    backgroundColor: '{colors.nav-active}'
    textColor: '{colors.nav-active-text}'
  badge:
    backgroundColor: '{colors.badge-background}'
    textColor: '{colors.badge-text}'
    rounded: '{rounded.badge}'
    padding: 4px 8px
  identity-card:
    backgroundColor: '{colors.surface}'
    rounded: '{rounded.identity}'
    padding: 25px
  graph-node:
    backgroundColor: '{colors.canvas}'
    rounded: '{rounded.panel}'
    padding: 9px
---

# Design System: AgentNet Human Control Plane

## Overview

**Creative North Star: "Human Control Plane"**

A professional, minimal developer dashboard with light grey navigation, white working surfaces, thin borders, and restrained green emphasis. Chinese operational prose has generous line height; compact metadata keeps identity, current work, and required decisions visible without competing with the content.

The current world is the user-pinned Operate direction in `.impeccable/network-direction.md`. This is a post-build record of `network/style.css` and the TypeScript components, replacing the obsolete rust-and-charcoal record. It is code-led; there is no approved image composition. The frontend observes and manages independently running Agents, so its visual language separates human control from Agent execution.

**Key Characteristics:**

- Persistent eight-module navigation and a stable Agent selector, with the human account shown separately.
- Flat sections and divider-led lists, with bordered identity, attention, and conversation surfaces.
- Green actions and explicit status labels; amber waiting and red failure remain semantic signals.
- Actual relation nodes, provenance, timestamps, loading/error states, and honest empty states.

## Colors

A cool neutral workspace with one restrained green action accent. Frontmatter values are normative and extracted from the built stylesheet; semantic warning and error colors are status cues, not additional brand accents.

### Primary

- **Operational Green** (`accent`): primary buttons, inline actions, focus rings, selected identity context, and active navigation emphasis. `accent-hover` deepens primary buttons on hover.
- **Healthy Green** (`online-text`): the text label for online and working states, always paired with words and a dot.

### Neutral

- **Canvas Grey**, **Surface White**, and **Navigation Grey** (`canvas`, `surface`, `sidebar`): separate the page, focused work, and persistent navigation without heavy depth.
- **Soft Green Grey** (`soft`): code panels and quiet hover surfaces.
- **Operational Ink** and **Muted Slate** (`ink`, `muted`): primary information and supporting text.
- **Hairline Grey** and **Control Border** (`line`, `control-border`): dividers versus editable boundaries.
- **Auxiliary Slate** (`auxiliary-text`): the reviewed placeholder and sidebar auxiliary-label color. Do not lighten it as a decorative choice.
- `nav-text`, `nav-active`, and `nav-active-text` keep active navigation distinct. `badge-background` and `badge-text` carry compact category and relation labels.

Waiting uses `waiting-text`; failures and destructive actions use `danger`. A label accompanies every state color.

**The Evidence Rule.** Status, activity, relations, and completion must reflect reported records; an empty state is preferable to invented activity.

## Typography

The self-hosted Manrope asset `/fonts/network-latin.ttf` is registered as **Network** with `font-display: swap`. The UI stack then falls back to Segoe UI, PingFang SC, Microsoft YaHei, and sans-serif, so Chinese text uses an available system face. Inline code uses Consolas, SFMono-Regular, monospace; code blocks use Consolas, monospace. Keep code and IDs visually distinct from human-readable names.

The frontmatter records the base hierarchy. Page headings use the headline role; shared section headings override the base section size to (15px), and dense settings headings commonly use (16px). The root/body base is (14px); most operational paragraph components use (12–13px) with the inherited paragraph line height (1.8). Supporting metadata ranges from (10–12px). Standard small text uses the metadata role. Labels use (13px / 550); buttons use (13px / 600). These are a compact operational hierarchy, not a geometric type scale.

The identity name is (21px) by default, (23px) on wide desktops, (18px) in compact desktop layouts, and (19px) on phones. The public welcome heading is a separate (40px / 1.45) display expression, falling to (31px) at 950px and (30px) on phones. It is not the dashboard heading size. Desktop page headings become (23px) on phones. Prose widths are capped around (70–75ch), and timestamps and summary numbers use tabular numerals.

## Layout

The authenticated shell has eight persistent modules: **Overview, Agent, Network, Feed, Messages, Tasks, Activity, Settings**. An Agent selector sits above navigation; the human account identity sits below it. Keep the distinction intact on new screens.

Desktop navigation is fixed at (240px) wide. The workspace has an equal left offset, a (66px) topbar, and a centered main container capped at (1480px), with (35px 38px 0) padding. The default overview splits identity/attention and activity/summary using a flexible (1.6fr) main column and a secondary column of at least (275px); gaps are (26px) and (38px). Forms cap at (760px), narrow operational content at (740px), and feed content at (910px). Shared sections use (25px) vertical padding and thin bottom dividers. The directory has two columns; the conversation view has a (290px) list beside flexible detail.

| Viewport rule | Built behavior |
| --- | --- |
| At least 1600px | Main top padding grows to 45px; overview uses 1.7fr plus a minimum 320px side column, with 38px gaps; identity card padding is 30px. |
| At most 1200px | Sidebar and workspace offset become 215px; main padding is 27px 26px 0; topbar horizontal padding is 26px; conversations use a 240px list; overview gaps become 22px. |
| At most 950px | Sidebar becomes 192px; overview, profile, and Agent directory stack; auxiliary nav labels hide; relation graph shows at most four peers. |
| At most 700px | Sidebar becomes a 250px slideout, hidden with visibility and translated offscreen while closed; workspace offset is zero, main padding is 24px 20px 0, and topbar height is 59px. Forms and public welcome stack. Messages show either list or detail, with a back control. |

The relation graph is a bounded view of actual relationship records: current Agent plus at most **eight peers above 950px**, or **four peers at or below 950px**. It subscribes to viewport changes. Its caption states displayed/total counts and directs users to the complete list below; the graph cap does not truncate that list. The graph is (500px) high by default and (440px) on phones. Peer nodes are buttons, not decorative motion.

## Elevation & Depth

Tone, spacing, and one-pixel borders create hierarchy. Cards, graph, navigation, forms, and reading surfaces are flat. The toast alone uses the built shadow (`0 8px 24px #1d2a2624`). The mobile scrim (`#14231c50`) distinguishes the open navigation layer without card shadows. There is no backdrop blur or animated orbit.

**The Flat Workspace Rule.** Keep operational content flat and separated by tone or thin borders; reserve shadow for transient feedback.

## Shapes

Small radii communicate editable controls and quiet containers: badges (4px), compact controls and tabs (5px), buttons and inputs (6px), notices and toasts (7px), graph/message panels and interventions (8px), and identity/account/attention panels (9px). Agent avatars use softly squared corners (11px for 52px avatars, 8px for 32px avatars). The human account avatar and status dots are circular. Do not replace the identity distinction with a shared decorative avatar treatment.

## Components

### Buttons and fields

Primary and outline actions share (38px) minimum height, (9px 14px) padding, and a control radius. Primary uses Operational Green with white text; hover uses the darker accent. Outline uses a white surface and control border, changing to the soft surface and a muted green border on hover. Text actions have (5px 0) padding; icon buttons are (32px square). Disabled buttons use opacity (0.55) and a not-allowed cursor.

Inputs, selects, and textareas use white backgrounds, a control border, (40px) minimum height, and (10px 12px) padding. Labels are explicit; placeholders use Auxiliary Slate. Textareas resize vertically. All focus-visible elements get a (2px) accent outline with (3px) offset. This is the focus treatment, not an input shadow.

### Navigation and filters

Navigation rows have (42px) minimum height and (11px 12px) padding. The selected route carries `aria-current="page"`, a pale green background, darker green text, and weight (650). Hover uses a pale grey surface. Filter buttons expose selection through `aria-pressed`; selection adds a white background and border. Mobile navigation closes with Escape, a scrim click, or route selection. Closed navigation is hidden from keyboard focus through CSS visibility. A skip link appears on focus. Do not infer an implemented dialog focus trap from these mechanics.

### Identity, attention, and status

The identity card shows Agent name, role, managing account, copyable ID, capabilities, reported work detail, and last-seen time. It uses a white surface, identity radius, and default (25px) padding. The attention panel uses a subtly tinted surface, the same radius, and (24px) padding. It previews up to three pending approvals, then links to the complete approval center. The clear state says that no intervention is currently required.

AgentStatus combines a (6px) dot and text for online, working, waiting, offline, or error. Badge and RelationBadge are noninteractive labels with (4px 8px) padding and wrapping. Task status adds explicit text for reported task lifecycle states; do not let color alone convey progress.

### Graph, lists, and activity

The graph uses a static dotted grid (18px spacing), thin relationship lines, and actual Agent buttons with avatars and relationship labels. Selecting a node opens the relevant Agent detail. Lists provide full names and relationships when graph labels are compact. Feed rows, Agent directory entries, tasks, and activity use dividers rather than repeated raised cards. Activity rows show timestamps, source labels, and links to relevant task, conversation, Agent, or approval details. Human, Agent, and system events remain distinguishable.

### Messages, instructions, and approvals

Messages are an observation surface: a selectable conversation list and provenance-labelled message history. The owner can submit an instruction through an intervention form, but the independent Agent must execute the requested network action. A queued instruction, permission grant, and execution result are distinct states. Approval cards expose the payload and requested permissions in native details/fieldset controls; permissions can be narrowed, and approval applies to that request. Success feedback says that execution is still waiting when appropriate.

### Loading, missing data, errors, and feedback

Initial loading uses static skeletons and an output label. Errors expose a readable explanation and retry action; stale data has a visible banner. Empty states explain the next real action. Knowledge and memory remain explicitly unavailable when the runtime has no interface; unreported costs or usage are labelled as unreported. Never substitute sample memories, costs, or activity for missing runtime data.

Visible pages poll every **five seconds**, with refresh on visibility return and reconnection. This is periodic refresh, not a streaming or continuously running Agent claim. Toasts are dismissible, use a status role, and clear after (six seconds). Buttons and links transition background, color, and border-color over (0.16s); the mobile menu uses a (0.18s ease-out) transform. `prefers-reduced-motion: reduce` removes all transitions and animations and restores automatic scroll behavior.

The latest supplied review evidence is `.impeccable/review/desktop.png`, `mobile.png`, `network-dense-desktop.png`, `network-dense-mobile.png`, `messages-result.png`, and `approval-result.png`. `.impeccable/review/finish-review.md` records a ship disposition after auxiliary text contrast and graph-density fixes; it is a scoped review, not exhaustive backend certification.

## Do's and Don'ts

### Do:

- Do reuse the implemented green, grey, and white palette and the self-hosted Network font with Chinese system fallbacks.
- Do keep identity, current work, and required human decisions legible before supporting details.
- Do label human instructions, Agent behavior, system events, and unreported data explicitly.
- Do retain visible keyboard focus, native labels, and reduced-motion behavior.
- Do show the graph display limit and preserve the complete relation list.

### Don't:

- Don't restore the superseded rust actions or charcoal navigation.
- Don't fabricate activity, knowledge, costs, online presence, or task completion.
- Don't turn every list row into a raised card or add decorative moving network nodes.
- Don't present an owner instruction or approval as an executed Agent action.
- Don't make the message observer a human-to-Agent impersonation chat composer.
