/**
 * lib/config/models.ts
 * Central model configuration — ALL model selections live here.
 * Dev: all agents use llama-3.1-8b-instant (131k TPM, free)
 * Prod: orchestrator upgrades to llama-3.3-70b-versatile (6k TPM)
 *
 * System prompt budget:
 *   orchestrator (70b prod): ≤ 350 tokens
 *   analyst / evaluator (8b): ≤ 500 tokens
 *
 * Import `models` everywhere. Never call createGroq() outside this file.
 */
import { createGroq } from '@ai-sdk/groq'
import { GROQ_API_KEY, isProd } from '@/lib/config/env'

const groq = createGroq({ apiKey: GROQ_API_KEY })

/**
 * Model instances used by each agent role.
 * Import this object — never call createGroq() anywhere else.
 */
export const models = {
  /**
   * Orchestrator: 70b in prod (lean prompts ≤ 350 tokens), 8b in dev.
   * Uses streamText — never generateText.
   */
  orchestrator: groq('llama-3.3-70b-versatile'), // Forced prod model for testing

  /**
   * Analyst sub-agent: 8b for fast tool calling; structured output validated by Zod.
   * Uses generateText with stopWhen: isStepCount(3).
   */
  analyst: groq('llama-3.1-8b-instant'),

  /**
   * Evaluator sub-agent: 8b for fast tool calling; structured output validated by Zod.
   * Uses generateText with stopWhen: isStepCount(3).
   */
  evaluator: groq('llama-3.1-8b-instant'),
} as const
