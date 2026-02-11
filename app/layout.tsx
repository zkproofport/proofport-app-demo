import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ZKProofport - Privacy-First Identity Verification',
  description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
  },
  openGraph: {
    type: 'website',
    title: 'ZKProofport - Privacy-First Identity Verification',
    description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
    siteName: 'ZKProofport',
    images: [{ url: '/og-image.png', width: 1200, height: 630, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZKProofport - Privacy-First Identity Verification',
    description: 'Zero-knowledge proof verification for dApps. Prove KYC, country, and age without revealing personal data.',
    images: ['/og-image.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{
        background: '#0a0f1e',
        color: '#f3f4f6',
        overflowX: 'hidden',
      }}>{children}</body>
    </html>
  );
}
