/**
 * lib/types/agents.ts
 * Single source of truth for ALL Zod schemas and TypeScript types.
 * Every type in this project is derived from z.infer<typeof Schema>.
 * Never duplicate type definitions elsewhere.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// 0. LLM Assessment types — the meaningful inputs each sub-agent LLM reasons
//    about before calling its tool. These replace the former { ready: boolean }
//    dummy trigger, making each LLM call genuinely contribute to the pipeline.
// ---------------------------------------------------------------------------

/**
 * What the Analyst LLM must infer from reading the schema excerpt.
 * These fields are produced by the LLM's reasoning and passed to parseSchema
 * to confirm schema type and set processing strategy.
 */
export const AnalystAssessmentSchema = z.object({
  schemaType: z
    .enum(['openapi', 'json-schema', 'unknown'])
    .describe('The schema type the LLM identified from the excerpt'),
  estimatedEndpointCount: z
    .number()
    .int()
    .min(0)
    .describe('Approximate number of endpoint paths the LLM counted in the excerpt'),
  hasGlobalAuth: z
    .boolean()
    .describe('Whether the LLM detected a top-level security array in the schema'),
})
export type AnalystAssessment = z.infer<typeof AnalystAssessmentSchema>

/**
 * What the Evaluator LLM must infer from reading the analyst summary and rules.
 * These fields are produced by the LLM's reasoning and passed to validateRules
 * to set rule priority order and adjust scoring emphasis.
 */
export const EvaluatorAssessmentSchema = z.object({
  priorityRules: z
    .array(z.string())
    .describe('Business rules the LLM identified as highest risk for this schema, in priority order'),
  reasoning: z
    .string()
    .max(300)
    .describe('Brief explanation of why these rules were prioritized (max 300 chars)'),
})
export type EvaluatorAssessment = z.infer<typeof EvaluatorAssessmentSchema>

/**
 * Structured violation summary passed to the orchestrator's formatReportTool
 * so the LLM-generated recommendation is evidence-based, not generic.
 */
export const ViolationSummarySchema = z.object({
  rule: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  affectedField: z.string(),
})
export type ViolationSummary = z.infer<typeof ViolationSummarySchema>

// ---------------------------------------------------------------------------
// 1. AgentStep — emitted via onStep callbacks, consumed by AgentThoughtStream
// ---------------------------------------------------------------------------
export const AgentStepSchema = z.object({
  id: z.string().optional(),
  agentName: z.enum(['orchestrator', 'analyst', 'evaluator']),
  stepType: z.enum(['tool-call', 'tool-result', 'text', 'handoff']),
  toolName: z.string().optional(),
  content: z.string(),
  timestamp: z.number(),
  output: z.unknown().optional(),
})
export type AgentStep = z.infer<typeof AgentStepSchema>

// ---------------------------------------------------------------------------
// 2. AnalystTask — the input contract for runAnalyst()
// ---------------------------------------------------------------------------
export const AnalystTaskSchema = z.object({
  schemaJson: z.string().min(1, 'Schema JSON must not be empty'),
  strictMode: z.boolean().default(true),
})
export type AnalystTask = z.infer<typeof AnalystTaskSchema>

// ---------------------------------------------------------------------------
// 3. AnalystResult — the output contract of runAnalyst()
// ---------------------------------------------------------------------------
export const EndpointSchema = z.object({
  path: z.string(),
  method: z.string(),
  params: z.array(z.object({ name: z.string() })),
  hasAuth: z.boolean().optional(),
  hasResponseSchema: z.boolean().optional(),
  isNullable: z.boolean().optional(),
})
export type Endpoint = z.infer<typeof EndpointSchema>

export const AnalystResultSchema = z.object({
  success: z.boolean(),
  endpoints: z.array(EndpointSchema),
  rawFields: z.array(z.string()),
  schemaType: z.enum(['openapi', 'json-schema', 'unknown']).optional(),
  hasVersionPrefix: z.boolean().optional(),
  error: z.string().optional(),
  thought: z.string().optional(),
})
export type AnalystResult = z.infer<typeof AnalystResultSchema>

// ---------------------------------------------------------------------------
// 4. EvaluatorTask — the input contract for runEvaluator()
// ---------------------------------------------------------------------------
export const EvaluatorTaskSchema = z.object({
  analysisResult: AnalystResultSchema,
  businessRules: z.array(z.string()),
  severityThreshold: z.enum(['low', 'medium', 'high']),
})
export type EvaluatorTask = z.infer<typeof EvaluatorTaskSchema>

// ---------------------------------------------------------------------------
// 5. Violation — a single rule failure
// ---------------------------------------------------------------------------
export const ViolationSchema = z.object({
  rule: z.string(),
  field: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  description: z.string(),
  suggestion: z.string(),
})
export type Violation = z.infer<typeof ViolationSchema>

// ---------------------------------------------------------------------------
// 6. EvaluatorResult — output of runEvaluator()
// ---------------------------------------------------------------------------
export const EvaluatorResultSchema = z.object({
  success: z.boolean(),
  violations: z.array(ViolationSchema),
  passedRules: z.array(z.string()),
  unrecognizedRules: z.array(z.string()).default([]),
  score: z.number().min(0).max(100),
  summary: z.string(),
  error: z.string().optional(),
})
export type EvaluatorResult = z.infer<typeof EvaluatorResultSchema>

// ---------------------------------------------------------------------------
// 7. OrchestratorOutput — final synthesized audit result
// ---------------------------------------------------------------------------
export const OrchestratorOutputSchema = z.object({
  analystResult: AnalystResultSchema,
  evaluatorResult: EvaluatorResultSchema,
  recommendation: z.string(),
  auditedAt: z.string(),
})
export type OrchestratorOutput = z.infer<typeof OrchestratorOutputSchema>

// ---------------------------------------------------------------------------
// 8. ParseSchemaToolResult — return type of parseSchema tool
// ---------------------------------------------------------------------------
export const ParseSchemaToolResultSchema = z.object({
  success: z.boolean(),
  endpoints: z.array(EndpointSchema),
  rawFields: z.array(z.string()),
  schemaType: z.enum(['openapi', 'json-schema', 'unknown']),
  hasVersionPrefix: z.boolean(),
  error: z.string().optional(),
})
export type ParseSchemaToolResult = z.infer<typeof ParseSchemaToolResultSchema>

// ---------------------------------------------------------------------------
// 9. ValidateRulesToolResult — return type of validateRules tool
// ---------------------------------------------------------------------------
export const ValidateRulesToolResultSchema = z.object({
  success: z.boolean(),
  violations: z.array(ViolationSchema),
  passedRules: z.array(z.string()),
  unrecognizedRules: z.array(z.string()).default([]),
  score: z.number().min(0).max(100),
  summary: z.string(),
  error: z.string().optional(),
})
export type ValidateRulesToolResult = z.infer<typeof ValidateRulesToolResultSchema>

// ---------------------------------------------------------------------------
// 10. FormatReportToolResult — return type of formatReport tool
// ---------------------------------------------------------------------------
export const FormatReportToolResultSchema = z.object({
  success: z.boolean(),
  report: z.string(),
  error: z.string().optional(),
})
export type FormatReportToolResult = z.infer<typeof FormatReportToolResultSchema>

// ---------------------------------------------------------------------------
// 11. API Request Schema — validated in route.ts
// ---------------------------------------------------------------------------
export const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant', 'system']),
      content: z.string(),
    })
  ),
  businessRules: z.array(z.string()).optional().default([]),
})
export type ChatRequest = z.infer<typeof ChatRequestSchema>
