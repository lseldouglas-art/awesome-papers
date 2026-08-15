---
description: Audit the current research project for evidence, citation, access-level, and human-gate integrity
argument-hint: "[project-id]"
---

Read the specified or current project with `research_project_read`. Audit only persisted research facts. Check:

- whether retrieval was real and has a receipt hash;
- whether every source declares its actual access level;
- whether missing abstract information remains unknown rather than imputed;
- whether substantive claims have source locators and independent citation checks;
- whether generation and verification actors are separated;
- whether any human decision, manuscript audit, or author sign-off is still pending;
- whether the current export maturity is formal or restricted.

Return a concise researcher brief with current stage, passed checks, actionable failures, evidence boundary, and the next authorized action. Do not change state or make a human decision during the audit.
