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

export function hashSchema(
  schemaJson: string,
  businessRules: string[],
  severityThreshold: string
): string {
  const schemaFragment = String(schemaJson.length) + '_' + schemaJson.slice(0, 80).replace(/\s/g, '')
  const rulesFragment = businessRules.slice().sort().join('|')
  return `${schemaFragment}__${rulesFragment}__${severityThreshold}`
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
