'use client'

import { useChat } from '@ai-sdk/react'
import { useCallback, useMemo, useState } from 'react'
import { AgentThoughtStream } from '@/components/AgentThoughtStream'
import { ResultPanel } from '@/components/ResultPanel'
import { OrchestratorOutputSchema } from '@/lib/types/agents'
import type { AgentStep } from '@/lib/types/agents'
import { DEFAULT_BUSINESS_RULES } from '@/lib/config/constants'
import { isAnalystOutput, isEvaluatorOutput, hasError, isToolCacheHit } from '@/lib/utils/helpers'

// AI SDK v7: tool parts have type 'tool-{toolName}' (e.g., 'tool-runAnalystTool').
// The result/output is stored directly on the part as part.output (v7) or part.result (v6 fallback).
// Helper to read the raw tool part as a plain record.
type RawToolPart = Record<string, unknown>

const DEFAULT_SCHEMA = `{
  "openapi": "3.0.3",
  "info": { "title": "E-Commerce API", "version": "1.0.0" },
  "paths": {
    "/products": {
      "get": {
        "summary": "List all products",
        "responses": {
          "200": {
            "description": "Product list",
            "content": {
              "application/json": {
                "schema": { "type": "array", "items": { "$ref": "#/components/schemas/Product" } }
              }
            }
          }
        }
      },
      "post": {
        "summary": "Create product",
        "requestBody": {
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "properties": {
                  "name": { "type": "string" },
                  "price": { "type": "number", "nullable": true }
                }
              }
            }
          }
        }
      }
    }
  }
}`

const DEFAULT_RULES = DEFAULT_BUSINESS_RULES

