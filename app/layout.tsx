import type { Metadata } from 'next'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import InitialLoader from '@/components/initial-loader'
import './globals.css'

export const metadata: Metadata = {
  title: 'Trade-karo — AI-Powered Stock Dashboard',
  description: 'Real-time stock analysis and portfolio management',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/trade-karo-mark.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/trade-karo-mark.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/trade-karo-mark.png',
        type: 'image/png',
      },
    ],
    apple: '/trade-karo-mark.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <InitialLoader />
          {children}
          <Analytics />
        </ThemeProvider>
      </body>
    </html>
  )
}
