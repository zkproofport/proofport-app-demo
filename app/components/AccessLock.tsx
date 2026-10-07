import { LockKey, LockKeyOpen } from '@phosphor-icons/react';

export default function AccessLock({ unlocked, size = 28 }: { unlocked: boolean; size?: number }) {
  return <span className={`access-lock${unlocked ? ' is-open' : ''}`} aria-hidden="true" style={{ width: size, height: size }}>
    <LockKey className="access-lock-closed" size={size} weight="light" />
    <LockKeyOpen className="access-lock-open" size={size} weight="light" />
  </span>;
}
