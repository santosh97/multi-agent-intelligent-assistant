/**
 * lib/config/constants.ts
 * Central registry of all application-level constants.
 * System prompts, token budgets, defaults, and rule keywords all live here.
 *
 * Why a constants file?
 *   - Prevents "magic strings" scattered across agent and tool files.
 *   - Makes prompt engineering a single-file concern.
 *   - Easier to tune performance without touching business logic.
 */

// ---------------------------------------------------------------------------
// Agent step limits
// ---------------------------------------------------------------------------

/** Maximum steps the Orchestrator LLM is allowed to take before halting. */
export const ORCHESTRATOR_MAX_STEPS = 10

/** Maximum steps each sub-agent (Analyst, Evaluator) may take. */
export const SUBAGENT_MAX_STEPS = 3

// ---------------------------------------------------------------------------
// Token budgets (informational, enforced via system prompt discipline)
// ---------------------------------------------------------------------------

/** Target max tokens for the Orchestrator system prompt. */
export const ORCHESTRATOR_PROMPT_TOKEN_BUDGET = 400

/** Target max tokens for sub-agent system prompts. */
export const SUBAGENT_PROMPT_TOKEN_BUDGET = 600

// ---------------------------------------------------------------------------
// Default severity threshold
// ---------------------------------------------------------------------------

/** Default severity threshold used when no override is provided by the user. */
export const DEFAULT_SEVERITY_THRESHOLD = 'medium' as const satisfies 'low' | 'medium' | 'high'

// ---------------------------------------------------------------------------
// Schema excerpt length for sub-agent context
// ---------------------------------------------------------------------------

/**
 * Maximum characters of the raw schema JSON sent to the Analyst LLM.
 * The full schema is processed by the deterministic parseSchema tool;
 * this excerpt is only used to give the LLM enough context to reason
 * about the schema's structure before deciding how to invoke the tool.
 */
export const ANALYST_SCHEMA_EXCERPT_LENGTH = 2000

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

/**
 * Orchestrator system prompt.
 * Balances goal-driven framing with explicit ordering constraints.
 *
 * Why ordering is explicit (not just goal-driven):
 *   Without explicit sequential constraints, smaller models (8b) attempt to
 *   call all three tools simultaneously or out of order, breaking the pipeline.
 *   The constraint is enforced at the closure level too (guard checks), but
 *   the prompt-level ordering prevents wasted LLM calls and latency.
 *
 * Why it's still goal-driven (not just a script):
 *   The orchestrator can adapt if the pipeline fails at any step, explaining
 *   the failure and stopping rather than blindly continuing a 3-step script.
 *   Tool descriptions (not just the prompt) guide reasoning.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Orchestrator agent for an API contract audit pipeline.

Your goal: produce a complete, evidence-based API contract audit report by calling your tools in strict sequence.

MANDATORY EXECUTION ORDER — call one tool at a time, wait for each result, then call the next:
1. Call runAnalystTool first. It parses the schema and extracts endpoint metadata.
2. After runAnalystTool succeeds, call runEvaluatorTool. It validates endpoints against business rules.
3. After runEvaluatorTool succeeds, call formatReportTool. Write a specific, evidence-based recommendation referencing the actual violations found (e.g., "2 of 2 endpoints lack authentication - add BearerAuth at the operation level").

STRICT RULES:
- Call exactly ONE tool per response. NEVER call two or more tools in the same response.
- Wait for a tool's result before calling the next tool.
- Use the native tool calling functionality. Do NOT output raw XML or text like <function=...>.
- Do NOT produce a narrative or summary until all three tools have completed.
- If a tool returns an error field, explain what failed in plain text and stop immediately.`

/**
 * Analyst sub-agent system prompt.
 * Goal-driven: the LLM receives a schema excerpt and must assess the schema's
 * structural characteristics before calling parseSchema. The LLM's assessment
 * (schemaType, estimatedEndpointCount, hasGlobalAuth) is used as tool args and
 * informs how the tool executes — making the LLM call genuinely meaningful.
 */
