/**
 * lib/tools/schemaRegistry.test.ts
 * Unit tests for the schema registry hash function.
 * Specifically tests the regression for the old bug: length+first-80-chars
 * hash that produced collisions for schemas with the same prefix.
 *
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest'
import { hashSchema, lookupSchema, saveSchema, getRegistrySize, asyncHashSchema } from './schemaRegistry'
import type { OrchestratorOutput } from '@/lib/types/agents'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// These two schemas have the same length and identical first 80 characters.
// They differ only in content after the 80th character.
// The OLD hash (length + first 80 chars) produced the SAME key for both.
// The NEW hash (full-content djb2) must produce DIFFERENT keys.
const BASE_PREFIX = '{"openapi":"3.0.3","info":{"title":"Test","version":"1.0.0"},"paths":{"/v1/us'
// Pad to ensure they're exactly the same for 80 chars, then diverge
const SCHEMA_A = BASE_PREFIX + 'ers":{"get":{"responses":{"200":{"description":"A"}}}}}}'
const SCHEMA_B = BASE_PREFIX + 'ers":{"get":{"responses":{"200":{"description":"B"}}}}}}'

// Verify they have the same length and same first 80 chars
// (the regression case from the review)
const LENGTH_MATCH = SCHEMA_A.length === SCHEMA_B.length
const PREFIX_MATCH = SCHEMA_A.slice(0, 80) === SCHEMA_B.slice(0, 80)

const MOCK_OUTPUT: OrchestratorOutput = {
  analystResult: {
    success: true,
    endpoints: [],
    rawFields: [],
    schemaType: 'openapi',
    hasVersionPrefix: true,
  },
  evaluatorResult: {
    success: true,
    violations: [],
    passedRules: ['All endpoints must require authentication'],
    unrecognizedRules: [],
    score: 100,
    summary: 'No violations found.',
  },
  recommendation: 'No action required.',
  auditedAt: '2026-07-15T00:00:00.000Z',
}

// ---------------------------------------------------------------------------
// Tests: collision regression
// ---------------------------------------------------------------------------

describe('hashSchema — collision resistance (regression for length+prefix bug)', () => {
  it('SCHEMA_A and SCHEMA_B have the same length and first 80 chars (precondition)', () => {
    // Confirm this IS the collision case that was broken before
    expect(LENGTH_MATCH).toBe(true)
    expect(PREFIX_MATCH).toBe(true)
  })

  it('produces DIFFERENT hashes for schemas with same prefix but different content', () => {
    const hashA = hashSchema(SCHEMA_A, [], 'medium')
    const hashB = hashSchema(SCHEMA_B, [], 'medium')
    // This would have been EQUAL under the old implementation — the critical regression test
    expect(hashA).not.toBe(hashB)
  })

  it('produces the SAME hash for identical inputs (deterministic)', () => {
    const hash1 = hashSchema(SCHEMA_A, ['rule one', 'rule two'], 'high')
    const hash2 = hashSchema(SCHEMA_A, ['rule one', 'rule two'], 'high')
    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different schemas', () => {
    const hash1 = hashSchema('{"openapi":"3.0.3"}', [], 'medium')
    const hash2 = hashSchema('{"openapi":"3.0.0"}', [], 'medium')
    expect(hash1).not.toBe(hash2)
  })

  it('produces different hashes for different business rules', () => {
    const hash1 = hashSchema(SCHEMA_A, ['auth required'], 'medium')
    const hash2 = hashSchema(SCHEMA_A, ['versioning required'], 'medium')
    expect(hash1).not.toBe(hash2)
  })

  it('is order-insensitive for business rules (rules are sorted before hashing)', () => {
    const hash1 = hashSchema(SCHEMA_A, ['rule A', 'rule B', 'rule C'], 'medium')
    const hash2 = hashSchema(SCHEMA_A, ['rule C', 'rule A', 'rule B'], 'medium')
    // Rules are sorted before hashing so order doesn't create false cache misses
    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different severity thresholds', () => {
    const hash1 = hashSchema(SCHEMA_A, [], 'low')
    const hash2 = hashSchema(SCHEMA_A, [], 'high')
    expect(hash1).not.toBe(hash2)
  })
})

// ---------------------------------------------------------------------------
// Tests: asyncHashSchema (Web Crypto SHA-256)
// ---------------------------------------------------------------------------

describe('asyncHashSchema — SHA-256 content hash', () => {
  it('produces different hashes for schemas with same prefix but different content', async () => {
    const hashA = await asyncHashSchema(SCHEMA_A, [], 'medium')
    const hashB = await asyncHashSchema(SCHEMA_B, [], 'medium')
    expect(hashA).not.toBe(hashB)
  })

  it('produces deterministic output for the same input', async () => {
    const hash1 = await asyncHashSchema(SCHEMA_A, ['auth rule'], 'high')
    const hash2 = await asyncHashSchema(SCHEMA_A, ['auth rule'], 'high')
    expect(hash1).toBe(hash2)
  })

  it('returns a 64-character hex string (SHA-256 output)', async () => {
    const hash = await asyncHashSchema(SCHEMA_A, [], 'medium')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// Tests: cache lookup and save
// ---------------------------------------------------------------------------

describe('schemaRegistry — lookupSchema and saveSchema', () => {
  it('returns null for a key that has not been stored', () => {
    const hash = hashSchema('{"brand":"new","schema":"here"}', [], 'medium')
    const result = lookupSchema(hash)
    expect(result).toBeNull()
  })

  it('returns the stored result after saveSchema', () => {
    const hash = hashSchema(SCHEMA_A + '_unique_for_save_test', ['my rule'], 'low')
    saveSchema(hash, MOCK_OUTPUT)
    const retrieved = lookupSchema(hash)
    expect(retrieved).not.toBeNull()
    expect(retrieved?.recommendation).toBe('No action required.')
  })

  it('registry size increases after saving', () => {
    const sizeBefore = getRegistrySize()
    const hash = hashSchema(SCHEMA_B + '_unique_for_size_test_' + Date.now(), [], 'high')
    saveSchema(hash, MOCK_OUTPUT)
    expect(getRegistrySize()).toBe(sizeBefore + 1)
  })
})
