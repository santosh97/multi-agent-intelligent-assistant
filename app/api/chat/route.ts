/**
 * app/api/chat/route.ts
 * POST endpoint for the multi-agent audit pipeline.
 *
 * AI SDK v7 notes:
 *   - The default useChat transport sends UIMessages with a messages[] array
 *   - convertToModelMessages() converts UIMessage[] → ModelMessage[] for streamText
 *   - Returns result.toUIMessageStreamResponse() for streaming SSE to the client
 *
 * Rules followed:
 * - export const dynamic = 'force-dynamic'
 * - streamText() + toDataStreamResponse() — never generateText()
 * - All errors return typed shapes — nothing bubbles to HTTP layer unhandled
 * - GROQ_API_KEY only read via lib/config/models.ts (server-side only)
 */
import { streamText, convertToModelMessages } from 'ai'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { UIMessage } from '@ai-sdk/react'
import { getOrchestratorConfig } from '@/lib/agents/orchestrator'
import { devLog } from '@/lib/config/env'
import { extractSchemaJson, extractBusinessRules } from '@/lib/utils/helpers'

export const dynamic = 'force-dynamic'

// Edge Runtime: required for Vercel free (Hobby) plan.
// Serverless functions on Hobby are hard-capped at 10s — this multi-agent
// pipeline takes 8-15s. Edge Runtime uses V8 isolates where the timeout
// applies to CPU execution time, not I/O wait, so streaming LLM responses
// are not killed mid-flight. All dependencies (AI SDK, Groq, Zod) are
// Edge-compatible (no Node.js-only APIs used anywhere in this codebase).
export const runtime = 'edge'

// ---------------------------------------------------------------------------
// Request body schema — AI SDK v7 useChat sends UIMessage[] with parts[]
// ---------------------------------------------------------------------------
const TextPartSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
})

const GenericPartSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
})

const UIMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  parts: z.array(z.union([TextPartSchema, GenericPartSchema])).optional(),
  content: z.string().optional(),
  metadata: z.unknown().optional(),
  createdAt: z.unknown().optional(),
})

const RequestBodySchema = z.object({
  messages: z.array(UIMessageSchema).min(1),
  id: z.string().optional(),
  severity: z.enum(['low', 'medium', 'high']).default('medium')
})

// 60s ceiling — respected on Pro/Team; Edge Runtime on Hobby is I/O-bound
// so typical audit completes in 8-15s regardless.
export const maxDuration = 60

export async function POST(req: Request): Promise<Response> {
  try {
    // -----------------------------------------------------------------------
    // 1. Parse and validate request body
    // -----------------------------------------------------------------------
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'Request body is not valid JSON.' },
        { status: 400 }
      )
    }

    const parsed = RequestBodySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body.',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const { messages, severity } = parsed.data

    // Implement Token Protection Layer
    const estimatedTokens = JSON.stringify(messages).length / 4
    if (estimatedTokens > 20000) {
      return NextResponse.json(
        { error: 'Payload too large. Estimated token count exceeds the 20,000 token serverless limit.' },
        { status: 413 }
      )
    }

    // -----------------------------------------------------------------------
    // 2. Convert UIMessages → ModelMessages for streamText
    //    AI SDK v7: convertToModelMessages handles the UIMessage parts format
    // -----------------------------------------------------------------------
    // Use convertToModelMessages to properly retain tool calls/results in history
    const safeMessages = messages.map(m => ({
      ...m,
      parts: m.parts || (m.content ? [{ type: 'text', text: m.content }] : [])
    })) as UIMessage[]
    
    const modelMessages = await convertToModelMessages(safeMessages)

    if (modelMessages.length === 0) {
      return NextResponse.json(
        { error: 'No valid messages after conversion.' },
        { status: 400 }
      )
    }

    // mappedMessages: text-only flattened view for content extraction (not passed to LLM)
    const mappedMessages = modelMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? (m.content as Array<{ type: string; text?: string }>).filter(p => p.type === 'text').map(p => p.text ?? '').join('') : '')
    }))

    devLog('ROUTE POST: modelMessages', JSON.stringify(modelMessages, null, 2))
    devLog('ROUTE POST: mappedMessages', JSON.stringify(mappedMessages, null, 2))

    // Extract schema JSON from the latest user message
    const lastUserMessage = mappedMessages.filter(m => m.role === 'user').pop()
    const contentText = lastUserMessage?.content ?? ''
    const schemaJson = extractSchemaJson(contentText)
    
    // Extract business rules
    const businessRules = extractBusinessRules(contentText)

    if (!schemaJson) {
      return NextResponse.json(
        { error: 'No JSON schema found. Wrap your schema in a ```json code block.' },
        { status: 400 }
      )
    }

    const config = getOrchestratorConfig(
      // Pass properly typed ModelMessage[] so streamText receives the correct type
      modelMessages,
      {
        schemaJson,
        businessRules,
        severityThreshold: severity
      }
    )

    // -----------------------------------------------------------------------
    // 4. Stream the orchestrator response
    // -----------------------------------------------------------------------
    const result = streamText({
      ...config,
      experimental_telemetry: { isEnabled: false },
    })

    return result.toUIMessageStreamResponse()
  } catch (e: unknown) {
    const message =
      e instanceof Error ? e.message : 'Internal server error'

    if (message.includes('429') || message.toLowerCase().includes('rate limit')) {
      return NextResponse.json(
        { error: 'Rate limit reached. Please wait a moment and retry.' },
        { status: 429 }
      )
    }

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
