import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Simple in-memory rate limiter using a Map.
// NOTE: In Vercel Edge Runtime, globals are scoped per-isolate and do not share state
// across regions or multiple concurrent isolates. For a true production system,
// Upstash Redis or Vercel KV should be used. However, this satisfies the assignment's
// requirement for API defense without requiring external infrastructure setup.
const rateLimitMap = new Map<string, { count: number; expiresAt: number }>()
const MAX_REQUESTS = 10
const WINDOW_MS = 60 * 1000 // 1 minute

export function proxy(request: NextRequest) {
  // Only apply to the chat API
  if (request.nextUrl.pathname.startsWith('/api/chat')) {
    // Get IP or fallback
    const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
    const now = Date.now()

    const record = rateLimitMap.get(ip)
    if (!record || record.expiresAt < now) {
      rateLimitMap.set(ip, { count: 1, expiresAt: now + WINDOW_MS })
    } else {
      record.count += 1
      if (record.count > MAX_REQUESTS) {
        return new NextResponse(
          JSON.stringify({ error: 'Too many requests. Please try again later.' }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': Math.ceil((record.expiresAt - now) / 1000).toString(),
            },
          }
        )
      }
    }
  }
  
  return NextResponse.next()
}

// Ensure proxy only runs on API routes to avoid overhead on static assets
export const config = {
  matcher: '/api/chat',
}
