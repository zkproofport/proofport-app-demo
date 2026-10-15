// The ZKProofport marks come from the brand kit's files in
// public/brand/zkproofport/, through lib/brand.ts only. public/logo.png was
// moved there on 2026-10-15; a component naming the old path fails here.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ZKProofportWordmark from '../app/components/ZKProofportWordmark';
import { WORDMARK_ASPECT, ZKPROOFPORT_SYMBOL, ZKPROOFPORT_WORDMARK } from '../lib/brand';

const ROOT = join(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const full = join(dir, entry.name);
  return entry.isDirectory() ? files(full) : /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
});

describe('ZKProofport brand marks', () => {
  it('serves every mark from the brand folder, and the old logo is gone', () => {
    for (const path of [ZKPROOFPORT_SYMBOL, ZKPROOFPORT_WORDMARK.onDark, ZKPROOFPORT_WORDMARK.onLight]) {
      expect(path.startsWith('/brand/zkproofport/')).toBe(true);
      expect(existsSync(join(ROOT, 'public', path))).toBe(true);
    }
    expect(existsSync(join(ROOT, 'public', 'logo.png'))).toBe(false);
  });

  it('names no mark by path outside lib/brand.ts', () => {
    const naming = [...files(join(ROOT, 'app')), ...files(join(ROOT, 'lib'))]
      .filter(file => /['"]\/(logo\.png|brand\/zkproofport\/)/.test(readFileSync(file, 'utf8')))
      .map(file => relative(ROOT, file));
    expect(naming).toEqual(['lib/brand.ts']);
  });

  it('puts both wordmarks in the page and lets CSS pick by background', () => {
    const html = renderToStaticMarkup(<ZKProofportWordmark />);
    expect(html).toContain('aria-label="ZKProofport"');
    expect(html).toContain(`class="zkp-wordmark-on-light" src="${ZKPROOFPORT_WORDMARK.onLight}"`);
    expect(html).toContain(`class="zkp-wordmark-on-dark" src="${ZKPROOFPORT_WORDMARK.onDark}"`);
    expect(html).toContain(`width="160" height="${Math.round(160 / WORDMARK_ASPECT)}"`);
    const css = readFileSync(join(ROOT, 'app', 'components', 'demos.css'), 'utf8');
    for (const dark of [".demo-suite[data-theme='dark']", ".demo-suite[data-theme='system']", ".demo-suite[data-active='all'] > .demo-switcher"]) {
      expect(css).toContain(`${dark} .zkp-wordmark .zkp-wordmark-on-dark`);
    }
  });

  it.each([['dark', ZKPROOFPORT_WORDMARK.onDark], ['light', ZKPROOFPORT_WORDMARK.onLight]] as const)('pins the %s-background wordmark when asked', (background, src) => {
    const html = renderToStaticMarkup(<ZKProofportWordmark background={background} width={200} />);
    expect(html).toContain(`<img class="zkp-wordmark-fixed" src="${src}" alt="ZKProofport" width="200" height="44"/>`);
  });
});