export default function Home() {
  const [schemaInput, setSchemaInput] = useState(DEFAULT_SCHEMA)
  const [rulesInput, setRulesInput] = useState(DEFAULT_RULES)
  const [severity, setSeverity] = useState<'low' | 'medium' | 'high'>('medium')
  const [validationError, setValidationError] = useState<string | null>(null)

  // AI SDK v7 useChat — default transport talks to /api/chat
  const { messages, sendMessage, setMessages, status, error } = useChat()

  const isLoading = status === 'streaming' || status === 'submitted'

  // Deriving state directly from messages instead of using useEffect + setState prevents React infinite loops.
  const auditOutput = useMemo(() => {
    let foundReport: unknown = null
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.parts) continue
      for (const part of msg.parts) {
        if (part.type.startsWith('tool-')) {
          const toolName = part.type.slice(5)
          const rawPart = part as unknown as RawToolPart
          const output = rawPart['output'] ?? rawPart['result']
          if (toolName === 'formatReportTool' && output != null) {
            foundReport = output
          }
        }
      }
    }

    if (foundReport !== null) {
      const parsed = OrchestratorOutputSchema.safeParse(foundReport)
      if (parsed.success) return parsed.data
    }
    return null
  }, [messages])

  const agentSteps = useMemo(() => {
    const nextSteps: AgentStep[] = []

    for (const msg of messages) {
      if (msg.role !== 'assistant') continue

      if (msg.parts) {
        msg.parts.forEach((part, idx) => {
          const getStableTimestamp = () => {
            const msgRecord = msg as unknown as Record<string, unknown>
            return msgRecord['createdAt'] instanceof Date ? msgRecord['createdAt'].getTime() : Date.now()
          }
          const ts = getStableTimestamp()

          if (part.type === 'text' && part.text.trim().length > 0) {
            const id = `${msg.id}-text-${idx}`
            nextSteps.push({
              id,
              agentName: 'orchestrator',
              stepType: 'text',
              content: part.text.trim(),
              timestamp: ts
            })
          }

          if (part.type.startsWith('tool-')) {
            const toolName = part.type.slice(5)
            if (!toolName) return

            const rawPart = part as unknown as RawToolPart
            const output = rawPart['output'] ?? rawPart['result']

            const callId = `${msg.id}-call-${idx}`
            nextSteps.push({
              id: callId,
              agentName: 'orchestrator',
              stepType: 'tool-call',
              toolName,
              content: toolName === 'runAnalystTool' ? 'Delegating to Analyst...'
                : toolName === 'runEvaluatorTool' ? 'Delegating to Evaluator...'
                  : 'Executing formatReportTool...',
              timestamp: ts
            })

            if (output !== null && output !== undefined) {
              const resultAgent =
                toolName === 'runAnalystTool' ? 'analyst'
                  : toolName === 'runEvaluatorTool' ? 'evaluator'
                    : 'orchestrator'

              if (toolName === 'runAnalystTool' && isAnalystOutput(output) && typeof output.thought === 'string') {
                const thoughtId = `${msg.id}-thought-${idx}`
                nextSteps.push({
                  id: thoughtId,
                  agentName: 'analyst',
                  stepType: 'text',
                  content: output.thought,
                  timestamp: ts
                })
              }

              const resultId = `${msg.id}-result-${idx}`
              const isCacheHit = isToolCacheHit(toolName, output)

              if (isCacheHit) {
                nextSteps.push({
                  id: resultId,
                  agentName: 'orchestrator',
                  stepType: 'handoff',
                  toolName,
                  content: "⚡ Cache hit — returning previous audit result",
                  timestamp: ts
                })
              } else {
                const content =
                  toolName === 'runAnalystTool'
                    ? typeof output === 'string'
                      ? `Analyst failed: ${output}`
                      : hasError(output)
                        ? `Analyst failed: ${output.error}`
                        : `Analyst found ${isAnalystOutput(output) ? output.endpointCount : 0} endpoint(s)`
                    : toolName === 'runEvaluatorTool'
                      ? typeof output === 'string'
                        ? `Evaluator failed: ${output}`
                        : hasError(output)
                          ? `Evaluator failed: ${output.error}`
                          : `Evaluator score: ${isEvaluatorOutput(output) ? output.score : 0}/100`
                      : 'Report assembled by Orchestrator'

                nextSteps.push({
                  id: resultId,
                  agentName: resultAgent as 'analyst' | 'evaluator' | 'orchestrator',
                  stepType: 'tool-result',
                  toolName,
                  content,
                  timestamp: ts
                })
              }
            }
          }
        })
      }
    }
    return nextSteps
  }, [messages])

  const handleSubmit = useCallback((): void => {
    const trimmedSchema = schemaInput.trim()
    if (!trimmedSchema) {
      setValidationError('Please paste an OpenAPI or JSON Schema before submitting.')
      return
    }
    
    // Serverless constraint protection
    if (trimmedSchema.length > 20000) {
      setValidationError('Schema is too large for this free-tier serverless demo (max 20,000 characters). Please paste a smaller snippet.')
      return
    }

    // Ensure valid JSON before wasting LLM calls
    try {
      JSON.parse(trimmedSchema)
    } catch {
      setValidationError('Invalid JSON format. Please ensure your schema is valid JSON.')
      return
    }

    if (!rulesInput.trim()) {
      setValidationError('Please provide at least one business rule to enforce.')
      return
    }

    setValidationError(null)
    setMessages([])

    // Pass the payload strictly formatted as the backend expects
    sendMessage({
      text: `\`\`\`json\n${trimmedSchema}\n\`\`\`\n\nBusiness rules to enforce:\n${rulesInput.split('\n').map(r => '- ' + r).join('\n')}`
    }, { body: { severity } })
  }, [sendMessage, schemaInput, rulesInput, severity, setMessages])

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] font-sans text-zinc-50 selection:bg-indigo-500/30">
      <header className="sticky top-0 z-50 flex h-16 w-full items-center justify-between border-b border-white/10 bg-[#09090b]/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 font-bold text-white shadow-sm shadow-indigo-500/20">
            A
          </div>
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold tracking-tight text-zinc-100">Smart API Contract Auditor</h1>
            <p className="text-[10px] font-medium text-zinc-500">Multi-Agent · Groq + Vercel AI SDK · TypeScript</p>
          </div>
        </div>
        <div className="hidden items-center gap-4 sm:flex">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
            <div className="h-1.5 w-1.5 rounded-full bg-fuchsia-500" /> Orchestrator
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
            <div className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Analyst
          </div>
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Evaluator
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6 lg:flex-row max-w-[1600px] mx-auto w-full">
        {/* Left Column: Inputs */}
        <section className="flex w-full flex-col gap-6 lg:w-[45%]">
          <div className="flex flex-1 flex-col rounded-xl border border-white/10 bg-[#0f0f11] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">OpenAPI / JSON Schema</h2>
              <span className="rounded bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-400">JSON</span>
            </div>
            <textarea
              className="flex-1 resize-none bg-transparent p-4 text-[13px] font-mono leading-relaxed text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 min-h-[400px]"
              value={schemaInput}
              onChange={(e) => setSchemaInput(e.target.value)}
              spellCheck={false}
              placeholder="Paste your OpenAPI 3.x or JSON Schema here..."
            />
          </div>

          <div className="flex flex-col rounded-xl border border-white/10 bg-[#0f0f11] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">Business Rules</h2>
              <span className="text-[10px] font-medium text-zinc-500">one per line</span>
            </div>
            <textarea
              className="h-32 resize-none bg-transparent p-4 text-[13px] font-mono leading-relaxed text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
              value={rulesInput}
              onChange={(e) => setRulesInput(e.target.value)}
              spellCheck={false}
            />
          </div>

          <div className="flex flex-col gap-3 mt-auto">
            <div className="flex items-center gap-2 justify-center mb-2">
              <span className="text-xs text-zinc-500 font-medium">Severity:</span>
              <div className="flex bg-[#0f0f11] rounded-lg border border-white/10 p-1">
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setSeverity(level)}
                    className={`px-3 py-1 text-[11px] font-medium rounded-md capitalize transition-colors ${severity === level
                        ? 'bg-indigo-500 text-white'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                      }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {validationError && (
              <p className="text-sm text-red-400 text-center bg-red-400/10 py-2 rounded-lg border border-red-400/20">{validationError}</p>
            )}
            {error && (
              <p className="text-sm text-red-400 text-center bg-red-400/10 py-2 rounded-lg border border-red-400/20">{error.message}</p>
            )}

            <button
              onClick={handleSubmit}
              disabled={isLoading}
              className="group relative flex h-14 w-full items-center justify-center overflow-hidden rounded-xl bg-indigo-500 font-semibold text-white transition-all hover:bg-indigo-600 disabled:opacity-50 disabled:hover:bg-indigo-500"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite]" />
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  <span>Auditing...</span>
                </div>
              ) : (
                'Run Audit Pipeline'
              )}
            </button>

            {isLoading && (
              <p className="text-center text-xs text-zinc-500 animate-pulse">Agents are working...</p>
            )}
          </div>
        </section>

        {/* Right Column: Thought Stream & Results */}
        <section className="flex w-full flex-col gap-6 lg:w-[55%]">
          <div className="flex min-h-[300px] flex-col rounded-xl border border-white/10 bg-[#0f0f11] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">Agent Thought Stream</h2>
                {isLoading && (
                  <span className="flex items-center gap-1.5 rounded-full bg-fuchsia-500/10 px-2 py-0.5 text-[10px] font-medium text-fuchsia-400">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-fuchsia-400"></span>
                    Live
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium text-zinc-500">{agentSteps.length} steps</span>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <AgentThoughtStream steps={agentSteps} isLoading={isLoading} />
            </div>
          </div>

          <div className="flex flex-1 flex-col rounded-xl border border-white/10 bg-[#0f0f11] shadow-xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
              <h2 className="text-xs font-semibold tracking-wider text-zinc-400 uppercase">Audit Report</h2>
              {auditOutput && (
                <span className="text-[10px] font-medium text-zinc-500">
                  {new Date(auditOutput.auditedAt).toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-0">
              <ResultPanel
                output={auditOutput}
                rawText={messages.filter(m => m.role === 'assistant').pop()?.parts?.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('') || ''}
                isLoading={isLoading}
              />
            </div>
          </div>
        </section>
      </main>

      {/* House of Edtech Assignment Footer Requirement */}
      <footer className="w-full border-t border-white/10 bg-[#09090b]/80 py-4 px-6 text-center text-[11px] text-zinc-500 backdrop-blur-md">
        <p className="flex items-center justify-center gap-3">
          <span>Built by <a href="https://github.com/santosh97" target="_blank" rel="noopener noreferrer" className="font-semibold text-indigo-400 hover:text-indigo-300 transition-colors">Santosh Dubey</a></span>
          <span className="text-zinc-700">•</span>
          <a href="https://github.com/santosh97" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">GitHub Profile</a>
          <span className="text-zinc-700">•</span>
          <a href="https://www.linkedin.com/in/santosh-dubey-6967a6135/" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300 transition-colors">LinkedIn Profile</a>
        </p>
      </footer>
    </div>
  )
}