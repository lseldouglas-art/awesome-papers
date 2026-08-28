import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { sha256 } from "../event-engine-v1.js";
import {
  assertResearchReportBinding,
  buildResearchReportContract,
} from "../research-report-contract-v1.js";
import { RESEARCH_REVIEW_CLASSIFIER_VERSION } from "../research-review-synthesis-v1.js";
import { __testing as gatewayTesting } from "../research-tool-gateway-v1.js";

const WINDOWS = Object.freeze([
  { from: "2021-08-27", to: "2022-08-26", totalHits: 546, selectedPmids: ["35481909", "35431510", "35319717", "34933124"] },
  { from: "2022-08-27", to: "2023-08-26", totalHits: 571, selectedPmids: ["37649615", "37245017", "37179585", "36240980"] },
  { from: "2023-08-27", to: "2024-08-26", totalHits: 510, selectedPmids: ["38600020", "38892067", "38176660", "39357127"] },
  { from: "2024-08-27", to: "2025-08-26", totalHits: 632, selectedPmids: ["39849657", "40319897", "38886045", "39148190"] },
  { from: "2025-08-27", to: "2026-08-26", totalHits: 591, selectedPmids: ["41499132", "39928093", "40555635", "41044644"] },
]);

const BASE_QUERY = '(("gastric cancer"[Title]) OR ("stomach cancer"[Title]) OR ("gastric neoplasm"[Title]) OR ("gastric neoplasms"[Title]) OR ("gastric carcinoma"[Title])) AND (review[Publication Type] OR systematic review[Publication Type]) NOT guideline[Publication Type] NOT practice guideline[Publication Type]';
const FROZEN_PROJECT_ID = "fixture:gastric-cancer-review-landscape-2021-2026";
const FROZEN_PMIDS = WINDOWS.flatMap((window) => window.selectedPmids);
const DEFAULT_OUTPUT = resolve(
  new URL("../fixtures/gastric-cancer-review-ledger-2021-2026.v1.json", import.meta.url).pathname,
);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function assertFrozenFixtureShape(report) {
  assertResearchReportBinding(report, {
    projectId: FROZEN_PROJECT_ID,
    reportRevision: 1,
  });
  if (report.binding.authority !== "frozen_pubmed_fixture") {
    throw new Error("Frozen fixture must use frozen_pubmed_fixture authority.");
  }
  if (report.ledger?.classifierVersion !== RESEARCH_REVIEW_CLASSIFIER_VERSION) {
    throw new Error("Frozen fixture classifierVersion differs from the current classifier.");
  }
  const pmids = report.ledger?.rows?.map((row) => row.pmid) ?? [];
  if (pmids.length !== 20 || new Set(pmids).size !== 20 || FROZEN_PMIDS.some((pmid) => !pmids.includes(pmid))) {
    throw new Error("Frozen fixture must contain the exact 20 unique PMIDs declared by the five windows.");
  }
  if (report.ledger?.analyzedRowCount !== 20 || report.relevanceGate?.relevantCount !== 20) {
    throw new Error("All 20 frozen rows must pass the minimum subject relevance gate.");
  }
}

function samplingMetadataFor(sourceDocuments) {
  return {
    schemaVersion: "pubmed-stratified-review-sample/v1",
    database: "PubMed",
    provider: "NCBI E-utilities",
    executedOn: "2026-08-27",
    timeZone: "Asia/Shanghai",
    baseQuery: BASE_QUERY,
    dateClauseTemplate: 'AND ("{from}"[Date - Publication] : "{to}"[Date - Publication])',
    sort: "relevance",
    pubMedSortLabel: "Best Match",
    selectionRule: "将2021-08-27至2026-08-26分为5个连续12个月窗；每窗按PubMed Best Match取前4篇，合计20篇。",
    excludedPublicationTypes: ["Guideline", "Practice Guideline"],
    windows: WINDOWS,
    totalHitsByWindow: WINDOWS.map(({ from, to, totalHits }) => ({ from, to, totalHits })),
    sourceDocuments: sourceDocuments.map((document, index) => ({
      role: index === 0 ? "efetch_primary" : `efetch_supplement_${index}`,
      transportDocumentSha256: sha256(document.xml),
      hashMeaning: "标识本次输入的完整 EFetch XML 传输文档；它不是单篇记录的语义快照哈希，也不单独决定分类是否漂移。",
    })),
    refetchVerification: {
      provider: "NCBI E-utilities EFetch",
      database: "pubmed",
      pmids: FROZEN_PMIDS,
      replayCommand: "node research-core/scripts/build-gastric-review-ledger-fixture.mjs --verify-only --input <efetch.xml>",
      sealedIntegrityCommand: "node research-core/scripts/build-gastric-review-ledger-fixture.mjs --verify-only",
      hashPolicy: "重取后以规范化单篇记录的 sourceSnapshotHash 重放分类；任一记录语义快照变化均阻断复用。transportDocumentSha256 只标识确切 XML 输入，重取时可因传输层变化而不同。",
      publicDataBoundary: "仓库不保存完整出版商摘要；无 --input 时只能验证已封存账本和 reportHash 的内部完整性，不能声称重放原文分类。",
    },
    boundary: "各窗口命中总数是检索规模元数据；20篇是 2026-08-27 检索时按 PubMed Best Match 冻结 PMID 的时间分层题名摘要样本，不是随机样本、全量发文计数或领域成熟度评分。相关性排序算法可能变化，未来重跑不承诺得到相同顺序或相同 PMID。",
  };
}

