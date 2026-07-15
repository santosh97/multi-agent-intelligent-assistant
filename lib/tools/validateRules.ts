/**
 * lib/tools/validateRules.ts
 * Pure TypeScript compliance rule engine — no LLM calls.
 * Checks AnalystResult against business rules and produces a scored report.
 *
 * Architecture:
 *   - executeValidateRules(): pure function, directly callable
 *   - validateRules: tool() wrapper registered with the AI SDK
 */
import { z } from 'zod'
import type { ValidateRulesToolResult, Violation } from '@/lib/types/agents'
import { AnalystResultSchema, ViolationSchema } from '@/lib/types/agents'
import {
  BUILT_IN_RULE_NAMES,
  RULE_KEYWORDS,
} from '@/lib/config/constants'
import type { BuiltInRuleName } from '@/lib/config/constants'

// ---------------------------------------------------------------------------
// Built-in rule checks
// ---------------------------------------------------------------------------

interface RuleCheckContext {
  analysisResult: z.infer<typeof AnalystResultSchema>
  severityThreshold: 'low' | 'medium' | 'high'
}

type RuleCheck = (ctx: RuleCheckContext) => Violation[]

const SEVERITY_ORDER: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function meetsSeverityThreshold(
  violationSeverity: 'low' | 'medium' | 'high',
  threshold: 'low' | 'medium' | 'high'
): boolean {
  return SEVERITY_ORDER[violationSeverity] >= SEVERITY_ORDER[threshold]
}

function safeViolation(raw: unknown): Violation | null {
  const result = ViolationSchema.safeParse(raw)
  return result.success ? result.data : null
}

// Rule: All endpoints must require authentication
const checkAuthRequired: RuleCheck = ({ analysisResult }) => {
  const violations: Violation[] = []
  for (const endpoint of analysisResult.endpoints) {
    if (endpoint.hasAuth === false) {
      const v = safeViolation({
        rule: BUILT_IN_RULE_NAMES.AUTH_REQUIRED,
        field: `${endpoint.method} ${endpoint.path}`,
        severity: 'high',
        description: `Endpoint ${endpoint.method} ${endpoint.path} has no security scheme defined.`,
        suggestion:
          'Add a security requirement at the operation level (e.g., BearerAuth, ApiKeyAuth) or define a global security scheme.',
      })
      if (v) violations.push(v)
    }
  }
  return violations
}

// Rule: All paths must include an API version prefix (e.g., /v1/)
const checkVersionPrefix: RuleCheck = ({ analysisResult }) => {
  if (analysisResult.schemaType !== 'openapi') return []
  const violations: Violation[] = []
  const checkedPaths = new Set<string>()
  for (const endpoint of analysisResult.endpoints) {
    if (checkedPaths.has(endpoint.path)) continue
    checkedPaths.add(endpoint.path)
    if (!/\/v\d+/i.test(endpoint.path)) {
      const v = safeViolation({
        rule: BUILT_IN_RULE_NAMES.VERSION_PREFIX,
        field: endpoint.path,
        severity: 'medium',
        description: `Path "${endpoint.path}" does not include a version prefix like /v1/ or /v2/.`,
        suggestion:
          'Prefix all paths with a version segment, e.g., /v1/users instead of /users.',
      })
      if (v) violations.push(v)
    }
  }
  return violations
}

// Rule: No nullable fields without a default value
const checkNullableFields: RuleCheck = ({ analysisResult }) => {
  const violations: Violation[] = []
  const checkedPaths = new Set<string>()
  for (const endpoint of analysisResult.endpoints) {
    if (checkedPaths.has(endpoint.path)) continue
    checkedPaths.add(endpoint.path)
    if (endpoint.isNullable === true) {
      const v = safeViolation({
        rule: BUILT_IN_RULE_NAMES.NO_NULLABLE,
        field: `${endpoint.method} ${endpoint.path} requestBody`,
        severity: 'medium',
        description: `Request body of ${endpoint.method} ${endpoint.path} contains nullable fields without default values.`,
        suggestion:
          'Add a default value to nullable fields or replace nullable: true with oneOf: [{type: "null"}, ...] with a default.',
      })
      if (v) violations.push(v)
    }
  }
  return violations
}

