# Data-to-Action Integrity
## Production UI/UX and Frontend Specification

**Document status:** Final build recommendation  
**Product:** Data-to-Action Integrity — Autonomous Action Safety and Recovery Agent  
**Experience direction:** Steel blueprint at midnight  
**Application type:** Multi-page enterprise operations product  
**Research date:** 27 October 2026  
**Primary audience:** Product design, frontend engineering, solution architecture, demo engineering

---

## 1. Executive decision

Build a **multi-page, desktop-first operations application**, not a one-screen analytics dashboard.

Use this frontend system:

1. **Next.js App Router + TypeScript + Tailwind CSS v4** for the application foundation.
2. **shadcn/ui with the Base UI primitive base** for the owned production component layer.
3. **Base UI directly only when a required primitive is not yet exposed by shadcn/ui.**
4. **TanStack Table** for operational queues and evidence tables.
5. **React Flow** for the evidence and impact graph.
6. **Magic UI selectively** for a live event list and one or two restrained status transitions.
7. **Aceternity UI selectively** on the public product introduction and guided onboarding—not inside high-density decision surfaces.
8. **Do not install Mantine components or daisyUI in the production application.** They are capable libraries, but they would introduce a second component/theming language and weaken visual and interaction consistency.

This is not a compromise stack. It is a deliberately narrow system in which every dependency has one job.

> **Final library choice:** shadcn/ui is the product layer; Base UI is its accessible primitive foundation; Magic UI and Aceternity UI are optional, source-owned accent components; Mantine and daisyUI are excluded.

---

## 2. Why this is the best fit

The application is a safety-and-recovery control plane. Its most important screens are queues, investigations, evidence comparisons, approvals, recovery execution and verification. Those workflows require:

- strong keyboard and focus behavior;
- high information density without visual noise;
- complete control over status semantics;
- auditable, predictable interactions;
- source ownership for security and long-term maintenance;
- a design system that can express the supplied industrial visual language;
- motion that communicates state change rather than decorates the product.