function buildFromRecords(records, samplingMetadata) {
  return buildResearchReportContract({
    projectId: FROZEN_PROJECT_ID,
    question: "胃癌的研究现状",
    records,
    subjectConcepts: [{
      conceptId: "subject:gastric-cancer",
      sourceTerm: "胃癌",
      role: "subject",
      meshTerms: ["Stomach Neoplasms"],
      mappedTerms: [
        "gastric cancer",
        "stomach cancer",
        "gastric carcinoma",
        "stomach carcinoma",
        "gastric adenocarcinoma",
        "stomach adenocarcinoma",
        "gastric neoplasm",
        "stomach neoplasm",
      ],
    }],
    reportRevision: 1,
    generatedAt: "2026-08-27T00:00:00+08:00",
    reviewWindow: { years: 5, from: "2021-08-27", to: "2026-08-26" },
    samplingMetadata,
    bindingAuthority: "frozen_pubmed_fixture",
  });
}

async function recordsFromDocuments(paths) {
  const sourceDocuments = await Promise.all(paths.map(async (path) => ({
    path,
    xml: await readFile(path, "utf8"),
  })));
  const parsed = sourceDocuments.flatMap((document) => gatewayTesting.parsePubMedXml(document.xml));
  const byPmid = new Map(parsed.filter((record) => record.pmid).map((record) => [record.pmid, record]));
  const missing = FROZEN_PMIDS.filter((pmid) => !byPmid.has(pmid));
  if (missing.length > 0) {
    throw new Error(`EFetch XML is missing final fixture PMIDs: ${missing.join(", ")}`);
  }
  if (new Set(FROZEN_PMIDS).size !== 20) {
    throw new Error("The frozen stratified sample must contain exactly 20 unique PMIDs.");
  }
  return {
    sourceDocuments,
    records: FROZEN_PMIDS.map((pmid) => byPmid.get(pmid)),
  };
}

const outputPath = resolve(argument("--output", DEFAULT_OUTPUT));
const verifyOnly = process.argv.includes("--verify-only");
const input = argument("--input");
const supplement = argument("--supplement");
const inputPaths = [input, supplement].filter(Boolean).map((value) => resolve(value));

if (verifyOnly && inputPaths.length === 0) {
  const existing = JSON.parse(await readFile(outputPath, "utf8"));
  assertFrozenFixtureShape(existing);
  process.stdout.write(
    `verified sealed fixture integrity ${outputPath}; raw title/abstract classifier replay was not performed (supply --input <efetch.xml>)\n`,
  );
} else {
  if (inputPaths.length === 0) {
    throw new Error("Building the fixture requires --input <efetch.xml>; --supplement <efetch.xml> is optional.");
  }
  const { sourceDocuments, records } = await recordsFromDocuments(inputPaths);
  const existing = verifyOnly
    ? JSON.parse(await readFile(outputPath, "utf8"))
    : null;
  const report = buildFromRecords(
    records,
    verifyOnly ? existing.ledger.samplingMetadata : samplingMetadataFor(sourceDocuments),
  );
  assertFrozenFixtureShape(report);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (verifyOnly) {
    const frozenSerialized = `${JSON.stringify(existing, null, 2)}\n`;
    if (frozenSerialized !== serialized) {
      throw new Error("Refetched normalized records or current classifier differ from the frozen report; create a new audited reportRevision.");
    }
    process.stdout.write(
      `verified raw classifier replay for ${outputPath}; input transport SHA-256 ${sourceDocuments.map((document) => sha256(document.xml)).join(", ")}\n`,
    );
  } else {
    await writeFile(outputPath, serialized, "utf8");
    process.stdout.write(`${outputPath}\n`);
  }
}
