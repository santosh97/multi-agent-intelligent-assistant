/**
 * lib/agents/evaluator.ts
 * Evaluator sub-agent — a reasoning LLM call using generateText().
 *
 * Responsibility: read the analyst findings and business rules, reason about
 * which rules are highest priority for this schema, then call validateRules.
 *
 * Architecture:
 *   The LLM receives the analyst result summary and full business rules text,
 *   reasons about which rules are most critical for this specific schema,
 *   assesses overall risk level, and calls validateRules with priorityRules
 *   and riskLevel. The execute() uses priorityRules to reorder business
 *   rules so highest-risk checks run first, making the LLM's reasoning load-bearing.
 *
 * AI SDK v7:
 *   - maxSteps → stopWhen: isStepCount(N)
 *   - toolResults[i].output  (not .result)
 */
import { generateText, isStepCount, tool } from 'ai'
import { models } from '@/lib/config/models'
import { EVALUATOR_SYSTEM_PROMPT, SUBAGENT_MAX_STEPS } from '@/lib/config/constants'
import { EvaluatorResultSchema, EvaluatorAssessmentSchema } from '@/lib/types/agents'
import type { EvaluatorTask, EvaluatorResult, ValidateRulesToolResult } from '@/lib/types/agents'
import { executeValidateRules } from '@/lib/tools/validateRules'
import { sleep } from '@/lib/utils/helpers'

// ---------------------------------------------------------------------------
// runEvaluator — called by the orchestrator's runEvaluatorTool
// ---------------------------------------------------------------------------
export async function runEvaluator(task: EvaluatorTask): Promise<EvaluatorResult> {
  const ERROR_RESULT: EvaluatorResult = {
    success: false,
    score: 0,
    violations: [],
    passedRules: [],
    unrecognizedRules: [],
    summary: '',
    error: '',
  }

  // Build a concise analyst summary for the LLM to reason about.
  // The full analystResult is passed to validateRules; this summary is
  // enough for the LLM to make a meaningful risk assessment.
  const endpointCount = task.analysisResult.endpoints?.length ?? 0
  const authlessCount = task.analysisResult.endpoints?.filter((e) => !e.hasAuth).length ?? 0
  const unversionedCount = task.analysisResult.endpoints?.filter(
    (e) => e.path && !/\/v\d+/i.test(e.path)
  ).length ?? 0

  const analystSummary =
    `Schema type: ${task.analysisResult.schemaType ?? 'unknown'}\n` +
    `Total endpoints: ${endpointCount}\n` +
    `Endpoints without auth: ${authlessCount} of ${endpointCount}\n` +
    `Endpoints without version prefix: ${unversionedCount} of ${endpointCount}\n` +
    `Analyst thought: ${task.analysisResult.thought?.slice(0, 200) ?? '(none)'}`

  const rulesText =
    task.businessRules.length > 0
      ? task.businessRules.map((r, i) => `${i + 1}. ${r}`).join('\n')
      : '(No specific rules provided - all built-in checks will run)'

  const userMessage =
    `Analyst findings:\n${analystSummary}\n\n` +
    `Business rules to enforce:\n${rulesText}\n\n` +
    `Based on the analyst findings, reason about which rules are most critical for this schema. ` +
    `Consider: authentication issues are high risk for any API with external exposure; ` +
    `versioning issues are medium risk; nullable field issues are lower risk. ` +
    `Then call validateRules with your prioritized list and overall risk assessment.`

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await generateText({
        model: models.evaluator,
        stopWhen: isStepCount(SUBAGENT_MAX_STEPS),
        system: EVALUATOR_SYSTEM_PROMPT,
        tools: {
          validateRules: tool({
            description:
              'Checks the analysisResult against business rules and returns a scored compliance report. Call with your prioritized rule list and risk assessment.',
            inputSchema: EvaluatorAssessmentSchema,
            execute: async (assessment): Promise<ValidateRulesToolResult> => {
              // The LLM's priorityRules assessment is genuinely used:
              // We reorder the business rules to put the LLM's priority rules first.
              // This ensures the most critical violations are detected and ranked first,
              // making the compliance report more actionable.
              const reorderedRules = reorderByPriority(task.businessRules, assessment.priorityRules)

              // The LLM's riskLevel adjusts the effective severity threshold:
              // if LLM assessed high risk, we also surface low-severity issues.
              const effectiveThreshold =
                assessment.riskLevel === 'high' ? 'low'
                  : assessment.riskLevel === 'medium' ? task.severityThreshold
                    : task.severityThreshold

              return await executeValidateRules({
                analysisResult: task.analysisResult,
                businessRules: reorderedRules,
                severityThreshold: effectiveThreshold,
              })
            },
          }),
        },
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      })

      // AI SDK v7: toolResults[i].output (was .result in v3/v4)
      const toolResult = result.toolResults.find((tr) => tr.toolName === 'validateRules')

      if (!toolResult) {
        throw new Error('Evaluator: validateRules tool was not called — no tool result returned.')
      }

      // toolResult.output is unknown in v7 — must safeParse
      const parsed = EvaluatorResultSchema.safeParse(toolResult.output)
      if (!parsed.success) {
        throw new Error(
          'Evaluator: tool result did not match EvaluatorResultSchema — ' +
            parsed.error.flatten().toString()
        )
      }

      return parsed.data
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown'
      if (msg.includes('429')) return { ...ERROR_RESULT, error: 'Rate limit. Please retry.' }
      if (attempt === 2) return { ...ERROR_RESULT, error: `Failed after 3 attempts: ${msg}` }
      // Exponential backoff for transient errors (500, timeouts, etc.)
      await sleep(2 ** attempt * 500)
    }
  }
  return { ...ERROR_RESULT, error: 'Unreachable' }
}

// ---------------------------------------------------------------------------
// reorderByPriority — pure helper used by evaluate() execute()
// Moves the LLM's priorityRules to the front of the businessRules list.
// Rules not in the priority list keep their original order at the end.
// ---------------------------------------------------------------------------
function reorderByPriority(businessRules: string[], priorityRules: string[]): string[] {
  if (priorityRules.length === 0) return businessRules

  const prioritySet = new Set(priorityRules.map((r) => r.toLowerCase()))
  const front = businessRules.filter((r) => prioritySet.has(r.toLowerCase()))
  const rest = businessRules.filter((r) => !prioritySet.has(r.toLowerCase()))

  // Also include any priority rules the LLM mentioned that weren't in the
  // original businessRules list (e.g. the LLM synthesized a new rule name)
  const alreadyPresent = new Set(front.map((r) => r.toLowerCase()))
  const extraPriority = priorityRules.filter((r) => !alreadyPresent.has(r.toLowerCase()))

  return [...front, ...extraPriority, ...rest]
}
