'use client';

import { useEffect, useState, type ReactNode, type KeyboardEvent } from 'react';
import { CircleHalf } from '@phosphor-icons/react';
import { DEMOS, type DemoId } from '@/lib/demo-catalog';
import CircuitDemo from './CircuitDemo';
import GiwaDemo from './GiwaDemo';
import AppDownloads from './AppDownloads';
import './demos.css';

type Tab = DemoId | 'all';
type Theme = 'system' | 'light' | 'dark';
const DEFAULT_TAB: Tab = 'kyc';
const tabs: { id: Tab; label: string; status?: 'Live' | 'PoC' }[] = [
  { id: 'kyc', label: 'Markets', status: 'Live' },
  { id: 'country', label: 'Borderless', status: 'Live' },
  { id: 'email', label: 'zk blind', status: 'Live' },
  { id: 'ownership', label: 'Korean ID', status: 'PoC' },
  { id: 'giwa', label: 'Gotgan', status: 'PoC' },
  { id: 'all', label: 'All demos' },
];

export default function DemoTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>(DEFAULT_TAB);
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([DEFAULT_TAB]));
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get('tab');
      const next: Tab = value === 'all' ? 'all' : DEMOS.find(item => item.id === value)?.id ?? DEFAULT_TAB;
      setTab(next);
      setVisited(previous => new Set([...previous, next]));
    };
    sync();
    try {
      const saved = localStorage.getItem('proofport-demo-theme');
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    } catch { /* System preference remains available when storage is disabled. */ }
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => {
    const title = tab === 'giwa' ? 'Gotgan — A KYC-gated vault on GIWA' : tab === 'all' ? 'All demos | ZKProofport' : `${DEMOS.find(demo => demo.id === tab)?.brand} | ZKProofport demos`;
    const syncTitle = () => { if (document.title !== title) document.title = title; };
    syncTitle();
    const frame = requestAnimationFrame(syncTitle);
    const icon = document.createElement('link');
    icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.sizes.add('any');
    icon.href = tab === 'giwa' ? '/brand/gotgan-app-icon.svg' : '/favicon.png';
    if (tab !== 'giwa') icon.type = 'image/png';
    document.head.appendChild(icon);
    return () => { cancelAnimationFrame(frame); icon.remove(); };
  }, [tab]);

  const navTab = tab === 'age' || tab === 'region' ? 'ownership' : tab;

  function select(next: Tab) {
    setTab(next);
    setVisited(previous => new Set([...previous, next]));
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    select(tabs[next].id);
    document.getElementById(`demo-tab-${tabs[next].id}`)?.focus();
  }
  function changeTheme(value: Theme) {
    setTheme(value);
    try { localStorage.setItem('proofport-demo-theme', value); } catch { /* Theme still works for this session. */ }
  }

  return <div className="demo-suite" data-theme={theme} data-active={tab}>
    <a className="demo-skip" href={tab === 'all' ? '#demo-panel-all' : `#content-${tab}`}>Skip to demo</a>
    <nav className="demo-switcher" aria-label="ZKProofport demos">
      <button className="demo-switcher-brand" onClick={() => select(DEFAULT_TAB)} aria-label="ZKProofport demo home"><img src="/logo.png" alt="" width={25} height={25} /><span>ZKProofport<small>Live demos</small></span></button>
      <div role="tablist" aria-label="Choose a demo">
        {tabs.map((item, index) => <button key={item.id} id={`demo-tab-${item.id}`} role="tab" aria-selected={navTab === item.id} aria-controls={`demo-panel-${item.id === 'ownership' && ['age', 'region'].includes(tab) ? tab : item.id}`} tabIndex={navTab === item.id || (navTab === 'arc' && index === 0) ? 0 : -1} onClick={() => select(item.id)} onKeyDown={event => navigate(event, index)}>
          {item.label}
          {item.status && <span className="demo-status-badge" data-status={item.status}>{item.status}</span>}
        </button>)}
      </div>
      <label className="theme-control"><CircleHalf size={18} /><span className="sr-only">Color theme</span><select aria-label="Color theme" value={theme} onChange={event => changeTheme(event.target.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </nav>
    {tab !== 'all' && <AppDownloads />}
    {DEMOS.map(demo => <div key={demo.id} id={`demo-panel-${demo.id}`} role="tabpanel" aria-label={demo.id === 'arc' ? demo.tab : undefined} aria-labelledby={demo.id === 'arc' ? undefined : `demo-tab-${['age', 'region'].includes(demo.id) ? 'ownership' : demo.id}`} hidden={tab !== demo.id}>{visited.has(demo.id) && (demo.id === 'giwa' ? <GiwaDemo /> : <CircuitDemo demo={demo} onSelect={select} />)}</div>)}
    <div id="demo-panel-all" className="explorer-panel" role="tabpanel" aria-labelledby="demo-tab-all" tabIndex={-1} hidden={tab !== 'all'}>{children}</div>
  </div>;
}
