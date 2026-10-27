import localFont from 'next/font/local';

import { TooltipProvider } from '@/components/ui/tooltip';

import type { Metadata } from 'next';

import './globals.css';

const archivo = localFont({
  variable: '--font-archivo',
  display: 'swap',
  src: [
    {
      path: '../../node_modules/@fontsource/archivo/files/archivo-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/archivo/files/archivo-latin-500-normal.woff2',
      weight: '500',
      style: 'normal',
    },
  ],
});

const spaceMono = localFont({
  variable: '--font-space-mono',
  display: 'swap',
  src: '../../node_modules/@fontsource/space-mono/files/space-mono-latin-400-normal.woff2',
  weight: '400',
});

export const metadata: Metadata = {
  title: {
    default: 'Action Integrity',
    template: '%s · Action Integrity',
  },
  description: 'Governed action safety, recovery, and verified business-state restoration.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${spaceMono.variable}`}>
      <body className="min-h-screen antialiased">
        <a
          href="#main-content"
          className="fixed left-4 top-4 z-50 -translate-y-24 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-transform focus:translate-y-0"
        >
          Skip to main content
        </a>
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
