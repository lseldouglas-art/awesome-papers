import test from "node:test";
import assert from "node:assert/strict";

import {
  BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
  FIELD_INQUIRY_METHOD_PACK_V1,
  METHOD_PACK_INTERFACE_V1,
  METHOD_PACK_REGISTRY_V1,
  WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
  assessMethodFit,
  validateMethodPack,
} from "./method-pack-interface-v1.js";

test("the unified method-pack interface preserves the scientific invariants", () => {
  assert.equal(METHOD_PACK_INTERFACE_V1.invariants.length, 7);
  assert.ok(
    METHOD_PACK_INTERFACE_V1.invariants.includes("方法包不能声称超出其证据产出的结论"),
  );
});

test("all three canonical example packs satisfy the same interface", () => {
  assert.equal(METHOD_PACK_REGISTRY_V1.length, 3);
  for (const pack of METHOD_PACK_REGISTRY_V1) {
    assert.deepEqual(validateMethodPack(pack), [], pack.identity.id);
  }
});

test("method packs compose through typed research objects without sharing one execution recipe", () => {
  assert.ok(
    FIELD_INQUIRY_METHOD_PACK_V1.compositionContract.outputObjectTypes.includes(
      "ResearchQuestionCandidate",
    ),
  );
  assert.ok(
    WET_LAB_TARGET_MEDIATION_TEMPLATE_V1.compositionContract.inputObjectTypes.includes(
      "EvidenceRequirement",
    ),
  );
  assert.equal(
    BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1.compositionContract.canRunAsSubHarness,
    true,
  );
});

test("a bioinformatics association pack rejects a causal-mechanism question", () => {
  const result = assessMethodFit(
    BIOINFORMATICS_DIFFERENTIAL_EXPRESSION_TEMPLATE_V1,
    {
      questionType: "causal_mechanism_test",
      intendedClaimType: "causal_gene_effect",
      requiredEvidenceComponents: ["genetic_perturbation"],
      contextTags: ["human"],
    },
    {
      prerequisiteIds: [
        "raw_or_primary_data",
        "sample_metadata",
        "analysis_question",
        "data_permission",
      ],
    },
  );

  assert.equal(result.fit, "not_fit");
  assert.ok(result.blockers.some((item) => item.includes("目标结论")));
  assert.ok(result.blockers.some((item) => item.includes("genetic_perturbation")));
});

test("a wet-lab mechanism pack requires matched prerequisites and human release", () => {
  const result = assessMethodFit(
    WET_LAB_TARGET_MEDIATION_TEMPLATE_V1,
    {
      questionType: "mechanism_test",
      intendedClaimType: "compound_target_phenotype_mechanism",
      requiredEvidenceComponents: [
        "identity_and_exposure",
        "binding_or_engagement",
        "functional_mediation",
        "concentration_compatibility",
        "phenotype_readout",
      ],
      contextTags: ["animal"],
    },
    {
      prerequisiteIds: [
        "defined_intervention",
        "validated_model",
        "validated_reagents",
        "analysis_plan",
      ],
    },
  );

  assert.equal(result.fit, "not_fit");
  assert.ok(result.blockers.some((item) => item.includes("伦理批准")));
  assert.equal(result.humanReleaseRequired, true);
});

test("field inquiry can support a bounded landscape claim but not global prevalence", () => {
  const acceptable = assessMethodFit(
    FIELD_INQUIRY_METHOD_PACK_V1,
    {
      questionType: "field_orientation",
      intendedClaimType: "bounded_landscape_description",
      contextTags: [],
    },
    { prerequisiteIds: ["research_intent", "source_access"] },
  );
  const overclaim = assessMethodFit(
    FIELD_INQUIRY_METHOD_PACK_V1,
    {
      questionType: "field_orientation",
      intendedClaimType: "global_prevalence",
      contextTags: [],
    },
    { prerequisiteIds: ["research_intent", "source_access"] },
  );

  assert.equal(acceptable.fit, "conditional");
  assert.equal(overclaim.fit, "not_fit");
});

test("source, version, parameters, and validation type are mandatory provenance fields", () => {
  const invalid = structuredClone(FIELD_INQUIRY_METHOD_PACK_V1);
  invalid.provenanceContract.requiredRecords = ["sourceLocator"];
  const issues = validateMethodPack(invalid);

  assert.ok(issues.includes("provenance must record protocolVersion"));
  assert.ok(issues.includes("provenance must record parameterSet"));
  assert.ok(issues.includes("provenance must record validationType"));
});