export const ANALYST_SYSTEM_PROMPT = `You are the Analyst sub-agent for an API contract audit pipeline.

You will receive a schema excerpt. Your job is to:
1. Read the schema excerpt carefully.
2. Identify the schema type: "openapi" if it has an "openapi" key and "paths", "json-schema" if it has "$schema" or "properties" at the root, or "unknown" otherwise.
3. Count the number of distinct endpoint paths visible in the excerpt (approximate is fine).
4. Determine whether the schema appears to define a global security requirement (look for a top-level "security" array).
5. Call the parseSchema tool with your assessed values.

The tool will use your assessment to confirm schema type detection and set processing strategy.
Use the native tool calling API. Do NOT output XML tags.`

/**
 * Evaluator sub-agent system prompt.
 * Goal-driven: the LLM receives the analyst result summary and business rules,
 * reasons about which rules are most critical for this schema type, and calls
 * validateRules with its assessed priority rules and risk level.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are the Evaluator sub-agent for an API contract audit pipeline.

You will receive a summary of the analyst's findings and the business rules to enforce.

Your job is to:
1. Read the analyst summary carefully: note the schema type, endpoint count, and any auth findings.
2. Read the business rules. Identify which rules are most critical given what you know about this schema.
3. Assess the overall risk level: "high" if auth or versioning issues are likely, "medium" for schema/response issues, "low" if the schema appears well-structured.
4. Call the validateRules tool with the priority rules you identified and your risk assessment.

The tool will use your prioritized rule list to determine rule execution order and flag high-risk areas first.
Use the native tool calling API. Do NOT output XML tags.`

// ---------------------------------------------------------------------------
// Built-in compliance rule metadata
// ---------------------------------------------------------------------------

/**
 * Canonical names for all built-in compliance rules.
 * These are the keys used in passedRules and violation.rule fields.
 * Changing these names here automatically updates the entire system.
 */
export const BUILT_IN_RULE_NAMES = {
  AUTH_REQUIRED: 'All endpoints must require authentication',
  VERSION_PREFIX: 'All paths must include an API version prefix',
  NO_NULLABLE: 'No nullable fields without a default value',
  RESPONSE_SCHEMA: 'All endpoints must return a defined response schema',
  HTTP_METHODS: 'Only standard HTTP methods allowed',
} as const

export type BuiltInRuleName = typeof BUILT_IN_RULE_NAMES[keyof typeof BUILT_IN_RULE_NAMES]

/**
 * Keyword triggers that map a user's business rule string to a built-in check.
 * Add synonyms here without touching the rule logic.
 */
export const RULE_KEYWORDS: Record<BuiltInRuleName, string[]> = {
  [BUILT_IN_RULE_NAMES.AUTH_REQUIRED]: ['auth', 'authentication', 'security', 'bearer', 'token', '401'],
  [BUILT_IN_RULE_NAMES.VERSION_PREFIX]: ['version', 'versioning', '/v1', '/v2', 'prefix'],
  [BUILT_IN_RULE_NAMES.NO_NULLABLE]: ['nullable', 'null', 'default'],
  [BUILT_IN_RULE_NAMES.RESPONSE_SCHEMA]: ['response schema', 'response body', 'response content', 'return schema'],
  [BUILT_IN_RULE_NAMES.HTTP_METHODS]: ['http method', 'standard method'],
}

// ---------------------------------------------------------------------------
// Score thresholds
// ---------------------------------------------------------------------------

/** Score at or above which an audit is labelled PASS. */
export const SCORE_PASS_THRESHOLD = 80

/** Score at or above which an audit is labelled WARN (below = FAIL). */
export const SCORE_WARN_THRESHOLD = 50

// ---------------------------------------------------------------------------
// Default sample content (used in the UI)
// ---------------------------------------------------------------------------

export const DEFAULT_BUSINESS_RULES = [
  'All endpoints must require authentication',
  'All paths must include an API version prefix (e.g., /v1/)',
  'No nullable fields without a default value',
].join('\n')
