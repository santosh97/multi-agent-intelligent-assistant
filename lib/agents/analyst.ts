/**
 * lib/agents/analyst.ts
 * Analyst sub-agent — a real, separate LLM call using generateText().
 * Responsibility: call parseSchema tool to extract structural metadata.
 * Never receives full conversation history — only the task object.
 *
 * AI SDK v7 changes:
 *   - maxSteps → stopWhen: isStepCount(N)
 *   - toolResults[i].output  (not .result)
 */
import { generateText, isStepCount, tool } from 'ai'
import { models } from '@/lib/config/models'
import { ANALYST_SYSTEM_PROMPT, SUBAGENT_MAX_STEPS } from '@/lib/config/constants'
import { AnalystResultSchema } from '@/lib/types/agents'
import type { AnalystTask, AnalystResult, AgentStep } from '@/lib/types/agents'
import { parseSchema } from '@/lib/tools/parseSchema'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// runAnalyst — called by the orchestrator's runAnalystTool
// ---------------------------------------------------------------------------
export async function runAnalyst(
  task: AnalystTask,
  onStep?: (step: AgentStep) => void
): Promise<AnalystResult> {
  const ERROR_RESULT: AnalystResult = { success: false, endpoints: [], rawFields: [], schemaType: 'unknown', hasVersionPrefix: false, error: '' }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await generateText({
        model: models.analyst,
        stopWhen: isStepCount(SUBAGENT_MAX_STEPS),
        system: ANALYST_SYSTEM_PROMPT,
        tools: { 
          parseSchema: tool({
            description: 'Extracts endpoints and structural metadata from the provided schema.',
            inputSchema: z.object({
              ready: z.boolean().describe('Set to true to execute this step'),
            }),
            execute: async ({ ready: _ready }: { ready: boolean }) => {
              return await parseSchema.execute({ schemaJson: task.schemaJson, strictMode: task.strictMode });
            }
          })
        },
        messages: [
          {
            role: 'user',
            content: `Call the parseSchema tool immediately. You MUST pass { "ready": true } as the argument.`,
          }
        ],
        onStepFinish: (step: { text: string; finishReason: string }) => {
          if (step.text.trim().length > 0) {
            onStep?.({
              agentName: 'analyst',
              stepType: 'text',
              content: step.text.trim().slice(0, 300),
              timestamp: Date.now(),
            })
          }
        },
      })

      // AI SDK v7: toolResults[i].output (was .result in v3/v4)
      const parseResult = result.toolResults.find((r) => r.toolName === 'parseSchema')
      
      // Extract the reasoning text generated before calling the tool
      const thought = result.text.trim();

      if (!parseResult) {
        throw new Error('Analyst failed to call parseSchema tool.')
      }

      // toolResult.output is unknown in v7 — must safeParse
      const parsed = AnalystResultSchema.safeParse(parseResult.output)
      if (!parsed.success) {
        throw new Error('Analyst: tool result did not match AnalystResultSchema — ' + parsed.error.flatten().toString())
      }

      return { ...parsed.data, thought }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown'
      if (msg.includes('429')) return { ...ERROR_RESULT, error: 'Rate limit. Please retry.' }
      if (attempt === 2) return { ...ERROR_RESULT, error: `Failed after 3 attempts: ${msg}` }
    }
  }
  return { ...ERROR_RESULT, error: 'Unreachable' }
}
