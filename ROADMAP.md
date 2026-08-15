# Roadmap

## V1 status — Alpha

The end-to-end single-researcher loop is implemented: question shaping, query preview, staged retrieval, evidence extraction, independent verification, human gates, bounded writing, audit, recovery, and restricted export.

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

## Release sequence

1. **0.1.x — local alpha:** stabilize installation, recovery, and contributor contracts.
2. **0.2.x — private hosted evaluation:** Basic Auth or upstream identity proxy, persistent disk, invited evaluators.
3. **0.3.x — isolated multi-user beta:** real identity, project tenancy, background jobs, backups.
4. **1.0 — production:** documented service guarantees, migrations, security review, and evidence from sustained external use.
