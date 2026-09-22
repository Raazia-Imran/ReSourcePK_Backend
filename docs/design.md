# Product and Interface Design System

## Experience principles

1. Industrial credibility before decoration.
2. Make quantity, price, MOQ, condition, location and trust state scannable.
3. Explain group buying without financial jargon.
4. Progressive disclosure: simple defaults, detailed records on demand.
5. Every async action has loading, success, empty, partial and retry states.
6. Never use color alone to communicate status.

## Visual foundation

- Canvas: warm off-white `#F7F4EC`; surface `#FFFFFF`; text `#17201B`.
- Primary: deep circular green `#176B4D`; hover `#10553D`; soft `#E5F1EB`.
- Accent: copper `#B96A3C`, used sparingly for progress or highlights.
- Status colors must meet AA contrast and pair icon + label.
- Typography: a clear grotesk/sans family with tabular numerals for commerce data.
- Spacing: 4 px base; common steps 8, 12, 16, 24, 32, 48, 64.
- Radius: 10-14 px; restrained shadows; visible borders; no excessive glassmorphism.
- Motion: 150-250 ms, transform/opacity only where possible; honor reduced motion.

## Application shell

Desktop dashboards use a 240-280 px collapsible sidebar, top context bar, breadcrumbs and a max-width content region. Mobile uses a drawer; primary task actions remain reachable without horizontal scrolling. Organization switcher and role context are always visible. Marketplace browsing remains lighter than operational dashboards.

## Key screens

- Public landing and marketplace catalog.
- Listing detail with availability, MOQ, tiers, seller identity, direct/group actions.
- Buyer requirement form and explainable matches.
- Pool detail with target, reserved/paid quantities, close time, current/next price tier, contribution state and cancellation terms.
- Checkout with server-issued summary and provider handoff.
- Buyer workspace: requirements, pools, orders, reviews.
- Seller workspace: overview, listings, orders, inventory, team, impact.
- Team management: pending/expired invites, role matrix, revoke and ownership transfer.
- Platform operations: queues, disputes, moderation, organizations, users, audit events.
- Passport verification: anchored state, transaction ID, timestamp, snapshot version and precise claim limitation.

## Components

Build accessible primitives for Button, Link, Input, Select, Combobox, Checkbox, Radio, Dialog, Drawer, Toast, Table, Pagination, Tabs, Breadcrumb, Badge, Progress, Skeleton, EmptyState, ErrorState and ConfirmAction. Forms use persistent labels, inline validation, summary errors and disabled/submitting protection. Destructive actions require explicit confirmation and never rely on ambiguous icons.

## Responsive behavior

- 360-479 px: single-column forms/cards, compact table alternatives, bottom action area.
- 480-767 px: expanded cards, two-column fields only when readable.
- 768-1023 px: drawer/compact sidebar, two-column content.
- 1024+ px: full navigation and data tables.
- Test 200% zoom, keyboard-only use, long names, Urdu/English strings and slow/error states.

## Content rules

Use plain commerce language: “Join group order,” “Quantity reserved,” and “Payment confirmed.” Do not say blockchain “proves sustainability.” Say the record matches the snapshot anchored at a given time. Show PKR consistently; use explicit kg/m/roll units. Dates display in the user's locale while APIs use UTC ISO 8601.

## Definition of design complete

Figma or implementation includes every critical screen at mobile and desktop widths, component states, keyboard/focus behavior, token references, empty/loading/error cases, and final copy. A pretty happy path alone is not design complete.
