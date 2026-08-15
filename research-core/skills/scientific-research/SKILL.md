---
name: scientific-research
description: Run a traceable PubMed evidence-review project with fixed research stages, real retrieval, explicit access levels, independent citation checking, human decision gates, restart recovery, and maturity-labeled exports. Use when the user asks to establish, continue, review, verify, or export a literature-based research project.
---

# Scientific research with the Pi Research Workbench

Use the package tools as the operational source of truth. Do not invent project state from the conversation and do not use ordinary file-writing tools to simulate a completed research artifact.

The current package is an auditable evidence-review mode, not a universal experimental-research Agent. A literature-supported idea remains a candidate until a separate method pack produces an actual result or failure record and a researcher approves its interpretation.

## Human-facing research stages

Speak to the researcher using these stages:

1. 问题成形
2. 文献调研
3. 论证结构
4. 写作与核查
5. 定稿交付

Do not expose internal node identifiers unless the researcher explicitly asks for debugging details. Explain unfamiliar technical terms in plain language.

## Start a project

Start from the research question. Do not require a new researcher to write a PubMed query first.

1. Call `research_query_preview` with the question. This must run real PubMed pilot searches for at least two comparable candidates before any project is created.
2. Show the actual query, real total hit count, current-order unfiltered title/abstract samples, mappings, unknown terms, and access/recall boundary for every candidate.
3. Ask the researcher to select a ready candidate. Do not choose on the researcher's behalf.
4. If the researcher edits a query, call `research_query_preview` again with the edited query plus at least one comparison query. Never reuse an old hit count for edited text.
5. Only then call `research_project_create` once with the selected candidate's exact `query`, `id`, and the latest `planHash`.

Before project creation, make sure the user has supplied or approved:

- a project title;
- a research question;
- one PubMed candidate that completed real preview retrieval;
- the desired endpoint: evidence brief, evidence-backed outline, or audited review;
- material constraints such as population, intervention/exposure, outcomes, dates, languages, and prohibited extrapolations.

Treat the guided vocabulary mapping as a transparent starting draft, not expert MeSH review. Preserve unmapped or uncertain concepts as unknown instead of inventing an English translation. A pilot hit count and the first few unfiltered records do not establish recall, relevance, a field trend, novelty, or absence of evidence.

If every candidate returns zero results or fails, stay in query planning: revise the question or query and preview again. Do not create an empty project. If retrieval fails after creation, keep and report the returned project ID. Continue the same project after the failure is resolved; do not create duplicate orphan projects.

## Continue a project

Use `research_project_read` before claiming what has or has not been completed. Use `research_run_current_step` to let the Agent process the next state-machine event.

When the result status is `awaiting_user_decision`:

- stop automatic progression;
- summarize exactly what is being approved or reviewed;
- state the important evidence boundary and uncertainty;
- ask the user to run `/research-decide` in Pi's interactive interface;
- never call a tool, edit a state file, or phrase a recommendation as if it were the user's approval.

The decision command binds the researcher, reason, exact artifact versions, and gate fingerprint. A new upstream version can invalidate later outputs.

## Evidence discipline

Large-scale discovery and screening default to title and abstract. Full text is not required merely to discover or freeze an abstract-level candidate library.

Every source must retain its actual access level:

- `title_only`: only the title/metadata was available;
- `abstract_only`: title, metadata, and abstract were available;
- `full_text`: the full article was actually accessed;
- `full_text_and_supplement`: full article and supplement were actually accessed.

If an abstract does not report a method, number, subgroup, adverse event, or limitation, record it as “摘要未报告” or “未知”. Never rewrite missing information as “没有实施” or “不存在”.

Do not use result counts as proof of efficacy, trend, mechanism, novelty, or absence of evidence. Claims require source locators and an independent citation verification result. Strong causal, numerical, safety, and clinical claims should be escalated to targeted full-text verification.

## Writing and verification

Keep generation and verification separate:

1. Draft bounded claim units from frozen evidence.
2. Verify every factual sentence against the cited source snapshot.
3. Revise or remove unsupported text.
4. Assemble the manuscript only from accepted claim units.
5. Run an independent manuscript audit.
6. Require explicit author responsibility before formal delivery.

Guided mode demonstrates and exercises the real workflow without a live model. Its output is always restricted and must not be called a completed formal research conclusion.

## Export

Use `research_export` for a traceable JSON bundle at any mature checkpoint. Markdown requires a manuscript candidate. Respect the returned maturity label:

- `formal`: all package conditions for formal delivery were met;
- `restricted_draft` or `restricted_research_bundle`: useful for continuation and audit, not a formal conclusion.

Never remove or soften the restriction banner.

## Required researcher brief

Every research response, including intermediate and final responses, must be understandable without opening a file. Include:

- 当前研究时期;
- 本轮新得到的结论或进展;
- 主要依据和实际访问边界;
- 尚不确定、失败或未覆盖的内容;
- 下一步，或当前需要研究者确认的决定.

Links, PMIDs, local files, and exports are optional traceability aids and do not replace this brief.

## Safety boundary

This package supports research workflow and evidence synthesis. It does not replace clinical care, ethics review, trial registration, statistical review, laboratory SOPs, data governance, or an author's responsibility. Do not turn population-level literature summaries into individual diagnosis or treatment advice.
