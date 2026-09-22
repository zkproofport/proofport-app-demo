import { APP_STORE_URL, GOOGLE_PLAY_URL } from '@/lib/app-stores';

export default function AppDownloads({ compact = false }: { compact?: boolean }) {
  return <aside className={`app-downloads${compact ? ' app-downloads-compact' : ''}`} aria-label="Download ZKProofport">
    <p>{compact ? 'Need the app? Install ZKProofport, then return here.' : 'Start with the ZKProofport app. Install it before requesting a proof.'}</p>
    <div className="app-store-links">
      <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" aria-label="Download ZKProofport for iOS on the App Store">iOS · App Store <span aria-hidden="true">↗</span></a>
      <a href={GOOGLE_PLAY_URL} target="_blank" rel="noopener noreferrer" aria-label="Download ZKProofport for Android on Google Play">Android · Google Play <span aria-hidden="true">↗</span></a>
    </div>
  </aside>;
}
