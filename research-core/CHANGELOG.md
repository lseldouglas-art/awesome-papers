# Changelog

All notable changes to this package are documented here.

## 0.1.0 — 2026-08-12

- Added the installable Pi package manifest for Pi 0.84.1.
- Added five read/run/export Agent tools. Human approval is intentionally absent from the tool surface.
- Added user-only commands for project creation, status, continuation, gate decisions, and export.
- Added project-local append-only persistence, PubMed retrieval, restart recovery, and serialized project mutations.
- Added a scientific-research Skill, four prompt templates, and the `research-pi` headless CLI.
- Added same-project revised-query retrieval recovery, BibTeX export, and SHA-256 manifests calculated from the actual exported bytes.
- Added package smoke tests, a prepublish gate, and open-source security/contribution documentation.
- Added source-bound citation receipts so a sentence cannot validate the wrong EvidenceRecord.
- Added immutable per-project model invocation provenance; a configured provider with zero successful token usage cannot upgrade guided history to formal research.
- Added one content-validated, author-signed ExportManifest as the only downloadable byte authority.
- Added idempotent web project creation and production API failure/restart checks for zero results, PubMed 503, timeout, and duplicate submissions.
