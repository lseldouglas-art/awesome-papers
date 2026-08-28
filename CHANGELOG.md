# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses semantic versioning after the initial alpha.

## [Unreleased]

### Planned

- External usability testing of the two-step project creation flow.

## [0.1.3] - 2026-08-28

### Changed

- Reordered the workspace around field brief, researcher decision, and evidence source; the visible page no longer leads with execution state.
- Moved the Pi runtime badge, research-state journey, quality counters, versions, hashes, and tool logs into a dedicated technical-audit tab.
- Removed the report workflow stepper and replaced it with the report purpose, observation unit, and scientific boundary.
- Rewrote remaining Agent- and state-machine-oriented frontstage copy as researcher-facing actions and research judgments.
- Kept pause, resume, retry, gate, and request-integrity details out of the field brief; raw error codes and runtime messages now remain in the technical audit only.
- Gave the review report a field-specific title and preserved PMID-level evidence in bounded drawers instead of a primary evidence wall.
- Deepened the trend chapter with sample-derived recent-versus-earlier topic ratios, journal-dispersion limits, and explicit separation between observed time signals and general topic-design advice.

### Security and scientific integrity

- Split public scientific limitations from technical integrity notes so hashes, digital-signature caveats, trusted-root notes, and event-store details do not enter the mentor brief.
- Kept relevance, source-ledger, and stale-report checks fail closed while expressing failures in researcher language.
- Retained the title/abstract access boundary, fixed 20-review sample denominator, low-frequency-not-gap rule, same-topic-review check, and 50–100-paper planning boundary.

### Verification

- Passed 285 core tests, 9 workbench-model tests, 14 report-UI tests, and the API end-to-end test.
- Passed the production build, diff check, 1448×1086 desktop review, and 724×543 plus 390×844 no-overflow reviews.

## [0.1.2] - 2026-08-28

### Added

- A four-chapter, text-first review-topic report: field landscape, five-year trend and topic analysis, research opportunities, and one selected execution plan.
- A sealed 20-record PubMed title-and-abstract fixture for the gastric-cancer example, with PMID-level traceability and deterministic replay checks.
- Bounded chapter evidence drawers plus a separate complete included-record ledger.
- Responsive and keyboard-accessibility coverage for 4:3 desktop, 390 px mobile, 200% zoom, focus restoration, and reduced motion.

### Changed

- Replaced broad topic summaries with decision-oriented scientific language, concrete abstract-supported problems, and explicit claim levels.
- Reworked review directions into structured candidates with population, comparison, outcome, validation axis, workload target, and abandon-or-narrow conditions.
- Classified coverage, trend, opportunity, and competition statements separately so low frequency cannot be promoted to a research gap.
- Bound the second-round focused search to the exact first-round report, selected proposal, researcher reasons, focus mapping, and query fingerprint.

### Security and scientific integrity

- Caller-authored external-review status, locators, or source ids cannot upgrade a direction to verified.
- Report hashes are described as content fingerprints, not digital signatures or independent tamper-proof authority.
- Missing abstract details remain unknown, and the 50–100-paper and 10–12-week values remain planning targets rather than inclusion thresholds or completion promises.

## [0.1.1] - 2026-08-15

### Added

- A Render Blueprint for a password-protected, disposable free evaluation instance.
- Explicit warnings that free-hosted project data is ephemeral and unsuitable for formal research records.

### Changed

- Citation metadata now uses the verified GitHub alias without inferring a personal name.

## [0.1.0] - 2026-08-15

### Added

- Runnable React and Node research workbench.
- Append-only research events, immutable artifacts, and Agent lifecycle receipts.
- Staged PubMed retrieval and access-level-aware evidence records.
- Human-only gates, independent reviews, recovery, and protocol revision.
- Evidence brief, outline, and audited-review completion profiles.
- Four-part researcher stage brief adjacent to the main product action.
- Restricted export authority and deterministic test coverage.
- Optional HTTP Basic Auth for private hosted evaluation.
