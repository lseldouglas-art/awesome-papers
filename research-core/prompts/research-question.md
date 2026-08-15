---
description: Turn a broad topic into a bounded research question ready for a real PubMed pilot search
argument-hint: "<topic or question>"
---

Use the scientific-research Skill to turn the following topic into a research-ready question:

$ARGUMENTS

Clarify the population or domain, exposure/intervention, comparison when relevant, outcome, time range, and prohibited extrapolations. Then call `research_query_preview`: generate and really test at least two comparable PubMed candidates. Show each actual query, real hit count, current-order unfiltered title/abstract samples, vocabulary mappings, unknown terms, and access/recall boundary.

Ask the researcher to select a ready candidate. If they edit a query, preview the edited text again with at least one comparison query; never reuse the old hit count. Do not call `research_project_create` from this prompt and do not imply that query preview is completed screening or a human Gate decision.
