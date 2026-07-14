/**
 * lib/tools/validateRules.test.ts
 * Unit tests for executeValidateRules() — the pure TypeScript compliance engine.
 * These tests run without any LLM calls, network requests, or external deps.
 *
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest'
import { executeValidateRules } from './validateRules'
import type { ValidateRulesInput } from './validateRules'
import { BUILT_IN_RULE_NAMES } from '@/lib/config/constants'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const OPENAPI_ANALYST_RESULT: ValidateRulesInput['analysisResult'] = {
  success: true,
  schemaType: 'openapi',
  hasVersionPrefix: false,
  endpoints: [
    {
      path: '/users',
      method: 'GET',
      params: [],
      hasAuth: false,
      hasResponseSchema: true,
      isNullable: false,
    },
    {
      path: '/v1/products',
      method: 'POST',
      params: [],
      hasAuth: true,
      hasResponseSchema: false,
      isNullable: true,
    },
  ],
  rawFields: ['openapi', 'info', 'paths'],
}

const FULLY_COMPLIANT_RESULT: ValidateRulesInput['analysisResult'] = {
  success: true,
  schemaType: 'openapi',
  hasVersionPrefix: true,
  endpoints: [
    {
      path: '/v1/users',
      method: 'GET',
      params: [],
      hasAuth: true,
      hasResponseSchema: true,
      isNullable: false,
    },
  ],
  rawFields: ['openapi', 'info', 'paths', 'security'],
}

const EMPTY_ENDPOINTS_RESULT: ValidateRulesInput['analysisResult'] = {
  success: true,
  schemaType: 'openapi',
  hasVersionPrefix: false,
  endpoints: [],
  rawFields: ['openapi'],
}

const JSON_SCHEMA_RESULT: ValidateRulesInput['analysisResult'] = {
  success: true,
  schemaType: 'json-schema',
  hasVersionPrefix: false,
  endpoints: [],
  rawFields: ['name', 'address', 'address.street'],
}

const UNKNOWN_SCHEMA_RESULT: ValidateRulesInput['analysisResult'] = {
  success: true,
  schemaType: 'unknown',
  hasVersionPrefix: false,
  endpoints: [],
  rawFields: ['randomKey'],
}

// ---------------------------------------------------------------------------
// Tests: all built-in rules fire correctly
// ---------------------------------------------------------------------------

describe('executeValidateRules — auth required rule', () => {
  it('flags endpoints without auth as violations', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['All endpoints must require authentication'],
      severityThreshold: 'low',
    })
    expect(result.success).toBe(true)
    const authViolations = result.violations.filter(
      (v) => v.rule === BUILT_IN_RULE_NAMES.AUTH_REQUIRED
    )
    expect(authViolations.length).toBeGreaterThan(0)
    expect(authViolations[0]?.field).toContain('/users')
  })

  it('does not flag endpoints that have auth', async () => {
    const result = await executeValidateRules({
      analysisResult: FULLY_COMPLIANT_RESULT,
      businessRules: ['All endpoints must require authentication'],
      severityThreshold: 'low',
    })
    const authViolations = result.violations.filter(
      (v) => v.rule === BUILT_IN_RULE_NAMES.AUTH_REQUIRED
    )
    expect(authViolations).toHaveLength(0)
  })
})

describe('executeValidateRules — version prefix rule', () => {
  it('flags paths without version prefix', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['All paths must include an API version prefix'],
      severityThreshold: 'low',
    })
    const versionViolations = result.violations.filter(
      (v) => v.rule === BUILT_IN_RULE_NAMES.VERSION_PREFIX
    )
    // /users has no version prefix, /v1/products does
    expect(versionViolations.length).toBeGreaterThan(0)
    expect(versionViolations.some((v) => v.field === '/users')).toBe(true)
  })
})

describe('executeValidateRules — nullable fields rule', () => {
  it('flags endpoints with nullable requestBody fields', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['No nullable fields without a default value'],
      severityThreshold: 'low',
    })
    const nullableViolations = result.violations.filter(
      (v) => v.rule === BUILT_IN_RULE_NAMES.NO_NULLABLE
    )
    expect(nullableViolations.length).toBeGreaterThan(0)
  })
})

describe('executeValidateRules — response schema rule', () => {
  it('flags endpoints without response content schema', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['All endpoints must return a defined response schema'],
      severityThreshold: 'low',
    })
    const responseViolations = result.violations.filter(
      (v) => v.rule === BUILT_IN_RULE_NAMES.RESPONSE_SCHEMA
    )
    expect(responseViolations.length).toBeGreaterThan(0)
    expect(responseViolations.some((v) => v.field.includes('/v1/products'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: severity threshold filtering
// ---------------------------------------------------------------------------

describe('executeValidateRules — severity threshold', () => {
  it('filters out violations below severity threshold', async () => {
    // Auth violations are HIGH severity; filtering at HIGH should include them
    const highResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'high',
    })

    // Filtering at LOW should include everything
    const lowResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })

    expect(lowResult.violations.length).toBeGreaterThanOrEqual(highResult.violations.length)
  })

  it('high threshold only surfaces high-severity violations', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'high',
    })
    for (const violation of result.violations) {
      expect(violation.severity).toBe('high')
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: passedRules only includes checked rules
// ---------------------------------------------------------------------------

describe('executeValidateRules — passedRules', () => {
  it('fully compliant schema has no violations and all rules passed', async () => {
    const result = await executeValidateRules({
      analysisResult: FULLY_COMPLIANT_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    expect(result.violations).toHaveLength(0)
    expect(result.passedRules.length).toBeGreaterThan(0)
    expect(result.score).toBe(100)
  })

  it('passedRules does not include rules that had violations', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    const violatedRules = new Set(result.violations.map((v) => v.rule))
    for (const passed of result.passedRules) {
      expect(violatedRules.has(passed)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Tests: unrecognized rules
// ---------------------------------------------------------------------------

describe('executeValidateRules — unrecognized rules', () => {
  it('places unrecognized rule strings in unrecognizedRules array', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['Some custom rule that nobody knows about'],
      severityThreshold: 'medium',
    })
    expect(result.unrecognizedRules).toContain('Some custom rule that nobody knows about')
  })

  it('falls back to all checks when no rules are recognized', async () => {
    // When businessRules has entries but none match, all built-in checks run
    const noRulesResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: ['completely unrecognized rule'],
      severityThreshold: 'low',
    })
    const allRulesResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    // Both should run the same number of checks (all of them)
    expect(noRulesResult.violations.length).toBe(allRulesResult.violations.length)
  })
})

// ---------------------------------------------------------------------------
// Tests: JSON Schema and unknown type return N/A result
// ---------------------------------------------------------------------------

describe('executeValidateRules — non-OpenAPI schemas', () => {
  it('returns N/A result for json-schema type (no endpoints to check)', async () => {
    const result = await executeValidateRules({
      analysisResult: JSON_SCHEMA_RESULT,
      businessRules: [],
      severityThreshold: 'medium',
    })
    expect(result.success).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(result.summary).toContain('JSON Schema')
  })

  it('returns N/A result for unknown schema type', async () => {
    const result = await executeValidateRules({
      analysisResult: UNKNOWN_SCHEMA_RESULT,
      businessRules: [],
      severityThreshold: 'medium',
    })
    expect(result.success).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(result.summary).toContain('Unknown schema')
  })
})

// ---------------------------------------------------------------------------
// Tests: score computation
// ---------------------------------------------------------------------------

describe('executeValidateRules — score computation', () => {
  it('fully compliant schema scores 100', async () => {
    const result = await executeValidateRules({
      analysisResult: FULLY_COMPLIANT_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    expect(result.score).toBe(100)
  })

  it('score is between 0 and 100 inclusive', async () => {
    const result = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(result.score).toBeLessThanOrEqual(100)
  })

  it('score decreases as more violations are found', async () => {
    const highResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'high',
    })
    const lowResult = await executeValidateRules({
      analysisResult: OPENAPI_ANALYST_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    // More violations (low threshold) should produce equal or lower score
    expect(lowResult.score).toBeLessThanOrEqual(highResult.score)
  })

  it('vacuous pass: empty endpoints produce score 100', async () => {
    const result = await executeValidateRules({
      analysisResult: EMPTY_ENDPOINTS_RESULT,
      businessRules: [],
      severityThreshold: 'low',
    })
    // An OpenAPI schema with 0 endpoints passes all checks vacuously
    // (no endpoint to violate any rule)
    expect(result.score).toBe(100)
  })
})