shadcn/ui describes itself as a foundation for an owned design system rather than a conventional packaged component library, and recommends CSS variables for theming. Its current component bases include Base UI, React Aria and Radix; **Base UI is the current default**. This gives the project styled, source-owned components and one coherent accessible primitive layer instead of two competing systems. [shadcn/ui](https://ui.shadcn.com/), [shadcn/ui component-base update](https://ui.shadcn.com/docs/changelog/2026-07-react-aria), [shadcn/ui theming configuration](https://ui.shadcn.com/docs/components-json)

Base UI is unstyled, bundles no CSS, does not prescribe a styling solution, and is explicitly intended for accessible design systems. That makes it compatible with the custom “steel blueprint at midnight” language. [Base UI overview](https://base-ui.com/react/overview/about), [Base UI quick start](https://base-ui.com/react/overview/quick-start)

---

## 3. Library decision matrix

| Library | Strength | Fit for this product | Decision |
|---|---|---:|---|
| **shadcn/ui** | Source-owned, composable components; Tailwind and CSS-variable theming | Excellent for a custom enterprise design system and dense workflow UI | **Primary component layer** |
| **Base UI** | Unstyled accessible React primitives with no bundled CSS | Excellent foundation for custom behavior and appearance | **Use as the shadcn primitive base; direct use by exception** |
| **Magic UI** | Open-source React/TypeScript/Tailwind/Motion effects positioned as a shadcn companion | Useful for a few non-critical transitions and event-stream moments | **Selective use; copy source into the app** |
| **Aceternity UI** | React/Tailwind/Motion components primarily positioned for landing pages | Strong for the public product story and onboarding, excessive for operator screens | **Public pages only; at most 2–3 adapted components** |
| **Mantine** | Large, mature component and hooks system with its own provider and Styles API | Technically strong, but duplicates the chosen component/theming system | **Do not use components; reconsider only if requirements change materially** |
| **daisyUI** | Pure-CSS Tailwind component classes, semantic colors and themes | Fast for prototypes, but adds a second semantic class and theme system | **Do not use in the product** |

Official product positioning supports these boundaries: Mantine offers more than 120 components and a full styling system; daisyUI adds semantic component classes and a CSS-variable theme layer; Aceternity is explicitly centered on animated landing pages; Magic UI describes itself as a companion to shadcn/ui. [Mantine](https://mantine.dev/), [daisyUI](https://daisyui.com/), [Aceternity UI](https://ui.aceternity.com/), [Magic UI](https://magicui.design/)

### Dependency rule

No page may mix visual components from multiple full component systems.

- `components/ui/*` is the only primitive/component import surface used by feature code.
- shadcn-generated Base UI components live in `components/ui/*`.
- adapted Magic UI or Aceternity components live in `components/accent/*` and must consume the same tokens.
- direct imports from `@base-ui/react` are allowed only inside `components/ui/*`.
- imports from Mantine and daisyUI are prohibited.
- no component may introduce a second radius, typography scale, shadow system or color vocabulary.

---

## 4. Product experience principle

The product should feel like an **evidence-led control room**, not a monitoring wall.

The interface must help an operator answer five questions in order:

1. **What consequential action is exposed?**
2. **Why does the supporting evidence appear unreliable?**
3. **What is currently contained or already affected?**
4. **Who must decide, and what may they safely do?**
5. **Was the intended business state actually restored?**

Every primary page should advance one of those questions. Metrics support the workflow; they do not replace it.

### UX tenets

- **Evidence before recommendation.** Show source records and conflicts before generated explanation.
- **Business state before system state.** “API succeeded” is not equivalent to “customer outcome restored.”
- **One consequential action per surface.** Signal Red marks the next important action, not general emphasis.
- **Explicit uncertainty.** Missing, stale and contradictory evidence must be distinguishable.
- **Human accountability.** Approver identity, decision basis and timestamp remain visible.
- **Reversible by design.** Recovery UI displays scope, idempotency key, preview and verification plan.
- **Progressive disclosure.** Overview, queue, case and evidence-detail pages have different levels of density.
- **No chat-first design.** An assistant may explain or request evidence, but the case record is the primary interface.

---

## 5. Information architecture

```text
Public
├── Product introduction                 /
├── Security and operating model         /trust
└── Sign in                              /login

Authenticated application
├── Overview                             /app/overview
├── Action Queue                         /app/actions
│   └── Action detail                    /app/actions/[actionId]
├── Investigations                       /app/investigations
│   └── Investigation workspace          /app/investigations/[caseId]
├── Evidence Explorer                    /app/evidence
├── Recoveries                           /app/recoveries
│   └── Recovery run                     /app/recoveries/[runId]
├── Verification                         /app/verification
├── Policies                             /app/policies
│   └── Policy detail and simulation     /app/policies/[policyId]
├── Integrations                         /app/integrations
│   └── Integration detail               /app/integrations/[integrationId]
├── Audit                                /app/audit
├── Analytics                            /app/analytics
└── Administration                       /app/settings
    ├── Access and roles                 /app/settings/access
    ├── Approval matrix                  /app/settings/approvals
    └── Notifications                    /app/settings/notifications
```

### Primary navigation groups

| Group | Destinations | Operator intent |
|---|---|---|
| **Monitor** | Overview, Action Queue | See exposure and intervene quickly |
| **Investigate** | Investigations, Evidence Explorer | Establish what is true and what is affected |
| **Resolve** | Recoveries, Verification | Correct and prove the business outcome |
| **Control** | Policies, Integrations, Audit | Configure deterministic boundaries and inspect history |
| **Improve** | Analytics | Measure false blocks, recovery quality and recurring patterns |

Do not place every destination in a single horizontal top bar. Use a persistent left navigation rail and a narrow utility bar.

---

## 6. Application shell

### Desktop shell

- **Left rail:** 248px expanded, 72px collapsed.
- **Top utility bar:** 56px; workspace switcher, environment, global search, notifications and user menu.
- **Main content:** fluid from 1024px upward; 24px page gutters at 1024–1279, 32px at 1280–1599, 40px at 1600+.
- **Content maximum:** 1600px for overview and form pages; queue and graph pages may use the full available width.
- **Context rail:** optional 360px right rail on action, investigation, recovery and verification details.
- **Page header:** breadcrumb, title, compact metadata, then one primary action and optional overflow menu.

The supplied 1200px maximum remains appropriate for public/marketing pages. It is too narrow as a universal constraint for an operational table and evidence graph.

### Responsive behavior

- **1440px and above:** full rail, content and context rail.
- **1024–1439px:** collapsible rail; context rail becomes a sheet.
- **768–1023px:** read/triage layout; dense tables become prioritized cards; graph opens full screen.
- **Below 768px:** limited companion mode for alerts, status checks and approval review. Policy editing, evidence graph manipulation and recovery execution are desktop-only.

### Global facilities

- Command menu: `Ctrl/Cmd + K`.
- Global search across action IDs, account IDs, cases, policies and recovery runs.
- Environment indicator: `DEMO`, `SANDBOX`, `PRODUCTION`—never color alone.
- Persistent “data as of” timestamp on overview and analytics pages.
- Saved views for queues.
- Deep links preserve filters and selected evidence.

---

## 7. Page-by-page specification

### 7.1 Public product introduction — `/`

**Purpose:** Explain the product loop and establish trust; this is not the operational dashboard.

Sections:

1. Hero: “Stop bad data before it becomes a bad business action.”
2. Animated but restrained loop: Detect → Hold → Investigate → Decide → Recover → Verify.
3. Before/after customer-entitlement scenario.
4. Deterministic controls versus agentic reasoning.
5. Audit and human-approval proof.
6. CTA: “Open sandbox” or “Request a controlled pilot.”

Use one adapted Aceternity background/grid treatment and one Magic UI animation at most. Remove glows, large blur fields, infinite marquees and gradient buttons. The public page may be expressive; the authenticated console must remain quiet.

### 7.2 Overview — `/app/overview`

**Purpose:** Show operational posture and route the user to work—not display every metric.

Blocks:

- Current posture strip: actions held, cases awaiting decision, recoveries failing verification.
- “Needs attention now” ranked list.
- Action-flow summary for the last 24 hours.
- Recent integrity signals with source and freshness.
- Recovery verification trend.
- System and integration health summary.

Primary action: **Review highest-risk action**.

Avoid a generic twelve-card KPI grid. Use one posture band, one work list and two supporting analysis panels.

### 7.3 Action Queue — `/app/actions`

**Purpose:** Triage pending, held, released, blocked and already-executed actions.

Default columns:

- risk/state;
- proposed action;
- business object/customer;
- integrity reason;
- impact scope;
- policy gate;
- owner;
- age/SLA;
- next step.

Facilities:

- server-side filter, sort and pagination;
- saved views: `Held`, `Evidence missing`, `Approval due`, `Already executed`, `My queue`;
- bulk operations limited to assignment, evidence request and export—never bulk approve or compensate;
- keyboard row navigation;
- column visibility and density control;
- row selection persists across pagination only when explicitly enabled.

Use TanStack Table because its headless model allows the project to own table markup and styling rather than fight a pre-themed data grid. [TanStack Table overview](https://tanstack.com/table/latest/docs/overview)

### 7.4 Action detail — `/app/actions/[actionId]`

**Purpose:** Explain why one action is allowed, held or blocked.

Layout:

- Header: state, action ID, proposed change and deadline.
- Before/after state diff.
- Policy gates and deterministic check results.
- Evidence summary grouped by `supports`, `contradicts`, `missing`, `stale`.
- Impact preview.
- Agent recommendation with confidence wording and citations.
- Right context rail: ownership, approval requirement, action history.

Primary action varies by state: **Open investigation**, **Request evidence**, **Submit for approval** or **Release action**.

Never show “Approve” until required evidence, impact scope and verification plan are visible in the same review flow.

### 7.5 Investigations — `/app/investigations`

**Purpose:** Manage long-running evidence conflicts and accountability.

Views:

- active cases;
- waiting for evidence;
- waiting for owner;
- waiting for approval;
- reopened after failed verification;
- resolved.

Each case row exposes hypothesis count, unresolved conflicts, affected actions, responsible owner and SLA.

### 7.6 Investigation workspace — `/app/investigations/[caseId]`

**Purpose:** The core product experience. Establish a defensible disposition.

Use a three-zone layout:

1. **Case spine (left/center):** events, evidence arrivals, hypothesis revisions and decisions.
2. **Evidence workbench (center):** record comparison, lineage, semantic definition and source freshness.
3. **Decision rail (right):** recommendation, unresolved uncertainty, policy boundary and next permitted actions.

Tabs within the workspace:

- Summary
- Evidence
- Impact
- Hypotheses
- Collaboration
- Decision record

Required interactions:

- pin evidence into the decision record;
- compare two records side by side;
- mark evidence as authoritative only with source and reason;
- request missing evidence from a named owner;
- view how the agent’s recommendation changed after each evidence event;
- preview the exact release or compensation payload;
- preserve reviewer edits and disagreement.

Do not render a chatbot as the main workspace. “Ask about this case” may appear as a contextual tool, but its output must link back to evidence objects.

### 7.7 Evidence Explorer — `/app/evidence`

**Purpose:** Inspect relationships among sources, semantic contracts, actions, customers and downstream effects.

Use React Flow for the node-and-edge canvas; it is designed for customizable node-based interfaces and interactive diagrams. [React Flow](https://reactflow.dev/), [custom nodes](https://reactflow.dev/learn/customization/custom-nodes)

Node types:

- source system;
- dataset/record;
- semantic contract;
- policy gate;
- proposed/executed action;
- target business state;
- verification observation.

Edge types:

- derived from;
- conflicts with;
- authorized by;
- triggered;
- compensated by;
- verified by.

The graph is an investigation tool, not a decorative lineage map. Selecting a node opens its evidence record, freshness, ownership and related case links. Provide an accessible list/table alternative to the graph.

### 7.8 Recoveries — `/app/recoveries`

**Purpose:** Track approved compensating actions and their safety boundaries.

Each recovery displays:

- original harmful action;
- approved compensating action;
- affected objects;
- approver;
- idempotency key;
- dry-run result;
- execution state;
- verification state;
- rollback/refusal reason when applicable.

Primary action: **Review recovery plan**. Execution must occur only in a confirmation flow that repeats scope, target environment and verification plan.

### 7.9 Recovery run — `/app/recoveries/[runId]`

Steps:

1. Scope locked
2. Policy checks complete
3. Approval recorded
4. Compensation executed
5. Target state observed
6. Downstream reconciliation complete
7. Case closed

Use the industrial step indicator from the supplied reference. A failed verification does not mark the run complete, even when the write API returned success.

### 7.10 Verification — `/app/verification`

**Purpose:** Make business-state closure a separate operational queue.

Views:

- awaiting observation window;
- target state mismatch;
- downstream mismatch;
- duplicate action suspected;
- ready to close;
- reopened.

Show expected state, observed state, observation time, source and reconciliation checks. This page is essential to the product’s differentiation.

### 7.11 Policies — `/app/policies`

**Purpose:** Configure deterministic safety boundaries.

Policies cover:

- allowed action types;
- hold conditions;
- evidence requirements;
- approval thresholds;
- impact limits;
- compensation eligibility;
- mandatory verification checks;
- escalation deadlines.

The detail page includes a versioned editor, human-readable summary, test fixtures and simulation results. Publishing a policy is a separate, permissioned action. AI may explain a policy but cannot silently modify or publish it.

### 7.12 Integrations — `/app/integrations`

**Purpose:** Connect evidence sources, action gateways, target systems and notification channels.

Display capability rather than vendor logo alone:

- `READ EVIDENCE`
- `HOLD ACTION`
- `EXECUTE COMPENSATION`
- `VERIFY STATE`
- `NOTIFY OWNER`

The integration detail page shows scopes, last successful read/write, webhook or polling lag, test controls and recent failures.

### 7.13 Audit — `/app/audit`

**Purpose:** Provide a chronological, exportable record of evidence, recommendations, human decisions, policy versions and tool actions.

Features:

- immutable event list;
- filters by case, actor, action, policy and time;
- before/after payload diff;
- evidence citation links;
- decision rationale;
- model/tool/version metadata where applicable;
- export with checksum and generated-at timestamp.

### 7.14 Analytics — `/app/analytics`

**Purpose:** Improve system performance without turning operations into a vanity dashboard.

Sections:

- unsafe actions prevented;
- false-block rate;
- time to authoritative evidence;
- reviewer reversal rate;
- compensation success rate;
- verified-closure rate;
- repeat integrity patterns;
- business impact estimates with stated methodology.

Every metric must link to its underlying case population and filter definition.

### 7.15 Settings and access — `/app/settings/*`

Include organization, environments, roles, approval matrix, notifications, retention and API credentials. Use progressive disclosure and separate security-sensitive operations from everyday preferences.

---

## 8. Core workflow and state model

```text
PROPOSED
   ↓
EVALUATING
   ├──→ ALLOWED → EXECUTED → VERIFYING → VERIFIED
   ├──→ HELD → INVESTIGATING → AWAITING_EVIDENCE
   │                         └→ AWAITING_APPROVAL
   │                              ├→ RELEASED → EXECUTED → VERIFYING
   │                              └→ BLOCKED
   └──→ ALREADY_EXECUTED → RECOVERY_PLANNED → APPROVED
                                      ↓
                                 COMPENSATING
                                      ↓
                                  VERIFYING
                                  ├→ VERIFIED → CLOSED
                                  └→ MISMATCH → REOPENED
```

### User-facing state labels

| System state | UI label | Meaning | Primary next step |
|---|---|---|---|
| `HELD` | Held | Outbound action is contained | Review evidence |
| `AWAITING_EVIDENCE` | Evidence needed | A decision cannot be made safely | Request/attach evidence |
| `AWAITING_APPROVAL` | Approval required | Evidence and recommendation are ready | Review decision packet |
| `BLOCKED` | Blocked | Policy prohibits execution | Resolve source or close |
| `RELEASED` | Released | Approved action may proceed | Observe execution |
| `RECOVERY_PLANNED` | Recovery proposed | Compensating action is prepared | Review plan |
| `COMPENSATING` | Recovery running | Approved correction is executing | Monitor run |
| `VERIFYING` | Verifying outcome | Awaiting business-state proof | Review observations |
| `MISMATCH` | Verification failed | Intended state was not observed | Reopen/escalate |
| `VERIFIED` | Outcome verified | Target and downstream state match | Close case |

Do not encode state through color alone. Every state needs an icon, label and concise explanation.

---

## 9. Design system

### 9.1 Visual character

The supplied reference is appropriate, with one adaptation: the public experience may use cinematic industrial imagery, while the authenticated product uses a quieter technical surface.

- Near-black Carbon canvas.
- Graphite cards.
- Steel 1px borders instead of shadows.
- Chalk primary type and Slate secondary type.
- Signal Red only for critical state, destructive action, focus moment or the single primary action.
- Archivo for the interface.
- Space Mono for IDs, timestamps, evidence labels, environment markers and step numbers.
- 4px radius throughout.
- No glassmorphism, glow, large blur, soft shadows or decorative gradients.

### 9.2 Necessary semantic color extension

The seven supplied brand colors are not enough for an operational safety product. Using red for every status would make warning, failure, active navigation and destructive action indistinguishable. Add four reserved operational colors:

| Token | Value | Role |
|---|---:|---|
| `--color-operational-warning` | `#f2a93b` | Deadline risk, degraded evidence, attention required |
| `--color-operational-success` | `#3fcf9b` | Verified outcome, healthy integration |
| `--color-operational-info` | `#6ea8fe` | Neutral process/investigation state |
| `--color-operational-muted` | `#b0abad` | Secondary text requiring stronger contrast than Slate |

These colors are semantic, not decorative. Signal Red remains the brand and high-risk action color.

### 9.3 Canonical Tailwind v4 and shadcn tokens

Use one canonical token file; remove the duplicated `@theme` and `:root` blocks from the supplied draft.

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-archivo);
  --font-mono: var(--font-space-mono);

  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);

  --color-signal-red: #e32735;
  --color-carbon: #0b0405;
  --color-graphite: #150e0f;
  --color-steel: #382e30;
  --color-slate: #858182;
  --color-chalk: #ffffff;
  --color-foil: #000000;
  --color-operational-warning: #f2a93b;
  --color-operational-success: #3fcf9b;
  --color-operational-info: #6ea8fe;
  --color-operational-muted: #b0abad;

  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 4px;
  --radius-xl: 4px;
}

:root {
  --font-archivo: "Archivo", ui-sans-serif, system-ui, sans-serif;
  --font-space-mono: "Space Mono", ui-monospace, monospace;

  --background: #0b0405;
  --foreground: #ffffff;
  --card: #150e0f;
  --card-foreground: #ffffff;
  --popover: #150e0f;
  --popover-foreground: #ffffff;
  --primary: #e32735;
  --primary-foreground: #ffffff;
  --secondary: #150e0f;
  --secondary-foreground: #ffffff;
  --muted: #150e0f;
  --muted-foreground: #b0abad;
  --accent: #22191b;
  --accent-foreground: #ffffff;
  --destructive: #e32735;
  --border: #382e30;
  --input: #382e30;
  --ring: #e32735;
  --radius: 4px;
}

* {
  border-color: var(--border);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-archivo);
  letter-spacing: -0.02em;
}

code,
kbd,
time,
[data-instrument] {
  font-family: var(--font-space-mono);
  letter-spacing: 0;
}
```

### 9.4 Type scale

| Role | Size/line | Weight | Use |
|---|---|---:|---|
| Display | 56/1.1 | 500 | Public hero only |
| Page title | 40/1.2 | 500 | Major public headings; rare in app |
| App heading | 28/1.2 | 500 | Authenticated page title |
| Section heading | 24/1.2 | 500 | Page sections, case title |
| Body | 16/1.5 | 400 | Explanatory content |
| UI body | 14/1.5 | 400/500 | Controls, tables, forms |
| Instrument | 12/1.5 | 400 | IDs, states, timestamps, badges |

The app adds a 28px page-heading step because 40px consumes too much vertical space on dense operational screens.

### 9.5 Density

- Default row height: 48px.
- Compact row height: 40px.
- Input/control height: 36px default, 40px for primary forms.
- Page section gap: 32–48px in the app, 80px on public pages.
- Card padding: 20–24px in the app, 32px on public pages.
- Minimum touch target: 44px where touch interaction is expected; dense desktop rows retain separate keyboard support.

---

## 10. Component inventory

### Standard components from shadcn/ui on Base UI

- Button, IconButton
- Input, Textarea, Select, Combobox
- Checkbox, Radio Group, Switch
- Dialog, Alert Dialog, Sheet, Drawer
- Popover, Tooltip, Hover Card
- Dropdown Menu, Context Menu, Command
- Tabs, Accordion, Collapsible
- Breadcrumb, Pagination
- Table shell, Scroll Area, Separator
- Badge, Alert, Skeleton
- Form patterns and validation messages
- Toast/Sonner notifications

### Product-specific components

| Component | Purpose |
|---|---|
| `IntegrityStateBadge` | State label with icon, text and semantic tone |
| `ActionDiff` | Before/after business-state comparison |
| `PolicyGateList` | Deterministic checks with exact rule/version |
| `EvidenceCard` | Source, timestamp, freshness, authority and conflict role |
| `EvidenceConflictMatrix` | Side-by-side comparison of contradictory claims |
| `ImpactScopeSummary` | Accounts, workflows, value and downstream exposure |
| `RecommendationPanel` | Recommendation, uncertainty, evidence citations and allowed actions |
| `DecisionPacket` | Frozen approval-ready evidence and rationale |
| `ApprovalRail` | Approver, threshold, comments and decision history |
| `RecoveryPlan` | Scope, payload preview, idempotency and verification plan |
| `VerificationChecklist` | Expected versus observed business state |
| `CaseTimeline` | Evidence, agent, human and system events |
| `EvidenceGraph` | React Flow view plus accessible list equivalent |
| `AuditEvent` | Immutable event with actor, source and payload diff |

### Component anatomy rules

- Status badge: icon + label; never a color-only dot.
- Destructive/irreversible action: explicit verb and object, not “Confirm.”
- Generated recommendation: visually distinct from policy result.
- Evidence citation: source name, record ID, observed-at time and freshness.
- Tooltip: supplemental only; essential information stays visible.
- Empty state: explain why it is empty and what action is possible.
- Toast: confirms a request; it never serves as the only record of a consequential action.

---

## 11. Motion policy

Motion must communicate causality, arrival, containment or completion.

### Allowed

- 120–180ms hover/focus transitions.
- 180–240ms dialog/sheet transitions.
- One-time emphasis when a held action enters a queue.
- Event insertion in the case timeline.
- Connector animation during a live evidence trace, then settle to static.
- Verification progress while an observation is actively pending.

### Prohibited

- infinite moving cards;
- animated gradients;
- glow and spotlight effects in authenticated pages;
- number animation that obscures exact values;
- auto-advancing carousels;
- motion on audit evidence;
- decorative particles;
- parallax in operational workflows.

Respect `prefers-reduced-motion`. Critical state change must remain understandable when all animation is removed.

### Approved accent-library use

- **Magic UI:** adapt an animated list for newly arriving case events; optional subtle number transition only on the public demo, not operational metrics.
- **Aceternity UI:** adapt one background grid or tracing treatment for the public product loop; no direct library styling survives without token conversion and accessibility review.

---

## 12. Interaction and safety patterns

### Consequential action confirmation

For release, block, compensate, policy publish and credential change:

1. Name the exact action and target.
2. Show impact scope.
3. Show the governing policy and required approval.
4. Show payload/diff.
5. Show verification plan.
6. Require a reason for exceptions or overrides.
7. Record actor, time and environment.

Do not use typed phrases for ordinary confirmation. Reserve typed confirmation for production actions with unusually large scope or irreversible consequences.

### AI-generated content

- Label as `Agent recommendation`, not `Decision`.
- Show cited evidence inline.
- State unresolved uncertainty.
- Preserve the previous version when evidence changes the recommendation.
- Separate model reasoning summary from deterministic policy outcome.
- Provide `Why this changed` after a recommendation update.

### Error handling

- Inline errors for local form issues.
- Persistent page alert for failed saves or stale case state.
- Recovery and verification failures create durable workflow states, not temporary toasts.
- Optimistic UI is prohibited for releases, compensations, policy publishing and approvals.

---

## 13. Accessibility requirements

Target WCAG 2.2 AA.

- Full keyboard operation for navigation, queues, dialogs, menus and decision flows.
- Visible focus ring using Signal Red plus a light offset where necessary.
- Skip link to main content.
- Landmark and heading hierarchy on every page.
- Accessible names for icon-only controls.
- Table header, sort and selection announcements.
- Live-region announcements for incoming evidence and completed checks, without repeated noise.
- Graph has a navigable node list and relationship table.
- Red is never the sole signifier.
- Slate `#858182` should not be used for small essential text on Graphite without contrast verification; use Operational Muted for required secondary copy.
- Zoom to 200% without loss of workflow functionality.
- All motion has a reduced-motion path.

Base UI’s unstyled accessibility-oriented primitives are a useful foundation, but component-level and workflow-level testing remain project responsibilities. [Base UI overview](https://base-ui.com/react/overview/about)

---

## 14. Frontend architecture

### Recommended feature structure

```text
app/
├── (public)/
├── (auth)/
└── app/
    ├── overview/
    ├── actions/
    ├── investigations/
    ├── evidence/
    ├── recoveries/
    ├── verification/
    ├── policies/
    ├── integrations/
    ├── audit/
    ├── analytics/
    └── settings/

components/
├── ui/                 # shadcn-generated Base UI components
├── accent/             # reviewed Magic/Aceternity adaptations
├── shell/
├── actions/
├── investigations/
├── evidence/
├── recoveries/
├── policies/
└── audit/

lib/
├── api/
├── auth/
├── permissions/
├── schemas/
├── telemetry/
└── utils/
```

### Supporting choices

- Next.js App Router and React Server Components by default.
- Client components only for interactive tables, graphs, complex forms and real-time streams.
- TanStack Query only where server state needs client caching or polling.
- TanStack Table for queue behavior.
- React Hook Form plus schema validation for policy and approval forms.
- React Flow for evidence relationships.
- A charting library with accessible table fallbacks for analytics; keep charts subordinate to case-level evidence.
- Lucide icons with a restricted product icon mapping.
- Storybook or an equivalent component workbench for states and visual regression.

### Data and URL state

- Filters, sort, selected saved view and time range belong in the URL.
- Sensitive payloads and free-text evidence do not belong in query strings.
- Pages render a stable server snapshot, then subscribe to case/action updates where required.
- Show `last updated` and stale-data state; never silently present old risk information as current.

---

## 15. Build sequence

### Phase 1 — Foundation

- Next.js, TypeScript and Tailwind v4.
- shadcn/ui configured with the Base UI base.
- canonical tokens, typography and dark theme.
- application shell, navigation, permissions and route skeletons.
- component workbench with default, hover, focus, disabled, loading and error states.

### Phase 2 — Core demonstration loop

- Overview.
- Action Queue and action detail.
- Investigation workspace.
- Approval decision packet.
- Recovery plan and run.
- Verification queue and detail.
- Complete audit trail.

This phase must demonstrate the full loop: **unreliable evidence → exposed action → hold → investigation → accountable decision → release/compensation → verified business state**.

### Phase 3 — Control and exploration

- Evidence Explorer.
- Policies and simulation.
- Integrations.
- Saved views and global search.

### Phase 4 — Measurement and hardening

- Analytics.
- role/access settings;
- accessibility audit;
- performance and bundle review;
- visual regression;
- reduced-motion review;
- empty/error/offline/stale-state coverage.

### MVP page priority

If time is constrained, build these first:

1. Action Queue
2. Action detail
3. Investigation workspace
4. Recovery run
5. Verification
6. Audit
7. Minimal overview

Do not spend the first iteration building a visually impressive marketing page or a broad analytics dashboard.

---

## 16. Acceptance criteria

The UI is production-ready for the selected demonstration when:

- users can move through the complete action-integrity loop without returning to a generic dashboard;
- every consequential recommendation links to evidence;
- policy outcomes are visually distinct from agent recommendations;
- an approver can understand scope, uncertainty and verification before acting;
- a successful API call cannot prematurely close a recovery;
- a failed verification creates visible, durable work;
- the same state vocabulary appears in navigation counts, queues, details, audit and analytics;
- all critical workflows are keyboard usable;
- no essential meaning depends on red alone;
- all core pages work at 1024px width;
- source-owned accent components pass design-token and accessibility review;
- Mantine and daisyUI are absent from the production dependency tree;
- public-page motion disappears cleanly under reduced-motion settings;
- the authenticated application contains no decorative glow, gradient-card or infinite-animation patterns.

---

## 17. Final recommendation in one sentence

Build a dark, evidence-led, multi-page control room using **shadcn/ui on Base UI**, with **TanStack Table and React Flow** for specialist operational surfaces, and treat **Magic UI and Aceternity UI as carefully adapted accents—not competing design systems**.

---

## 18. Research sources

All library claims were checked against official sources through Firecrawl on 27 October 2026.

- [shadcn/ui — design-system foundation](https://ui.shadcn.com/)
- [shadcn/ui — current component bases and Base UI default](https://ui.shadcn.com/docs/changelog/2026-07-react-aria)
- [shadcn/ui — CSS-variable and registry configuration](https://ui.shadcn.com/docs/components-json)
- [Base UI — overview and accessibility goals](https://base-ui.com/react/overview/about)
- [Base UI — styling freedom and quick start](https://base-ui.com/react/overview/quick-start)
- [Mantine — official product overview](https://mantine.dev/)
- [Mantine — Styles API](https://mantine.dev/styles/styles-api/)
- [daisyUI — official product overview](https://daisyui.com/)
- [daisyUI — semantic color system](https://daisyui.com/docs/colors/)
- [Aceternity UI — official product positioning](https://ui.aceternity.com/)
- [Magic UI — official product positioning](https://magicui.design/)
- [TanStack Table — headless table architecture](https://tanstack.com/table/latest/docs/overview)
- [React Flow — node-based interfaces](https://reactflow.dev/)

