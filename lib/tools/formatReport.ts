/**
 * lib/tools/formatReport.ts
 * Pure formatting tool — no LLM, no external calls.
 * Converts OrchestratorOutput into a structured Markdown audit report.
 *
 * Architecture:
 *   - executeFormatReport(): pure function, directly callable
 *   - formatReport: tool() wrapper registered with the AI SDK
 */
import { z } from 'zod'
import { OrchestratorOutputSchema } from '@/lib/types/agents'
import type { FormatReportToolResult, OrchestratorOutput } from '@/lib/types/agents'
import { SCORE_WARN_THRESHOLD, SCORE_PASS_THRESHOLD } from '@/lib/config/constants'

// ---------------------------------------------------------------------------
// Markdown helpers
// ---------------------------------------------------------------------------

function severityEmoji(severity: 'low' | 'medium' | 'high'): string {
  const map: Record<'low' | 'medium' | 'high', string> = {
    low: '🟡',
    medium: '🟠',
    high: '🔴',
  }
  return map[severity]
}

function scoreLabel(score: number): string {
  if (score >= SCORE_PASS_THRESHOLD) return '✅ PASS'
  if (score >= SCORE_WARN_THRESHOLD) return '⚠️ WARN'
  return '❌ FAIL'
}

function buildMarkdownReport(output: OrchestratorOutput): string {
  const { analystResult, evaluatorResult, recommendation, auditedAt } = output
  const { violations, passedRules, score, summary } = evaluatorResult
  const { endpoints, schemaType, hasVersionPrefix } = analystResult

  const lines: string[] = []

  lines.push('# API Contract Audit Report')
  lines.push(`> **Audited:** ${auditedAt}`)
  lines.push(`> **Schema Type:** ${schemaType ?? 'unknown'}`)
  lines.push(`> **Endpoints Detected:** ${endpoints.length}`)
  lines.push(`> **Version Prefix Present:** ${hasVersionPrefix ? 'Yes ✅' : 'No ❌'}`)
  lines.push('')
  lines.push('## Compliance Score')
  lines.push('')
  lines.push(`### ${score}/100 — ${scoreLabel(score)}`)
  lines.push('')
  lines.push(summary)
  lines.push('')
  lines.push('## Endpoints Discovered')
  lines.push('')
  if (endpoints.length === 0) {
    lines.push('_No endpoints detected. Ensure the schema is a valid OpenAPI 3.x document._')
  } else {
    lines.push('| Method | Path | Auth | Response Schema |')
    lines.push('|--------|------|------|----------------|')
    for (const ep of endpoints) {
      const auth = ep.hasAuth ? '✅' : '❌'
      const resp = ep.hasResponseSchema ? '✅' : '❌'
      lines.push(`| \`${ep.method}\` | \`${ep.path}\` | ${auth} | ${resp} |`)
    }
  }
  lines.push('')
  lines.push('## Violations')
  lines.push('')
  if (violations.length === 0) {
    lines.push('🎉 **No violations found above the severity threshold.**')
  } else {
    for (const v of violations) {
      lines.push(`### ${severityEmoji(v.severity)} ${v.rule}`)
      lines.push(`- **Field:** \`${v.field}\``)
      lines.push(`- **Severity:** ${v.severity.toUpperCase()}`)
      lines.push(`- **Issue:** ${v.description}`)
      lines.push(`- **Fix:** ${v.suggestion}`)
      lines.push('')
    }
  }
  lines.push('## Passed Rules')
  lines.push('')
  if (passedRules.length === 0) {
    lines.push('_No rules passed at the current threshold._')
  } else {
    for (const rule of passedRules) {
      lines.push(`- ✅ ${rule}`)
    }
  }
  lines.push('')
  lines.push('## Recommendation')
  lines.push('')
  lines.push(recommendation)
  lines.push('')

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Parameters — same as OrchestratorOutputSchema
// ---------------------------------------------------------------------------
export type FormatReportInput = z.infer<typeof OrchestratorOutputSchema>

// ---------------------------------------------------------------------------
// Pure function — directly callable without the AI SDK ToolExecutionOptions
// ---------------------------------------------------------------------------
export async function executeFormatReport(
  args: FormatReportInput,
  _options?: unknown
): Promise<FormatReportToolResult> {
  try {
    const parsed = OrchestratorOutputSchema.safeParse(args)
    if (!parsed.success) {
      throw new Error('Invalid OrchestratorOutput shape: ' + parsed.error.flatten().toString())
    }
    const report = buildMarkdownReport(parsed.data)
    return { success: true, report }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown'
    return { success: false, report: '', error: msg }
  }
}
