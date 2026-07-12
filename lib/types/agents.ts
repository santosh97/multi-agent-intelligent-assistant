/**
 * lib/types/agents.ts
 * Single source of truth for ALL Zod schemas and TypeScript types.
 * Every type in this project is derived from z.infer<typeof Schema>.
 * Never duplicate type definitions elsewhere.
 */
import { z } from 'zod'

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
