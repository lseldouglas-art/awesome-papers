# Contributing

Thank you for improving the research workbench. Contributions must preserve the following invariants:

1. The state machine and append-only event log remain the only authority for progress and decisions.
2. Agent tools may produce candidates and run approved read-only research tools, but may not approve human gates.
3. Every evidence item records its actual access level; unknown information is not imputed.
4. Generated claims and independent citation checks remain separate operations.
5. Existing artifacts and decisions are versioned or superseded, never silently overwritten.
6. New visible product content must be a projection of persisted research facts, not demo-only state.

Before proposing a change, run:

```bash
npm test
npm run test:core
npm run pack:check
npm run test:install
```

Use focused commits, include tests for failure and restart paths, and document changes to contracts, permissions, network hosts, or human authority. Test fixtures must not contain protected health information, unpublished participant data, credentials, or copyrighted full text.
