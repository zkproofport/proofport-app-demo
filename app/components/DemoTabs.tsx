'use client';

import { useEffect, useState, type ReactNode, type KeyboardEvent } from 'react';
import { CircleHalf } from '@phosphor-icons/react';
import { DEMOS, type DemoId } from '@/lib/demo-catalog';
import CircuitDemo from './CircuitDemo';
import './demos.css';

type Tab = DemoId | 'all';
type Theme = 'system' | 'light' | 'dark';
const tabs: { id: Tab; label: string }[] = [...DEMOS.filter(demo => !['age', 'region'].includes(demo.id)).map(demo => ({ id: demo.id, label: demo.id === 'ownership' ? 'Korean ID' : demo.tab })), { id: 'all', label: 'All demos' }];

export default function DemoTabs({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('giwa');
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['giwa']));
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const sync = () => {
      const value = new URLSearchParams(window.location.search).get('tab');
      const next: Tab = value === 'all' ? 'all' : DEMOS.find(item => item.id === value)?.id ?? 'giwa';
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
    document.title = tab === 'all' ? 'All demos | ZKProofport' : `${DEMOS.find(demo => demo.id === tab)?.brand} | ZKProofport demos`;
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
      <button className="demo-switcher-brand" onClick={() => select('giwa')} aria-label="ZKProofport demo home"><img src="/logo.png" alt="" width={25} height={25} /><span>ZKProofport<small>Live demos</small></span></button>
      <div role="tablist" aria-label="Choose a demo">
        {tabs.map((item, index) => <button key={item.id} id={`demo-tab-${item.id}`} role="tab" aria-selected={navTab === item.id} aria-controls={`demo-panel-${item.id === 'ownership' && ['age', 'region'].includes(tab) ? tab : item.id}`} tabIndex={navTab === item.id ? 0 : -1} onClick={() => select(item.id)} onKeyDown={event => navigate(event, index)}>{item.label}</button>)}
      </div>
      <label className="theme-control"><CircleHalf size={18} /><span className="sr-only">Color theme</span><select aria-label="Color theme" value={theme} onChange={event => changeTheme(event.target.value as Theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </nav>
    {DEMOS.map(demo => <div key={demo.id} id={`demo-panel-${demo.id}`} role="tabpanel" aria-labelledby={`demo-tab-${['age', 'region'].includes(demo.id) ? 'ownership' : demo.id}`} hidden={tab !== demo.id}>{visited.has(demo.id) && <CircuitDemo demo={demo} onSelect={select} />}</div>)}
    <div id="demo-panel-all" className="explorer-panel" role="tabpanel" aria-labelledby="demo-tab-all" tabIndex={-1} hidden={tab !== 'all'}>{children}</div>
  </div>;
}
