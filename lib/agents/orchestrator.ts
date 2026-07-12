/**
 * lib/agents/orchestrator.ts
 * Orchestrator agent configuration factory.
 * Returns a config object passed directly into streamText() in the API route.
 *
 * AI SDK v7 notes:
 *   - CoreMessage is gone — use ModelMessage or plain role/content objects
 *   - maxSteps → stopWhen: isStepCount(N)
 *   - onStepFinish receives StepResult (has .text, .finishReason, .toolResults)
 *   - tool().execute args are typed from Zod schema
 *   - formatReport.execute() is the tool's execute function — call it directly
 */
import { isStepCount, tool } from 'ai'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import { models } from '@/lib/config/models'
import { devLog } from '@/lib/config/env'
import {
  ORCHESTRATOR_SYSTEM_PROMPT,
  ORCHESTRATOR_MAX_STEPS,
} from '@/lib/config/constants'

import type { OrchestratorOutput, AnalystResult, EvaluatorResult } from '@/lib/types/agents'
import { runAnalyst } from '@/lib/agents/analyst'
import { runEvaluator } from '@/lib/agents/evaluator'
import { executeFormatReport } from '@/lib/tools/formatReport'
import { hashSchema, lookupSchema, saveSchema } from '@/lib/tools/schemaRegistry'

// System prompt and step count are imported from lib/config/constants.ts
// Edit prompts and tunables there — never inline them here.

// ---------------------------------------------------------------------------
// Orchestrator config factory
// Returns an object spread directly into streamText()
// ---------------------------------------------------------------------------

