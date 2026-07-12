/**
 * app/layout.tsx
 * Root layout — dark theme, Inter + JetBrains Mono fonts, global metadata.
 */
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Smart API Contract Auditor | House of Edtech',
  description:
    'A production-grade multi-agent AI system that audits OpenAPI and JSON Schema contracts against business rules — powered by Groq and the Vercel AI SDK.',
  keywords: [
    'API contract auditing',
    'OpenAPI',
    'JSON Schema',
    'multi-agent AI',
    'Groq',
    'Vercel AI SDK',
    'compliance',
  ],
  authors: [{ name: 'Your Name' }],
  openGraph: {
    title: 'Smart API Contract Auditor',
    description: 'Multi-agent AI-powered API schema compliance tool.',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>): React.JSX.Element {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="font-sans antialiased bg-background text-foreground">
        {children}
      </body>
    </html>
  )
}
