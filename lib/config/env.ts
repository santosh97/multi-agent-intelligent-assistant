/**
 * lib/config/env.ts
 * Single source of truth for all environment variable access.
 * Validated at server startup — throws on misconfiguration so it never
 * silently fails in production.
 *
 * Pattern: read once, export typed values. No raw process.env anywhere else.
 */

// ---------------------------------------------------------------------------
// Runtime environment detection
// ---------------------------------------------------------------------------

/** True when running under `next dev` or `NODE_ENV=development`. */
export const isDev = process.env['NODE_ENV'] !== 'production'

/** True when deployed with `NODE_ENV=production`. */
export const isProd = !isDev

/** Human-readable environment label for logging and UI badges. */
export const APP_ENV: 'development' | 'production' = isDev ? 'development' : 'production'

// ---------------------------------------------------------------------------
// Validated API keys
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `[env] Missing required environment variable: ${name}. ` +
      `Copy .env.example to .env and fill in your values.`
    )
  }
  return value
}

export const GROQ_API_KEY = requireEnv('GROQ_API_KEY')

// ---------------------------------------------------------------------------
// Dev-only logger — silent in production, structured in development
// ---------------------------------------------------------------------------

export const devLog = isDev
  ? (label: string, data?: unknown): void => {
      console.log(`[${label}]`, data !== undefined ? data : '')
    }
  : (): void => {
      // no-op in production
    }
