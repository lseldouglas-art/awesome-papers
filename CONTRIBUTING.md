# Contributing

Thank you for helping build research software that is useful without overstating what its evidence can support.

## Start here

1. Open an issue for changes to workflow authority, persistence, artifact contracts, retrieval semantics, or completion profiles.
2. Keep pull requests focused and explain the research or product invariant being changed.
3. Add a positive-path test and a fail-closed test for authority-sensitive behavior.
4. Run `npm test` before requesting review.

## Development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use Node 22.19+ and do not commit `.env*`, local project data, provider credentials, retrieved private full text, or copyrighted source corpora.

## Non-negotiable invariants

- A model or Agent cannot approve a human Gate.
- Decisions bind exact artifact versions and fingerprints.
- Generated, verified, accepted, and signed are distinct states.
- Stale and superseded artifacts remain traceable but cannot silently regain authority.
- Access level and source locator are preserved; missing information remains unknown.
- Guided/faux runs never become formal by changing server configuration later.
- Exported bytes must match the author-approved manifest exactly.
- Large-scale screening does not require full text unless the claim requires it.

## Pull requests

Include:

- what changed and why;
- user and developer impact;
- authority or data-migration implications;
- screenshots for visible UI changes;
- tests and manual checks performed;
- remaining limitations.

Maintainers may request a design note before accepting changes that create a new human decision, scientific artifact type, or formal authority path.

## Commit style

Use short imperative subjects, for example:

```text
Add version-bound evidence review receipts
Reject stale retrieval protocol recovery
Clarify abstract-only evidence boundary
```

## Reporting security issues

Follow [SECURITY.md](./SECURITY.md). Do not place secrets, private research data, or exploit details in public issues.
