# awesome-papers roadmap

## Stable baseline — v0.1.4 Alpha

The end-to-end single-researcher loop is implemented: question shaping, query preview, staged retrieval, evidence extraction, independent verification, human gates, bounded writing, audit, recovery, and restricted export.

The stable baseline stays available while v0.2 is tested independently. A v0.2 plan, prototype, or evaluation artifact must not silently change the authority or data contracts of v0.1.4.

## v0.2 direction — Phase 0 ready to start

v0.2 tests a narrower product thesis: a human-led research continuity workbench that keeps research objects, evidence boundaries, accepted decisions, versions, and next actions understandable and recoverable across tools and interruptions.

The strategy and four-stage validation plan are adopted. Product code has not started. See [the v0.2 direction and stage gates](./docs/awesome-papers-v0.2-direction.md).

1. **Phase 0 — task and interaction structure:** lock one wedge task, the object model, critical flows, four visual primitives, and five cognitive walkthroughs.
2. **Phase 1 — high-fidelity prototype:** validate Explore, Compare, Read, and Decide on desktop and narrow screens.
3. **Phase 2 — independent vertical slice:** run a fixed corpus with one live model route, one connector, full decision provenance, recovery, and cost records.
4. **Phase 3 — external comparison:** compare the same task with 6–10 target researchers before any production recommendation.

No v0.2 tag, production merge, hosted deployment, live-model result, or external-user validation exists yet.

## Before public multi-user production

- authenticated users and per-user project isolation;
- authorization checks bound to server-side identities, not a fixed local owner;
- transactional remote event/artifact storage and backups;
- job queue, worker leases, rate limits, and restart-safe long-running execution;
- encrypted secret management and provider-specific credential rotation;
- observability, error reporting, abuse controls, and operational runbooks;
- accessibility and usability studies with independent researchers;
- multi-database deduplication and targeted full-text acquisition workflows;
- explicit privacy, retention, deletion, and research-data governance policies.

## Stable release sequence

1. **0.1.x — local alpha:** stabilize installation, recovery, and contributor contracts.
2. **0.2.x — research continuity validation:** Phase 0–1 interaction validation first; an isolated vertical slice or private hosted evaluation begins only after those gates pass.
3. **0.3.x — isolated multi-user beta:** real identity, project tenancy, background jobs, backups.
4. **1.0 — production:** documented service guarantees, migrations, security review, and evidence from sustained external use.