// Rule: All endpoints must return a defined response schema
const checkResponseSchema: RuleCheck = ({ analysisResult }) => {
  const violations: Violation[] = []
  for (const endpoint of analysisResult.endpoints) {
    if (endpoint.hasResponseSchema === false) {
      const v = safeViolation({
        rule: BUILT_IN_RULE_NAMES.RESPONSE_SCHEMA,
        field: `${endpoint.method} ${endpoint.path}`,
        severity: 'medium',
        description: `Endpoint ${endpoint.method} ${endpoint.path} has no response content schema defined.`,
        suggestion:
          'Define content schemas for 200/201 responses using application/json media type with a $ref or inline schema.',
      })
      if (v) violations.push(v)
    }
  }
  return violations
}

// Rule: Only standard HTTP methods
const checkHttpMethods: RuleCheck = ({ analysisResult }) => {
  const STANDARD_METHODS = new Set([
    'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS',
  ])
  const violations: Violation[] = []
  for (const endpoint of analysisResult.endpoints) {
    if (!STANDARD_METHODS.has(endpoint.method.toUpperCase())) {
      const v = safeViolation({
        rule: BUILT_IN_RULE_NAMES.HTTP_METHODS,
        field: `${endpoint.method} ${endpoint.path}`,
        severity: 'low',
        description: `Non-standard HTTP method "${endpoint.method}" used at ${endpoint.path}.`,
        suggestion:
          'Use only standard HTTP methods: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.',
      })
      if (v) violations.push(v)
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// User-defined rule matcher
// ---------------------------------------------------------------------------

// Map from BuiltInRuleName → its RuleCheck function (derived from constants)
const RULE_CHECK_MAP: Record<BuiltInRuleName, RuleCheck> = {
  [BUILT_IN_RULE_NAMES.AUTH_REQUIRED]: checkAuthRequired,
  [BUILT_IN_RULE_NAMES.VERSION_PREFIX]: checkVersionPrefix,
  [BUILT_IN_RULE_NAMES.NO_NULLABLE]: checkNullableFields,
  [BUILT_IN_RULE_NAMES.RESPONSE_SCHEMA]: checkResponseSchema,
  [BUILT_IN_RULE_NAMES.HTTP_METHODS]: checkHttpMethods,
}



function matchUserRulesToBuiltIn(userRules: string[]): { checks: RuleCheck[]; checkedRuleNames: BuiltInRuleName[]; unrecognized: string[] } {
  const matched = new Map<BuiltInRuleName, RuleCheck>()
  const unrecognized: string[] = []
  for (const rule of userRules) {
    const lowerRule = rule.toLowerCase()
    let found = false
    for (const [name, keywords] of Object.entries(RULE_KEYWORDS) as [BuiltInRuleName, string[]][]) {
      if (keywords.some((kw) => lowerRule.includes(kw))) {
        matched.set(name, RULE_CHECK_MAP[name])
        found = true
      }
    }
    if (!found) {
      unrecognized.push(rule)
    }
  }
  if (matched.size === 0) {
    // No recognized rules — fall back to all checks
    const allEntries = Object.entries(RULE_CHECK_MAP) as [BuiltInRuleName, RuleCheck][]
    return {
      checks: allEntries.map(([, check]) => check),
      checkedRuleNames: allEntries.map(([name]) => name),
      unrecognized,
    }
  }
  return {
    checks: Array.from(matched.values()),
    checkedRuleNames: Array.from(matched.keys()),
    unrecognized,
  }
}

function computeScore(totalRules: number, violationsCount: number): number {
  if (totalRules === 0) return 100
  const passing = Math.max(0, totalRules - violationsCount)
  return Math.round((passing / totalRules) * 100)
}

// ---------------------------------------------------------------------------
// Parameters schema
// ---------------------------------------------------------------------------
export const validateRulesParameters = z.object({
  analysisResult: AnalystResultSchema,
  businessRules: z.array(z.string()),
  severityThreshold: z.enum(['low', 'medium', 'high']).default('medium'),
})

export type ValidateRulesInput = z.infer<typeof validateRulesParameters>

// ---------------------------------------------------------------------------
// Pure function — directly callable without the AI SDK ToolExecutionOptions
// ---------------------------------------------------------------------------

export async function executeValidateRules(
  args: ValidateRulesInput
): Promise<ValidateRulesToolResult> {
  const parsed = AnalystResultSchema.safeParse(args.analysisResult)
  if (!parsed.success) {
    throw new Error('Failed to validate: analysisResult did not match expected schema — ' + parsed.error.flatten().toString())
  }

  if (!parsed.data.success) {
    throw new Error(parsed.data.error ?? 'Unknown analysis error')
  }

  // JSON Schema documents (and empty/unknown objects) have no endpoint structure — endpoint-level rules
  // (auth, version prefix, response schema, HTTP methods) are not applicable. Return a clear N/A result
  // rather than a vacuous 100/100 PASS that implies every rule passed.
  if (parsed.data.schemaType === 'json-schema' || parsed.data.schemaType === 'unknown') {
    const isUnknown = parsed.data.schemaType === 'unknown'
    const fieldCount = parsed.data.rawFields.length
    return {
      success: true,
      violations: [],
      passedRules: [],
      unrecognizedRules: [],
      score: 0,
      summary: isUnknown
        ? `Unknown schema format detected. No endpoints or JSON Schema properties found. Submit a valid OpenAPI 3.x document to run the audit.`
        : `JSON Schema detected — endpoint-level compliance rules do not apply. ` +
          `${fieldCount} field${fieldCount !== 1 ? 's' : ''} found. ` +
          `Submit an OpenAPI 3.x document to run the full audit pipeline.`,
    }
  }

  const ctx: RuleCheckContext = {
    analysisResult: parsed.data,
    severityThreshold: args.severityThreshold,
  }


  const allRuleNames = Object.values(BUILT_IN_RULE_NAMES)

  const { checks: checksToRun, checkedRuleNames, unrecognized: unrecognizedRules } = args.businessRules.length > 0
    ? matchUserRulesToBuiltIn(args.businessRules)
    : {
        checks: Object.values(RULE_CHECK_MAP),
        checkedRuleNames: allRuleNames,
        unrecognized: [] as string[],
      }

  const allViolations: Violation[] = []
  for (const check of checksToRun) {
    const found = check(ctx)
    allViolations.push(...found)
  }

  const filteredViolations = allViolations.filter((v) =>
    meetsSeverityThreshold(v.severity, args.severityThreshold)
  )

  // passedRules: only rules that were actually checked and had no violations above threshold
  const violatedRuleNames = new Set(filteredViolations.map((v) => v.rule))
  const passedRules = checkedRuleNames.filter(
    (r) => !violatedRuleNames.has(r)
  )

  // Score: ratio of passing checked rules (not all 5 rules)
  const score = computeScore(checkedRuleNames.length, violatedRuleNames.size)

  const endpointCount = parsed.data.endpoints.length
  const summary =
    `Audited ${endpointCount} endpoint${endpointCount !== 1 ? 's' : ''}. ` +
    `Checked ${checkedRuleNames.length} rule${checkedRuleNames.length !== 1 ? 's' : ''}. ` +
    `Found ${filteredViolations.length} violation${filteredViolations.length !== 1 ? 's' : ''} ` +
    `(threshold: ${args.severityThreshold}). Compliance score: ${score}/100.`

  return {
    success: true,
    violations: filteredViolations,
    passedRules,
    unrecognizedRules,
    score,
    summary,
  }
}

// ---------------------------------------------------------------------------
// AI SDK tool wrapper — passed to generateText({ tools: { validateRules } })
// ---------------------------------------------------------------------------
export const validateRules = {
  description:
    'Checks an AnalystResult against a set of business rules and returns a scored compliance report with violations, passed rules, and a summary.',
  inputSchema: validateRulesParameters,
  execute: async (args: ValidateRulesInput) => executeValidateRules(args),
}
