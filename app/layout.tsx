import type { Metadata } from 'next';
import { JetBrains_Mono, DM_Serif_Display, Geist } from 'next/font/google';
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

const geist = Geist({ subsets: ['latin'], variable: '--font-demo-sans', display: 'swap' });

const siteTitle = 'ZKProofport | Live Demos';
const siteDescription = 'Explore live demos of private eligibility proofs for applications and AI agents.';
// A versioned URL lets link-preview crawlers fetch the corrected brand asset.
const socialImage = '/brand/zkproofport-social-20260919.png';

export const metadata: Metadata = {
  metadataBase: new URL('https://demo.zkproofport.app'),
  title: siteTitle,
  description: siteDescription,
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
  },
  openGraph: {
    type: 'website',
    title: siteTitle,
    description: siteDescription,
    siteName: 'ZKProofport',
    images: [{ url: socialImage, width: 1200, height: 630, type: 'image/png', alt: 'ZKProofport — Private eligibility for humans and AI agents. Built by Masse Labs.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: [{ url: socialImage, alt: 'ZKProofport — Private eligibility for humans and AI agents. Built by Masse Labs.' }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jetbrains.variable} ${dmSerif.variable} ${geist.variable}`}>
      <body style={{
        background: '#0a0e14',
        color: '#e8dcc8',
        overflowX: 'hidden',
      }}>{children}</body>
    </html>
  );
}
