/**
 * lib/agents/evaluator.ts
 * Evaluator sub-agent — a real, separate LLM call using generateText().
 * Responsibility: call validateRules tool to check compliance.
 * Never receives full conversation history — only the task object.
 *
 * AI SDK v7 changes:
 *   - maxSteps → stopWhen: isStepCount(N)
 *   - toolResults[i].output  (not .result)
 */
import { generateText, isStepCount, tool } from 'ai'
import { models } from '@/lib/config/models'
import { EVALUATOR_SYSTEM_PROMPT, SUBAGENT_MAX_STEPS } from '@/lib/config/constants'
import { EvaluatorResultSchema } from '@/lib/types/agents'
import type { EvaluatorTask, EvaluatorResult, ValidateRulesToolResult } from '@/lib/types/agents'
import { validateRules } from '@/lib/tools/validateRules'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// runEvaluator — called by the orchestrator's runEvaluatorTool
// ---------------------------------------------------------------------------
export async function runEvaluator(task: EvaluatorTask): Promise<EvaluatorResult> {
  const ERROR_RESULT: EvaluatorResult = { success: false, score: 0, violations: [], passedRules: [], unrecognizedRules: [], summary: '', error: '' }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await generateText({
        model: models.evaluator,
        stopWhen: isStepCount(SUBAGENT_MAX_STEPS),
        system: EVALUATOR_SYSTEM_PROMPT,
        tools: { 
          validateRules: tool({
            description: 'Checks the analysisResult against business rules and returns a scored compliance report.',
            inputSchema: z.object({
              ready: z.boolean().describe('Set to true to execute this step'),
            }),
            execute: async (): Promise<ValidateRulesToolResult> => {
              return await validateRules.execute({
                analysisResult: task.analysisResult,
                businessRules: task.businessRules,
                severityThreshold: task.severityThreshold
              })
            }
          })
        },
        messages: [
          {
            role: 'user',
            content: `Call the validateRules tool immediately. You MUST pass { "ready": true } as the argument.`,
          }
        ],
      })

      // AI SDK v7: toolResults[i].output (was .result in v3/v4)
      const toolResult = result.toolResults.find(
        (tr) => tr.toolName === 'validateRules'
      )

      if (!toolResult) {
        throw new Error('Evaluator: validateRules tool was not called — no tool result returned.')
      }

      // toolResult.output is unknown in v7 — must safeParse
      const parsed = EvaluatorResultSchema.safeParse(toolResult.output)
      if (!parsed.success) {
        throw new Error('Evaluator: tool result did not match EvaluatorResultSchema — ' + parsed.error.flatten().toString())
      }

      return parsed.data
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown'
      if (msg.includes('429')) return { ...ERROR_RESULT, error: 'Rate limit. Please retry.' }
      if (attempt === 2) return { ...ERROR_RESULT, error: `Failed after 3 attempts: ${msg}` }
    }
  }
  return { ...ERROR_RESULT, error: 'Unreachable' }
}
