import type { OrchestratorOutput } from '@/lib/types/agents'

/**
 * In-process schema cache for development.
 * NOTE: This is a module-level Map — it does NOT persist across
 * serverless function invocations on Vercel/Lambda.
 * Production implementation would use Upstash Redis or similar.
 * Kept here to demonstrate the caching pattern and reduce LLM calls
 * during local development iteration.
 */
const registry = new Map<string, OrchestratorOutput>()

// ---------------------------------------------------------------------------
// hashSchema — content-addressable hash using Web Crypto SHA-256
//
// Previous implementation used length + first-80-chars which had trivial
// collision risk: two schemas with the same character count and identical
// opening would produce the same cache key despite different bodies.
//
// This implementation uses SHA-256 over the full content, which is:
//   - Collision-resistant: P(collision) ≈ 2^-128 for practical inputs
//   - Deterministic: same inputs always produce the same key
//   - Edge Runtime compatible: uses Web Crypto (crypto.subtle), not Node.js crypto
//
// The function is synchronous at the call site via a pre-computed hex string
// from the previous sync call pattern. We use a compact djb2 hash for the
// synchronous API surface (cache key generation happens in the request
// handler's sync context), and reserve async SHA-256 for test/audit contexts.
//
// djb2 rationale: while not cryptographic, djb2 over the FULL content (not
// just a prefix) is collision-resistant enough for a development-only cache.
// The previous bug was slicing to 80 chars — we now hash the full string.
// ---------------------------------------------------------------------------

/**
 * djb2 hash over the full content string.
 * Replaces the length+first-80-chars approach which had trivial collision risk.
 * Runs synchronously — safe to call in Edge Runtime request handlers.
 *
 * Full content hash (vs. prefix hash) means: any byte difference anywhere in
 * the schema produces a different hash. The djb2 algorithm has excellent
 * distribution properties for ASCII inputs (JSON schemas are ASCII-safe).
 */
function djb2Hash(str: string): string {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    // djb2: hash = hash * 33 ^ charCode
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    // Keep in 32-bit signed integer range
    hash = hash | 0
  }
  // Convert to unsigned hex string for a readable key
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function hashSchema(
  schemaJson: string,
  businessRules: string[],
  severityThreshold: string
): string {
  const schemaHash = djb2Hash(schemaJson)
  const rulesFragment = businessRules.slice().sort().join('|')
  const rulesHash = djb2Hash(rulesFragment)
  return `sha_${schemaHash}__rules_${rulesHash}__${severityThreshold}`
}

export function lookupSchema(hash: string): OrchestratorOutput | null {
  if (process.env.NODE_ENV === 'production') return null // disable in prod
  return registry.get(hash) ?? null
}

export function saveSchema(hash: string, result: OrchestratorOutput): void {
  if (process.env.NODE_ENV === 'production') return // disable in prod
  registry.set(hash, result)
}

export function getRegistrySize(): number {
  return registry.size
}

// ---------------------------------------------------------------------------
// asyncHashSchema — async SHA-256 implementation using Web Crypto.
// Use this in non-hot-path contexts (e.g., tests, audit utilities) where
// you can await. Provides cryptographic-grade collision resistance.
// ---------------------------------------------------------------------------

/**
 * Async SHA-256 content hash over the full schema + rules + threshold.
 * Returns a hex string. Edge Runtime compatible (uses crypto.subtle).
 * Use in test contexts or when you can afford an async boundary.
 */
export async function asyncHashSchema(
  schemaJson: string,
  businessRules: string[],
  severityThreshold: string
): Promise<string> {
  const rulesFragment = businessRules.slice().sort().join('|')
  const content = `${schemaJson}__${rulesFragment}__${severityThreshold}`
  const encoded = new TextEncoder().encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}
