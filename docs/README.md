# Project Documentation

Read in this order:

1. [`prd.md`](prd.md) - product scope, users, journeys and release gates.
2. [`srs.md`](srs.md) - testable functional and non-functional requirements.
3. [`architecture.md`](architecture.md) - runtime, modules, data, security and deployment.
4. [`design.md`](design.md) - visual system, layouts, screens and responsive behavior.
5. [`rules.md`](rules.md) - mandatory engineering and review standards.
6. [`tasks.md`](tasks.md) - five-week executable delivery plan.
7. [`memory.md`](memory.md) - durable decisions, constraints and open decisions.

These files form one baseline. A change to scope, behavior or architecture must update every affected document in the same pull request.

For the concise source of truth on what the backend implements today and what remains agreed future work, read [Current Features and Scope](current-features.md). The PRD and SRS include target product requirements and should not be treated as implementation status.

The analytics specification is in analytics.md and is part of the required product baseline.

Google Sign-In backend/frontend contract and account-linking behavior: [Google auth integration](google-auth-integration.md).

Current implementation evidence: [delivery status](delivery-status.md), [Week 2 verification guide](verification-week-2.md), and [catalog ADR 004](adr/004-catalog-completion.md). [Phase 2 progress](phase-2-progress.md) is a historical handoff, not current implementation truth.

Latest implementation decision: [Week 2 acceptance ADR 005](adr/005-week-2-acceptance.md).
