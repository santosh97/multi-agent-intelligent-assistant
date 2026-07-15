/**
 * lib/tools/parseSchema.ts
 * Pure TypeScript tool — no LLM call.
 * Parses OpenAPI 3.x or plain JSON Schema and extracts structural metadata.
 *
 * Architecture:
 *   - executeParseSchema(): pure function, directly callable with no extra args
 *   - parseSchema: tool() wrapper registered with the AI SDK
 */
import { z } from 'zod'
import type { ParseSchemaToolResult, Endpoint } from '@/lib/types/agents'
import { EndpointSchema } from '@/lib/types/agents'
import { isRecord, hasVersionInPath } from '@/lib/utils/helpers'

// ---------------------------------------------------------------------------
// Helpers — pure functions, no side effects
// ---------------------------------------------------------------------------



function detectSchemaType(
  parsed: Record<string, unknown>
): 'openapi' | 'json-schema' | 'unknown' {
  if (typeof parsed['openapi'] === 'string' && parsed['paths']) return 'openapi'
  if (parsed['$schema'] !== undefined || parsed['properties'] !== undefined)
    return 'json-schema'
  return 'unknown'
}



function extractOpenApiEndpoints(parsed: Record<string, unknown>): Endpoint[] {
  const endpoints: Endpoint[] = []
  const paths = parsed['paths']
  if (!isRecord(paths)) return endpoints

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue

    const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!isRecord(operation)) continue

      // Extract parameters
      const rawParams = operation['parameters']
      const params: Array<{ name: string }> = []
      if (Array.isArray(rawParams)) {
        for (const p of rawParams) {
          if (isRecord(p) && typeof p['name'] === 'string') {
            params.push({ name: p['name'] })
          }
        }
      }

      // Detect auth requirement (security at operation or root level)
      const opSecurity = operation['security']
      const rootSecurity = parsed['security']
      const hasSecurity =
        Array.isArray(opSecurity)
          ? opSecurity.length > 0
          : Array.isArray(rootSecurity)
            ? rootSecurity.length > 0
            : false

      // Detect response schema presence
      const responses = operation['responses']
      let hasResponseSchema = false
      if (isRecord(responses)) {
        for (const resp of Object.values(responses)) {
          if (isRecord(resp) && isRecord(resp['content'])) {
            hasResponseSchema = true
            break
          }
        }
      }

      // Detect nullable fields in requestBody
      let isNullable = false
      const reqBody = operation['requestBody']
      if (isRecord(reqBody) && isRecord(reqBody['content'])) {
        for (const mediaType of Object.values(reqBody['content'])) {
          if (
            isRecord(mediaType) &&
            isRecord(mediaType['schema']) &&
            isRecord(mediaType['schema']['properties'])
          ) {
            for (const propDef of Object.values(mediaType['schema']['properties'])) {
              if (isRecord(propDef) && propDef['nullable'] === true) {
                isNullable = true
              }
            }
          }
        }
      }

      const endpointRaw = {
        path,
        method: method.toUpperCase(),
        params,
        hasAuth: hasSecurity,
        hasResponseSchema,
        isNullable,
      }
      const parseResult = EndpointSchema.safeParse(endpointRaw)
      if (parseResult.success) {
        endpoints.push(parseResult.data)
      }
    }
  }
  return endpoints
}

function extractJsonSchemaFields(parsed: Record<string, unknown>): string[] {
  const fields: string[] = []
  function walk(obj: unknown, prefix = ''): void {
    if (!isRecord(obj)) return
    const props = obj['properties']
    if (isRecord(props)) {
      for (const [key, val] of Object.entries(props)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        fields.push(fullKey)
        walk(val, fullKey)
      }
    }
  }
  walk(parsed)
  return fields
}

function extractRawFields(parsed: Record<string, unknown>): string[] {
  return Object.keys(parsed)
}

function checkVersionPrefix(parsed: Record<string, unknown>): boolean {
  const paths = parsed['paths']
  if (!isRecord(paths)) return false
  return Object.keys(paths).some(hasVersionInPath)
}

// ---------------------------------------------------------------------------
// Pure function — directly callable without the AI SDK ToolExecutionOptions
// ---------------------------------------------------------------------------

export type ParseSchemaInput = z.infer<typeof parseSchemaParameters>

const parseSchemaParameters = z.object({
  schemaJson: z.string().min(1, 'Schema JSON must not be empty'),
  strictMode: z.boolean().default(true),
})

export async function executeParseSchema(
  args: ParseSchemaInput
): Promise<ParseSchemaToolResult> {
  let parsed: unknown
  try {
    parsed = JSON.parse(args.schemaJson)
  } catch {
    throw new Error('Invalid JSON: could not parse the provided schema string.')
  }

  if (!isRecord(parsed)) {
    throw new Error('Schema must be a JSON object, not an array or primitive.')
  }

  const schemaType = detectSchemaType(parsed)

  // strictMode is load-bearing: if the LLM assessed the schema as a known type
  // (openapi or json-schema) but the parser cannot confirm it, strict mode
  // surfaces an error rather than silently returning empty results.
  // In lenient mode (strictMode = false), unknown schemas degrade gracefully.
  if (schemaType === 'unknown' && args.strictMode) {
    return {
      success: false,
      endpoints: [],
      rawFields: extractRawFields(parsed),
      schemaType: 'unknown',
      hasVersionPrefix: false,
      error:
        'Schema type could not be determined. Provide a valid OpenAPI 3.x document ' +
        '(with an "openapi" key and "paths") or a JSON Schema (with "$schema" or "properties").',
    }
  }

  const endpoints =
    schemaType === 'openapi' ? extractOpenApiEndpoints(parsed) : []
  const rawFields =
    schemaType === 'json-schema'
      ? extractJsonSchemaFields(parsed)
      : extractRawFields(parsed)
  const hasVersionPrefix =
    schemaType === 'openapi' ? checkVersionPrefix(parsed) : false

  return {
    success: true,
    endpoints,
    rawFields,
    schemaType,
    hasVersionPrefix,
  }
}

// ---------------------------------------------------------------------------
// AI SDK tool wrapper — passed to generateText({ tools: { parseSchema } })
// ---------------------------------------------------------------------------
export const parseSchema = {
  description:
    'Parses an OpenAPI 3.x or JSON Schema document and extracts endpoint metadata, field names, auth coverage, and structural properties needed for compliance checking.',
  inputSchema: parseSchemaParameters,
  execute: executeParseSchema,
}