export function getOrchestratorConfig(
  messages: ModelMessage[],
  context: { schemaJson: string; businessRules: string[]; severityThreshold: 'low' | 'medium' | 'high' }
) {
  // Stateful closures to bypass LLM token limits on massive payloads
  let analystResult: AnalystResult | null = null
  let evaluatorResult: EvaluatorResult | null = null
  let pipelineError: string | null = null

  return {
    model: models.orchestrator,
    stopWhen: isStepCount(ORCHESTRATOR_MAX_STEPS),
    system: ORCHESTRATOR_SYSTEM_PROMPT,
    messages,
    tools: {
      // ------------------------------------------------------------------
      // Tool 1: Delegate to Analyst sub-agent
      // ------------------------------------------------------------------
      runAnalystTool: tool({
        description:
          'Step 1: Parse and analyse the provided API schema by delegating to the Analyst sub-agent.',
        inputSchema: z.object({
          ready: z.boolean().describe('Set to true to execute this step'),
        }),
        execute: async ({ ready: _ready }: { ready: boolean }) => {
          const hash = hashSchema(context.schemaJson, context.businessRules, context.severityThreshold)
          const cached = lookupSchema(hash)
          if (cached !== null) {
            // Restore closure state from cache so subsequent tools can run normally
            analystResult = cached.analystResult
            evaluatorResult = cached.evaluatorResult
            return {
              cacheHit: true,
              success: cached.analystResult.success,
              endpointCount: cached.analystResult.endpoints?.length ?? 0,
            }
          }
          analystResult = await runAnalyst({ schemaJson: context.schemaJson, strictMode: true })

          if (!analystResult.success) {
            pipelineError = analystResult.error || 'Analyst failed.'
            return {
              success: false,
              error: pipelineError,
              fallbackAction: "STOP_AND_REPORT",
              instruction: "CRITICAL: The pipeline has failed. You MUST explain this error to the user and stop immediately. DO NOT call any other tools."
            }
          }

          // Return a tiny summary to the LLM
          return { success: analystResult.success, endpointCount: analystResult.endpoints?.length ?? 0, error: analystResult.error }
        },
      }),

      // ------------------------------------------------------------------
      // Tool 2: Delegate to Evaluator sub-agent
      // ------------------------------------------------------------------
      runEvaluatorTool: tool({
        description:
          'Step 2: Evaluate the parsed schema against business rules. MUST run after runAnalystTool.',
        inputSchema: z.object({
          endpointCount: z.number().optional().describe('The endpointCount returned by runAnalystTool in Step 1'),
        }),
        execute: async ({ endpointCount: _endpointCount }: { endpointCount?: number }) => {
          if (pipelineError) return { error: `Pipeline halted due to earlier error: ${pipelineError}. Stop immediately.` }
          if (!analystResult) return { error: "runAnalystTool must be called first. You MUST call only one tool and wait for the result." }

          evaluatorResult = await runEvaluator({
            analysisResult: analystResult,
            businessRules: context.businessRules,
            severityThreshold: context.severityThreshold,
          })

          if (!evaluatorResult.success) {
            pipelineError = evaluatorResult.error || 'Evaluator failed.'
            return {
              success: false,
              error: pipelineError,
              fallbackAction: "STOP_AND_REPORT",
              instruction: "CRITICAL: The pipeline has failed. You MUST explain this error to the user and stop immediately. DO NOT call any other tools."
            }
          }

          // Return a tiny summary to the LLM
          return { success: evaluatorResult.success, score: evaluatorResult.score, violationsCount: evaluatorResult.violations?.length ?? 0, error: evaluatorResult.error }
        },
      }),

      // ------------------------------------------------------------------
      // Tool 3: Final Report Formatter
      // ------------------------------------------------------------------
      formatReportTool: tool({
        description:
          'Step 3: Format the final audit report using the results from the Evaluator. MUST run after runEvaluatorTool.',
        inputSchema: z.object({
          evaluatorScore: z.number().optional().describe('The score returned by runEvaluatorTool in Step 2'),
          // llama-3.1-8b-instant sometimes returns recommendation as an array of strings.
          // z.preprocess coerces array → joined string before validation so execute()
          // always receives a plain string regardless of what the model sends.
          recommendation: z.preprocess(
            (val) => Array.isArray(val) ? val.join(' ') : val,
            z.string()
          ).describe('A 1-2 sentence recommendation based on the overall findings'),
        }),
        execute: async ({ recommendation, evaluatorScore: _evaluatorScore }: { recommendation: string; evaluatorScore?: number }) => {
          if (pipelineError) return { error: `Pipeline halted due to earlier error: ${pipelineError}. Stop immediately.` }
          if (!analystResult || !evaluatorResult) return { error: "runAnalystTool and runEvaluatorTool must be called first. You MUST call only one tool and wait for the result." }

          const output: OrchestratorOutput = {
            analystResult,
            evaluatorResult,
            recommendation,
            auditedAt: new Date().toISOString(),
          }

          const reportResult = await executeFormatReport(output)
          devLog('formatReport', { success: reportResult.success, error: reportResult.error })
          saveSchema(hashSchema(context.schemaJson, context.businessRules, context.severityThreshold), output)

          // Return the full OrchestratorOutput object so the frontend can
          // safeParse it against OrchestratorOutputSchema and populate the
          // structured ResultPanel. The Markdown string is generated above
          // (for executeFormatReport) but the tool result must be the
          // structured object — not the Markdown string — so page.tsx can
          // call setAuditOutput() successfully.
          return output
        },
      }),
    },

    // Capture plain-text steps from the orchestrator model itself
    // AI SDK v7: onStepFinish receives full StepResult — use .text and .finishReason
    onStepFinish: (step: { text: string; finishReason: string; toolResults?: Array<{ toolName: string; output: unknown }> }) => {
      devLog('ORCH onStepFinish', {
        finishReason: step.finishReason,
        text: step.text?.slice(0, 200) || '(empty)',
        toolResults: step.toolResults?.map(r => ({ toolName: r.toolName, outputKeys: typeof r.output === 'object' && r.output ? Object.keys(r.output as object) : String(r.output) }))
      })
    },
  } as const
}

// Zod re-export for type compatibility in the type inference above
export { z }
