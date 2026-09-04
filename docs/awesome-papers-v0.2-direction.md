# awesome-papers v0.2 direction

- Status: adopted product direction; Phase 0 ready to start
- Snapshot date: 2026-09-04
- Current runnable release: v0.1.4 local single-researcher Alpha
- v0.2 implementation status: code not started
- External spend recorded for this track: none

## Product thesis

awesome-papers is becoming a **human-led research continuity workbench**. Its
job is to keep research objects, evidence boundaries, human decisions,
versions, and next actions understandable and recoverable across tools,
stages, and interruptions.

AI may explain, compare, propose candidates, and assist with bounded actions.
It does not silently approve a decision, turn a suggestion into a plan, claim
an unperformed run, or replace scientific and ethical responsibility.

## Why the direction changed

The primary problem is not simply finding one more paper. Researchers lose
time when sources, claims, candidate plans, and accepted decisions are spread
across literature tools, general-purpose agents, editors, notebooks, and chat
history. After an interruption, they must reconstruct both the state and the
reasoning behind it.

v0.2 therefore prioritizes continuity, decision provenance, and accurate
recovery over adding a larger catalogue of autonomous Agent features.

## First product wedge

The first validation path is deliberately narrow:

`import existing project material → map research state → align claims and evidence → compare 2–4 candidate approaches → record the human decision → produce a versioned next-step plan`

The initial audience hypothesis is an individual researcher or a 2–5 person
computational or biomedical team returning to a project that already has
papers, notes, data, drafts, or code.

## First four visual primitives

1. **Research state map** — where the project is, what exists, what is unknown,
   and what should happen next.
2. **Source cards with access level** — unvisited, title-only, abstract,
   full-text, and user-provided material remain visibly distinct.
3. **Decision comparison matrix** — options, evidence, cost, risk, unknowns,
   reversibility, and the human acceptance action are visible together.
4. **Version timeline** — earlier wording, decisions, and artifacts can be
   compared and restored without overwriting later history.

The first prototype covers Explore, Compare, Read, and Decide. Execute and
Write keep architectural space but are not full IDE or editor commitments.

## Public progress snapshot

| Layer | Status | Evidence boundary |
|---|---|---|
| v0.1.4 stable baseline | Released and runnable | Local single-researcher Alpha; not a hosted multi-user service |
| v0.2 strategy | Adopted | Product thesis, target wedge, boundaries, four stages, metrics, and stop rules are documented |
| Internal isolated engineering evaluation | Mechanisms tested, not released | An internal run records 362 passing automated checks for a bounded candidate; no live-model or external-user claim follows from it |
| Phase 0 interaction structure | Ready to start | Task contract, references, object model, flows, wireframes, and walkthroughs are not yet complete |
| v0.2 application code | Not started | No v0.2 tag, merge, deployment, or production claim |

## Four stage gates

### Phase 0 — task and interaction structure

Lock one real wedge task, the object model, critical flows, and the four visual
primitives. Run five internal cognitive walkthroughs. At least four must let a
tester explain the current state, evidence, human decision, unknowns, and next
action without reading a long instruction page.

### Phase 1 — high-fidelity interaction prototype

Build the desktop and narrow-screen Explore, Compare, Read, and Decide path.
Proceed only if information location, critical-path comprehension, and recovery
are materially better than the text-first baseline.

### Phase 2 — independent vertical slice

Use a fixed corpus, one real model route, and one connector. Preserve the
object flow, decision record, conflict handling, version recovery, usage, cost,
and action audit. Results must be reproducible and severe silent-overwrite or
authorization incidents must remain at zero.

### Phase 3 — external comparison and product decision

Run the same task with 6–10 target researchers against direct products and a
`reference manager + general Agent + editor` stack. Measure time, errors,
expert-reviewed evidence quality, comprehension, comfort, recovery, and reuse.
Only then decide whether to adopt, revise, keep independent, or stop the v0.2
direction.

## What is intentionally not claimed

- No live-model end-to-end quality or cost result exists yet.
- No paid competitor account has been used for long-running comparison.
- No external target researcher has completed the v0.2 task.
- No cross-browser, real-device, screen-reader, load, or production security
  readiness claim applies to v0.2.
- No multi-user identity, encrypted backup, formal connector write-back,
  scientific blind review, commercial pricing, or production deployment has
  been completed.
- The isolated evaluation candidate is evidence about selected mechanisms. It
  is not the v0.2 codebase and is not ranked above competitors.

## Compatibility boundary

The public project name changes from Research Workbench to awesome-papers.
Existing technical identifiers remain stable until a deliberate migration is
designed: `/research-workbench`, `RESEARCH_WORKBENCH_*`,
`.research-workbench-data/`, and historical release/document paths.

## Useful contributions now

The highest-value contributions in Phase 0 are concrete scenarios and failure
cases, not feature breadth:

- a real interrupted research task with scattered materials;
- examples where an AI candidate was confused with a human decision;
- evidence-access states that are easy to misread;
- recovery or version histories that lost the reason behind a decision;
- critiques of the four visual primitives against an actual research task.

Please open a focused issue and describe the task, materials, decision point,
failure mode, and what a successful recovery would look like. Do not attach
private manuscripts, credentials, participant data, or access-controlled full
text.
