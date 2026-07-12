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
export const ORCHESTRATOR_PROMPT_TOKEN_BUDGET = 350

/** Target max tokens for sub-agent system prompts. */
export const SUBAGENT_PROMPT_TOKEN_BUDGET = 500

// ---------------------------------------------------------------------------
// Default severity threshold
// ---------------------------------------------------------------------------

/** Default severity threshold used when no override is provided by the user. */
export const DEFAULT_SEVERITY_THRESHOLD = 'medium' as const satisfies 'low' | 'medium' | 'high'

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

/**
 * Orchestrator system prompt.
 * Kept under ORCHESTRATOR_PROMPT_TOKEN_BUDGET tokens.
 * The LLM is ONLY a router — it never touches raw data payloads.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `You are the Orchestrator agent for an API contract audit pipeline.

You have received a schema to audit. Call the tools in this exact sequence:

Step 1: Call runAnalystTool immediately. Pass { "ready": true }.
Step 2: After runAnalystTool returns its result, call runEvaluatorTool. Pass the endpointCount from Step 1.
Step 3: After runEvaluatorTool returns its result, call formatReportTool. Write a 1-2 sentence recommendation.

STRICT RULES:
- Call exactly ONE tool per response. Never call multiple tools at once.
- Use the native tool calling functionality. Do NOT output raw XML or text like <function=...>.
- Do NOT produce a summary or audit narrative. Call the tools to run the audit.
- If a tool returns an error field, explain what failed in plain text and stop.`

/**
 * Analyst sub-agent system prompt.
 * Instructs the model to immediately call its parseSchema tool.
 */
export const ANALYST_SYSTEM_PROMPT = `You are the Analyst sub-agent for an API contract audit pipeline.
Call the parseSchema tool immediately. Pass { "ready": true } as the argument.
Use the native tool calling API to execute the tool. Do NOT output raw XML tags.`

/**
 * Evaluator sub-agent system prompt.
 * Instructs the model to immediately call its validateRules tool.
 */
export const EVALUATOR_SYSTEM_PROMPT = `You are the Evaluator sub-agent for an API contract audit pipeline.
Call the validateRules tool immediately. Pass { "ready": true } as the argument.
Use the native tool calling API to execute the tool. Do NOT output raw XML tags.`

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
