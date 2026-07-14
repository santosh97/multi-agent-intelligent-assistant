# Smart API Contract Auditor

A production-grade **multi-agent AI system** that audits OpenAPI and JSON Schema contracts against business rules in real time. Built entirely in TypeScript with strict type safety, powered by Groq Cloud and the Vercel AI SDK.

---

## Architecture

```
User Input (schema + business rules)
         │
         ▼
POST /api/chat  ─── streamText() ──► toDataStreamResponse()
         │
         ▼
┌────────────────────────────────────────────────┐
│  Orchestrator Agent  (llama-3.3-70b / 8b)      │
│  maxSteps: 10 │ streamText()                    │
│                                                 │
│  Step 1 ─► runAnalystTool                       │
│              └─► runAnalyst() [generateText]    │
│                    └─► parseSchema tool (pure TS)│
│                                                 │
│  Step 2 ─► runEvaluatorTool                     │
│              └─► runEvaluator() [generateText]  │
│                    └─► validateRules tool (pure TS)│
│                                                 │
│  Step 3 ─► formatReportTool                     │
│              └─► formatReport tool (pure TS)   │
└────────────────────────────────────────────────┘
         │
         ▼
AgentThoughtStream (live step panel)
ResultPanel (structured compliance report)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 App Router |
| Language | TypeScript (strict) |
| AI SDK | Vercel AI SDK v7 (`ai`, `@ai-sdk/react`, `@ai-sdk/groq`) |
| LLM | Groq Cloud (llama-3.1-8b-instant / llama-3.3-70b-versatile) |
| Validation | Zod |
| Styling | Tailwind CSS v4 |

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/santosh97/smart-api-auditor
cd smart-api-auditor
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and add your Groq API key (free at https://console.groq.com):

```
GROQ_API_KEY=gsk_your_actual_key_here
```

### 3. Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### 5. Type Check

```bash
npx tsc --noEmit
```

## Project Structure

```
app/
  api/chat/route.ts       ← POST endpoint (streamText + toDataStreamResponse)
  page.tsx                ← Main dashboard UI
  layout.tsx              ← Root layout (Inter + JetBrains Mono)
  globals.css             ← Design system tokens + animations

lib/
  config/models.ts        ← All model instances, dev/prod switching
  agents/
    orchestrator.ts       ← getOrchestratorConfig() factory
    analyst.ts            ← runAnalyst() — separate generateText() call
    evaluator.ts          ← runEvaluator() — separate generateText() call
  tools/
    parseSchema.ts        ← Parses OpenAPI/JSON Schema (pure TypeScript)
    validateRules.ts      ← Compliance rule engine (pure TypeScript)
    formatReport.ts       ← Markdown report formatter (pure TypeScript)
  types/
    agents.ts             ← ALL Zod schemas + inferred types (single source)

components/
  AgentThoughtStream.tsx  ← Live step-by-step thought panel
  ResultPanel.tsx         ← Structured audit report display

scripts/
  test-tools.ts           ← Unit tests (no LLM, no API key needed)
```

## Models

| Environment | Orchestrator | Analyst | Evaluator |
|-------------|-------------|---------|-----------|
| Development | `llama-3.1-8b-instant` | `llama-3.1-8b-instant` | `llama-3.1-8b-instant` |
| Production | `llama-3.3-70b-versatile` | `llama-3.1-8b-instant` | `llama-3.1-8b-instant` |

## TypeScript Compliance

- `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`
- Zero `any` types (except where the SDK forces it)
- Zero `@ts-ignore` / `@ts-expect-error`
- All types derived from Zod schemas via `z.infer<>`
- `safeParse()` on all external/LLM data — never `parse()` alone

## Deployment

Deploy to Vercel with one command:

```bash
npx vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard for automatic deploys.

**Environment variable — required:**

| Variable | Where to get it |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com (free tier) |

Set it in: **Vercel → Project → Settings → Environment Variables**

> **Free tier compatible:** This app uses Edge Runtime (`export const runtime = 'edge'`) on the `/api/chat` route. Vercel Hobby (free) plan supports Edge functions with streaming — the 10s serverless limit does not apply to streaming I/O. Groq's fast inference keeps typical audit runs at 8–15s.

---

*Built by Santosh Dubey — July 2026*
