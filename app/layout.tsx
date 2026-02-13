import type { Metadata } from 'next';
import { JetBrains_Mono, DM_Serif_Display } from 'next/font/google';
import './globals.css';

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-next',
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-serif-next',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ZKProofport - Mobile App Live Demo',
  description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
  },
  openGraph: {
    type: 'website',
    title: 'ZKProofport - Mobile App Live Demo',
    description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
    siteName: 'ZKProofport',
    images: [{ url: '/og-image.png', width: 1200, height: 630, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZKProofport - Mobile App Live Demo',
    description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${dmSerif.variable}`}>
      <body style={{
        background: '#0a0e14',
        color: '#e8dcc8',
        overflowX: 'hidden',
      }}>{children}</body>
    </html>
  );
}
