import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ZKPSwap - Compliant Decentralized Exchange',
  description: 'Privacy-preserving DEX with KYC compliance powered by ZKProofport zero-knowledge proofs.',
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png' },
      { url: '/favicon.ico', type: 'image/x-icon' },
    ],
  },
  openGraph: {
    type: 'website',
    title: 'ZKPSwap - Compliant Decentralized Exchange',
    description: 'Privacy-preserving DEX with KYC compliance powered by ZKProofport zero-knowledge proofs.',
    siteName: 'ZKProofport',
    images: [{ url: '/og-image.png', width: 1200, height: 630, type: 'image/png' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ZKPSwap - Compliant Decentralized Exchange',
    description: 'Privacy-preserving DEX with KYC compliance powered by ZKProofport zero-knowledge proofs.',
    images: ['/og-image.png'],
  },
};

export default function ZKPSwapLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
