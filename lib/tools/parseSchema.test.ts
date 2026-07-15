/**
 * lib/tools/parseSchema.test.ts
 * Unit tests for executeParseSchema() — the pure TypeScript schema parser.
 * These tests run without any LLM calls, network requests, or external deps.
 *
 * Run with: npm test
 */
import { describe, it, expect } from 'vitest'
import { executeParseSchema } from './parseSchema'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const OPENAPI_WITH_AUTH = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Test API', version: '1.0.0' },
  security: [{ BearerAuth: [] }],
  paths: {
    '/v1/users': {
      get: {
        summary: 'List users',
        responses: {
          '200': {
            content: { 'application/json': { schema: { type: 'array' } } },
          },
        },
      },
    },
    '/v1/products': {
      post: {
        summary: 'Create product',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  price: { type: 'number', nullable: true },
                },
              },
            },
          },
        },
        responses: { '201': { content: { 'application/json': { schema: {} } } } },
      },
    },
  },
})

const OPENAPI_NO_AUTH_NO_VERSION = JSON.stringify({
  openapi: '3.0.3',
  info: { title: 'Unversioned API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        responses: { '200': {} }, // no content = no response schema
      },
    },
  },
})

const JSON_SCHEMA = JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema',
  type: 'object',
  properties: {
    name: { type: 'string' },
    address: {
      type: 'object',
      properties: {
        street: { type: 'string' },
        city: { type: 'string' },
      },
    },
  },
})

const UNKNOWN_SCHEMA = JSON.stringify({
  someRandomField: 'value',
  anotherField: 42,
})

// ---------------------------------------------------------------------------
// Tests: schema type detection
// ---------------------------------------------------------------------------

describe('executeParseSchema — schema type detection', () => {
  it('detects openapi schema correctly', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    expect(result.success).toBe(true)
    expect(result.schemaType).toBe('openapi')
  })

  it('detects json-schema correctly', async () => {
    const result = await executeParseSchema({ schemaJson: JSON_SCHEMA, strictMode: true })
    expect(result.success).toBe(true)
    expect(result.schemaType).toBe('json-schema')
  })

  it('returns success:false in strict mode for unrecognized schema format', async () => {
    const result = await executeParseSchema({ schemaJson: UNKNOWN_SCHEMA, strictMode: true })
    expect(result.success).toBe(false)
    expect(result.schemaType).toBe('unknown')
    expect(result.error).toMatch(/Schema type could not be determined/)
  })

  it('returns success:true in lenient mode for unrecognized schema format', async () => {
    const result = await executeParseSchema({ schemaJson: UNKNOWN_SCHEMA, strictMode: false })
    expect(result.success).toBe(true)
    expect(result.schemaType).toBe('unknown')
    expect(result.error).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Tests: endpoint extraction
// ---------------------------------------------------------------------------

describe('executeParseSchema — endpoint extraction', () => {
  it('extracts all endpoints from an OpenAPI schema', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    expect(result.endpoints).toHaveLength(2)
    const paths = result.endpoints.map((e) => e.path)
    expect(paths).toContain('/v1/users')
    expect(paths).toContain('/v1/products')
  })

  it('returns empty endpoints for json-schema', async () => {
    const result = await executeParseSchema({ schemaJson: JSON_SCHEMA, strictMode: true })
    expect(result.endpoints).toHaveLength(0)
  })

  it('returns empty endpoints for unknown schema', async () => {
    const result = await executeParseSchema({ schemaJson: UNKNOWN_SCHEMA, strictMode: true })
    expect(result.endpoints).toHaveLength(0)
  })

  it('returns empty endpoints when paths object is missing', async () => {
    const schema = JSON.stringify({ openapi: '3.0.3', info: { title: 'Empty' } })
    const result = await executeParseSchema({ schemaJson: schema, strictMode: true })
    expect(result.endpoints).toHaveLength(0)
  })

  it('returns empty endpoints when paths is an empty object', async () => {
    const schema = JSON.stringify({ openapi: '3.0.3', info: { title: 'Empty' }, paths: {} })
    const result = await executeParseSchema({ schemaJson: schema, strictMode: true })
    expect(result.endpoints).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests: authentication detection
// ---------------------------------------------------------------------------

describe('executeParseSchema — authentication detection', () => {
  it('marks endpoint as authenticated when root-level security is set', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    const usersEndpoint = result.endpoints.find((e) => e.path === '/v1/users')
    expect(usersEndpoint?.hasAuth).toBe(true)
  })

  it('marks endpoint as unauthenticated when no security is defined', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_NO_AUTH_NO_VERSION, strictMode: true })
    const usersEndpoint = result.endpoints.find((e) => e.path === '/users')
    expect(usersEndpoint?.hasAuth).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: version prefix detection
// ---------------------------------------------------------------------------

describe('executeParseSchema — version prefix detection', () => {
  it('detects version prefix in paths', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    expect(result.hasVersionPrefix).toBe(true)
  })

  it('returns false when no version prefix is present', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_NO_AUTH_NO_VERSION, strictMode: true })
    expect(result.hasVersionPrefix).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: response schema detection
// ---------------------------------------------------------------------------

describe('executeParseSchema — response schema detection', () => {
  it('detects presence of response content schema', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    const getEndpoint = result.endpoints.find((e) => e.path === '/v1/users' && e.method === 'GET')
    expect(getEndpoint?.hasResponseSchema).toBe(true)
  })

  it('marks endpoint as lacking response schema when content is absent', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_NO_AUTH_NO_VERSION, strictMode: true })
    const getEndpoint = result.endpoints.find((e) => e.path === '/users' && e.method === 'GET')
    expect(getEndpoint?.hasResponseSchema).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Tests: nullable field detection
// ---------------------------------------------------------------------------

describe('executeParseSchema — nullable field detection', () => {
  it('detects nullable fields in requestBody', async () => {
    const result = await executeParseSchema({ schemaJson: OPENAPI_WITH_AUTH, strictMode: true })
    const postEndpoint = result.endpoints.find((e) => e.path === '/v1/products' && e.method === 'POST')
    expect(postEndpoint?.isNullable).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Tests: json-schema field extraction
// ---------------------------------------------------------------------------

describe('executeParseSchema — json-schema field extraction', () => {
  it('extracts nested property paths from JSON Schema', async () => {
    const result = await executeParseSchema({ schemaJson: JSON_SCHEMA, strictMode: true })
    expect(result.rawFields).toContain('name')
    expect(result.rawFields).toContain('address')
    expect(result.rawFields).toContain('address.street')
    expect(result.rawFields).toContain('address.city')
  })
})

// ---------------------------------------------------------------------------
// Tests: error handling
// ---------------------------------------------------------------------------

describe('executeParseSchema — error handling', () => {
  it('throws on invalid JSON input', async () => {
    await expect(
      executeParseSchema({ schemaJson: 'not valid json {{{', strictMode: true })
    ).rejects.toThrow('Invalid JSON')
  })

  it('throws when schema is a JSON array (not an object)', async () => {
    await expect(
      executeParseSchema({ schemaJson: '[1, 2, 3]', strictMode: true })
    ).rejects.toThrow('JSON object')
  })
})
