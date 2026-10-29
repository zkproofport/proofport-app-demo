'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { CU_LANGUAGE_STORAGE_KEY, translateCu, type CuLanguage } from '@/lib/cu-i18n';

const CuLanguageContext = createContext<{
  language: CuLanguage;
  setLanguage: (language: CuLanguage) => void;
} | null>(null);

export function CuLanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<CuLanguage>('ko');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(CU_LANGUAGE_STORAGE_KEY);
      if (saved === 'ko' || saved === 'en') updateLanguage(saved);
    } catch {
      /* Language selection also works without storage. */
    }
  }, []);
  const setLanguage = (next: CuLanguage) => {
    updateLanguage(next);
    try {
      localStorage.setItem(CU_LANGUAGE_STORAGE_KEY, next);
    } catch {
      /* Keep the in-memory selection. */
    }
  };
  return (
    <CuLanguageContext.Provider value={{ language, setLanguage }}>{children}</CuLanguageContext.Provider>
  );
}

export function useCuLanguage() {
  const context = useContext(CuLanguageContext);
  if (!context) throw new Error('CU language provider is required');
  return {
    ...context,
    locale: context.language === 'ko' ? 'ko-KR' : 'en-US',
    t: (message: string, values?: Record<string, string | number>) =>
      translateCu(context.language, message, values),
  };
}

export function CuLanguageSelect() {
  const { language, setLanguage } = useCuLanguage();
  return (
    <div className="cu-language" role="group" aria-label="Language / 언어">
      <button type="button" lang="ko" aria-pressed={language === 'ko'} onClick={() => setLanguage('ko')}>
        한국어
      </button>
      <button type="button" lang="en" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>
        English
      </button>
    </div>
  );
}
