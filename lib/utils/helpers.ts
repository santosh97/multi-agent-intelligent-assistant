/**
 * lib/utils/helpers.ts
 * Global utility layer containing pure functions for type guards, regex parsing, and shared logic.
 */

// ---------------------------------------------------------------------------
// Type Guards
// ---------------------------------------------------------------------------

// Pure type guard for JavaScript objects
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isAnalystOutput(o: unknown): o is { endpointCount: number; thought?: string } {
  return typeof o === 'object' && o !== null && 'endpointCount' in o
}

export function isEvaluatorOutput(o: unknown): o is { score: number } {
  return typeof o === 'object' && o !== null && 'score' in o
}

export function hasError(o: unknown): o is { error: string } {
  return typeof o === 'object' && o !== null && 'error' in o &&
    typeof (o as Record<string, unknown>)['error'] === 'string'
}

// ---------------------------------------------------------------------------
// Pipeline Helpers
// ---------------------------------------------------------------------------

// Checks if an API endpoint path contains a version string (e.g., /v1/)
export function hasVersionInPath(path: string): boolean {
  return /\/v\d+/i.test(path)
}

// Safely checks if the output of a tool call indicates a schema cache hit
export function isToolCacheHit(toolName: string, output: unknown): boolean {
  return (
    toolName === 'runAnalystTool' &&
    isRecord(output) &&
    'cacheHit' in output &&
    output['cacheHit'] === true
  )
}

// ---------------------------------------------------------------------------
// Message Parsing
// ---------------------------------------------------------------------------

export function extractSchemaJson(content: string): string {
  const match = content.match(/```json\n?([\s\S]*?)\n?```/)
  return match?.[1]?.trim() ?? ''
}

export function extractBusinessRules(content: string): string[] {
  const match = content.match(/Business rules to enforce:\n([\s\S]*)$/)
  if (!match?.[1]) return []
  return match[1]
    .split('\n')
    .map(r => r.replace(/^[-*]\s*/, '').trim())
    .filter(r => r.length > 0)
}
