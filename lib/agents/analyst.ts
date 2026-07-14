/**
 * lib/agents/analyst.ts
 * Analyst sub-agent — a reasoning LLM call using generateText().
 * 
 * Responsibility: examine the schema excerpt, assess its structural properties,
 * then call parseSchema with the LLM's assessed parameters.
 *
 * Architecture:
 *   The LLM receives the actual schema excerpt in its context, reasons about
 *   schema type, endpoint count, and auth presence, then calls parseSchema
 *   with the assessed values. The execute() uses the LLM's assessed schemaType to
 *   set the strict parsing strategy, making the LLM's reasoning load-bearing.
 *
 * AI SDK v7:
 *   - maxSteps → stopWhen: isStepCount(N)
 *   - toolResults[i].output  (not .result)
 */
import { generateText, isStepCount, tool } from 'ai'
import { models } from '@/lib/config/models'
import {
  ANALYST_SYSTEM_PROMPT,
  SUBAGENT_MAX_STEPS,
  ANALYST_SCHEMA_EXCERPT_LENGTH,
} from '@/lib/config/constants'
import { AnalystResultSchema, AnalystAssessmentSchema } from '@/lib/types/agents'
import type { AnalystTask, AnalystResult, AgentStep } from '@/lib/types/agents'
import { executeParseSchema } from '@/lib/tools/parseSchema'
import { sleep } from '@/lib/utils/helpers'

// ---------------------------------------------------------------------------
// runAnalyst — called by the orchestrator's runAnalystTool
// ---------------------------------------------------------------------------
export async function runAnalyst(
  task: AnalystTask,
  onStep?: (step: AgentStep) => void
): Promise<AnalystResult> {
  const ERROR_RESULT: AnalystResult = {
    success: false,
    endpoints: [],
    rawFields: [],
    schemaType: 'unknown',
    hasVersionPrefix: false,
    error: '',
  }

  // Provide a meaningful excerpt of the schema so the LLM can reason about it.
  // The full schema is processed by the deterministic parseSchema tool;
  // the excerpt is enough for the LLM to assess type, count, and auth presence.
  const schemaExcerpt = task.schemaJson.slice(0, ANALYST_SCHEMA_EXCERPT_LENGTH)
  const isExcerptTruncated = task.schemaJson.length > ANALYST_SCHEMA_EXCERPT_LENGTH

  const userMessage =
    `Please analyse the following API schema excerpt and call the parseSchema tool with your assessment.\n\n` +
    `Schema excerpt (${isExcerptTruncated ? `first ${ANALYST_SCHEMA_EXCERPT_LENGTH} of ${task.schemaJson.length} chars` : 'complete schema'}):\n` +
    `\`\`\`json\n${schemaExcerpt}\n\`\`\`\n\n` +
    `Based on what you can see, determine:\n` +
    `- schemaType: "openapi" if you see an "openapi" key with "paths", "json-schema" if you see "$schema" or root-level "properties", otherwise "unknown"\n` +
    `- estimatedEndpointCount: how many distinct path keys you can count under "paths" (0 if not openapi)\n` +
    `- hasGlobalAuth: true if you see a top-level "security" array with entries, false otherwise\n\n` +
    `Then call parseSchema with those values.`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await generateText({
        model: models.analyst,
        stopWhen: isStepCount(SUBAGENT_MAX_STEPS),
        system: ANALYST_SYSTEM_PROMPT,
        tools: {
          parseSchema: tool({
            description:
              'Parses the full API schema and extracts endpoint metadata, field names, auth coverage, and structural properties. Call this with your assessed values from reading the schema excerpt.',
            inputSchema: AnalystAssessmentSchema,
            execute: async (assessment) => {
              // The LLM's assessment is now genuinely used:
              // - If the LLM assessed schemaType as 'unknown', we run in lenient mode
              // - If the LLM counted 0 endpoints but type is 'openapi', we flag this
              const strictMode = assessment.schemaType !== 'unknown' && task.strictMode

              const parseResult = await executeParseSchema({
                schemaJson: task.schemaJson,
                strictMode,
              })

              // Enrich the result with the LLM's pre-assessment for comparison
              return {
                ...parseResult,
                llmAssessment: {
                  schemaType: assessment.schemaType,
                  estimatedEndpointCount: assessment.estimatedEndpointCount,
                  hasGlobalAuth: assessment.hasGlobalAuth,
                  // Flag any major discrepancies between LLM assessment and ground truth
                  assessmentAccurate:
                    parseResult.schemaType === assessment.schemaType &&
                    Math.abs(parseResult.endpoints.length - assessment.estimatedEndpointCount) <= 2,
                },
              }
            },
          }),
        },
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
        onStepFinish: (step: { text: string; finishReason: string }) => {
          if (step.text.trim().length > 0) {
            onStep?.({
              agentName: 'analyst',
              stepType: 'text',
              content: step.text.trim().slice(0, 400),
              timestamp: Date.now(),
            })
          }
        },
      })

      // AI SDK v7: toolResults[i].output (was .result in v3/v4)
      const parseResult = result.toolResults.find((r) => r.toolName === 'parseSchema')

      // Capture the LLM's reasoning text generated before calling the tool
      const thought = result.text.trim()

      if (!parseResult) {
        throw new Error('Analyst failed to call parseSchema tool.')
      }

      // toolResult.output is unknown in v7 — must safeParse
      const parsed = AnalystResultSchema.safeParse(parseResult.output)
      if (!parsed.success) {
        throw new Error(
          'Analyst: tool result did not match AnalystResultSchema — ' +
            parsed.error.flatten().toString()
        )
      }

      return { ...parsed.data, thought }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown'
      if (msg.includes('429')) return { ...ERROR_RESULT, error: 'Rate limit. Please retry.' }
      if (attempt === 2) return { ...ERROR_RESULT, error: `Failed after 3 attempts: ${msg}` }
      // Exponential backoff for transient errors (500, timeouts, etc.)
      // Do NOT delay on 429 — the rate limit window requires user action, not retry.
      await sleep(2 ** attempt * 500)
    }
  }
  return { ...ERROR_RESULT, error: 'Unreachable' }
}
