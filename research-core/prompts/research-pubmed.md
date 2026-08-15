---
description: Compare real PubMed pilot searches, establish the selected project, and stop at the first human decision
argument-hint: "<research question>"
---

Use the scientific-research Skill and the Pi Research Workbench tools to establish a real PubMed project from:

$ARGUMENTS

Start with the research question; do not require the user to supply an English query. Call `research_query_preview`, compare at least two candidates using their actual queries, real hit counts, unfiltered title/abstract samples, vocabulary mappings, unknown terms, and stated boundaries. Ask the researcher to choose.

If the researcher edits a candidate, call `research_query_preview` again with the edited query and a comparison query. Only after a ready candidate is explicitly selected, confirm the title, endpoint, and constraints, then call `research_project_create` exactly once with that candidate's exact query, candidate id, and latest plan hash.

Report the real result count, records actually saved, title-versus-abstract access counts, receipt hash, limitations, and current natural-language research stage. If the result is `awaiting_user_decision`, stop and direct the researcher to `/research-decide`; do not approve the Gate yourself.
