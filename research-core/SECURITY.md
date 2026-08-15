# Security policy

## Trust model

Pi extensions execute with the current user's operating-system permissions. Review this package before installing it and install project-local packages only in repositories you trust.

The extension defaults to `<current project>/.pi/research-workbench-data`. It does not scan the home directory, shell history, browser data, or unrelated project files. `PI_RESEARCH_DATA_DIR` can deliberately override that location; treat it as an administrator-level setting.

## Network boundary

The research gateway sends read-only requests only to NCBI E-utilities at `https://eutils.ncbi.nlm.nih.gov/`. Its egress origin allowlist fails closed, follows no caller-selected host, limits each response to 5 MiB, and applies timeouts, retries and abort propagation. Test-only local endpoints must be explicitly allowlisted by an embedding test harness. It does not upload local manuscripts or project files. PubMed responses are frozen with content hashes and their actual access level. A title or abstract is never represented as full text.

If a live model is configured, typed work orders and the minimum source material required by that work order are sent to the selected model provider. Guided mode makes no model request and is labeled as restricted output.

## Secrets

Never commit `.env` files. API keys are read from the process environment or Pi's model registry and held in memory. They are not written to project events, artifacts, exports, or session receipts. NCBI identity fields are optional and must not contain secrets other than `NCBI_API_KEY`.

## Human authority

Agent-callable tools cannot approve a gate, accept a manual review, or sign a delivery. Those events are available only through explicit user-invoked Pi commands with a reason and the exact gate fingerprint.

PubMed titles, abstracts, full-text excerpts and all tool results are untrusted research data. Instruction-like text inside a source is never treated as a Pi instruction, tool authorization or gate decision. Project identifiers are validated before export paths are created, preventing directory traversal outside the configured research data directory.

Downloaded research files are served only from an immutable, content-validated `ExportManifest` whose embedded bytes match every declared SHA-256 and byte length and whose exact artifact hash is bound by `AuthorApproval` and `SignedDelivery`. Guided runs use `simulation_signed` with non-authoritative simulation metadata; they may expose only manifest-bound restricted bytes and can never authorize a formal manuscript.

## Reporting a vulnerability

Until a public security inbox is published, open a GitHub security advisory in the future repository rather than a public issue. Include the affected version, reproduction, impact, and a proposed mitigation if available. Do not include real patient or participant data.
