---
description: Produce a self-contained researcher brief from the persisted current project
argument-hint: "[project-id]"
---

Use `research_project_read` for the specified or current project. Give the researcher a self-contained Chinese brief containing:

1. 当前研究时期（use natural language, not internal codes）;
2. 本轮新得到的结论或进展;
3. 主要依据, including real PubMed count, saved-source count, representative PMIDs, and actual access levels;
4. 证据边界, uncertainties, failures, and content that remains unknown;
5. 下一步 or the exact human decision currently required.

Do not require the researcher to open a file to understand the status. Do not treat candidate sources as screened evidence or a restricted draft as a formal conclusion.
