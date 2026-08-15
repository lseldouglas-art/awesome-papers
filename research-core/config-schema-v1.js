export const PI_RESEARCH_CONFIG_SCHEMA_VERSION = "1.0.0";

export const PI_RESEARCH_CONFIG_SCHEMA = Object.freeze({
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://pi-research-workbench.local/config/v1",
  title: "Pi Research Workbench configuration",
  type: "object",
  additionalProperties: false,
  properties: {
    dataDir: { type: "string", minLength: 1 },
    researcherId: { type: "string", minLength: 1, maxLength: 200 },
    ncbi: {
      type: "object",
      additionalProperties: false,
      properties: {
        email: { type: "string", format: "email" },
        tool: { type: "string", minLength: 1, maxLength: 100 },
        apiKeyEnv: { const: "NCBI_API_KEY" },
      },
    },
    agent: {
      type: "object",
      additionalProperties: false,
      properties: {
        mode: { enum: ["auto", "live", "guided"] },
        provider: { enum: ["openai", "anthropic"] },
        model: { type: "string", minLength: 1 },
      },
    },
  },
});

export function normalizeResearchConfig(value = {}) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    const error = new TypeError("科研包配置必须是对象。 ");
    error.code = "INVALID_RESEARCH_CONFIG";
    throw error;
  }
  return Object.freeze({
    schemaVersion: PI_RESEARCH_CONFIG_SCHEMA_VERSION,
    dataDir: value.dataDir ?? null,
    researcherId: value.researcherId ?? "local-researcher",
    ncbi: Object.freeze({
      email: value.ncbi?.email ?? null,
      tool: value.ncbi?.tool ?? "pi-research-workbench",
      apiKeyEnv: "NCBI_API_KEY",
    }),
    agent: Object.freeze({
      mode: value.agent?.mode ?? "auto",
      provider: value.agent?.provider ?? null,
      model: value.agent?.model ?? null,
    }),
  });
}
