# Architecture

## Authority layers

Research Workbench deliberately keeps five kinds of state separate:

1. **execution state** — whether a node is draft, ready, running, in review, blocked, accepted, superseded, or cancelled;
2. **lease state** — which Agent owns a bounded unit of work and when that ownership expires;
3. **artifact state** — candidate, verified, accepted, stale, rejected, or superseded research content;
4. **human decisions** — version-bound approvals, amendments, and accepted risks;
5. **export authority** — the exact bytes that an identified author approved for delivery.

“Generated,” “verified,” “approved,” and “signed” therefore cannot be used as synonyms.

## Persistence

- Project events use project-scoped append-only NDJSON hash chains.
- Artifact content is immutable and addressed by SHA-256.
- Agent work orders, model runs, and tool calls use a separate lifecycle log.
- Project snapshots are projections; replayable events and artifact bytes remain authoritative.

## Request flow

```text
Browser
  │
  ├─ GET project projection ───────────────┐
  │                                        │
  ├─ POST run/pause/recovery               ▼
  ├─ POST exact gate fingerprint      ResearchAgentServiceV1
  └─ POST exact review fingerprint         │
                                           ├─ event engine
                                           ├─ artifact store
                                           ├─ Pi runtime adapter
                                           ├─ PubMed gateway
                                           └─ export authority
```

The API recomputes the current human boundary before accepting a decision. Stale Gate or review material is rejected rather than silently applied to a newer version.

## Completion profiles

- `evidence_brief`: stop after evidence extraction and independent verification.
- `evidence_outline`: continue through evidence-backed argument design.
- `audited_review`: continue through claim-level verification, manuscript audit, and author sign-off.

Profiles select a legitimate terminal node; they do not skip upstream evidence gates.

## Trust boundary

V1 is a local/single-researcher architecture. Optional HTTP Basic Auth protects a private evaluation endpoint but does not provide project tenancy, role management, audit-grade identity, or qualified electronic signatures.
