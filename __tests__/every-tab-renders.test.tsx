import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoExperience from '../app/components/DemoExperience';
import DemoFields from '../app/components/DemoFields';
import DemoTabs, { DEDICATED_SCREENS } from '../app/components/DemoTabs';
import { DEFAULT_OPTIONS } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * Open every tab, for real.
 *
 * Twice in one day a new tab crashed or showed the Korean mobile ID screen —
 * once because the screen chooser ended in an unconditional return, once
 * because a wording lookup that belongs inside the Korean ID branch sat above
 * every branch and threw for the new tab. Both were invisible to tests that
 * read source text. This renders each tab and reads what comes out.
 */
/** Text only a dedicated screen renders, so the wrong screen cannot pass for it. */
const SCREEN_MARKERS: Partial<Record<string, string>> = { giwa: 'Manage vault deposits', ssiat: 'Seeds left in the drop' };

describe('every tab renders its own screen', () => {
  it('has a marker for every dedicated screen', () => {
    for (const id of Object.keys(DEDICATED_SCREENS)) expect(SCREEN_MARKERS[id], id).toBeTruthy();
  });

  for (const demo of DEMOS) {
    it(`${demo.tab} opens without throwing`, () => {
      const dedicated = DEDICATED_SCREENS[demo.id];
      const html = renderToStaticMarkup(
        dedicated
          ? <dedicated.Screen />
          : <DemoExperience demo={demo} options={DEFAULT_OPTIONS} panel={<p>panel</p>} onSelect={() => {}} verified={false} />,
      );
      expect(html).toContain(demo.brand);
      expect(html).toContain(SCREEN_MARKERS[demo.id] ?? 'panel');
    });

    it(`${demo.tab} shows its own fields`, () => {
      const html = renderToStaticMarkup(
        <DemoFields demo={demo} options={DEFAULT_OPTIONS} onChange={() => {}} disabled={false} />,
      );
      expect(html).toContain('</fieldset>');
    });
  }

  it('opens Markets on the initial render', () => {
    const html = renderToStaticMarkup(<DemoTabs><p>all demos</p></DemoTabs>);
    expect(html).toContain('data-active="kyc"');
    expect(html).toContain('Unlock the markets');
    expect(html).not.toContain('Total vault deposits');
  });

  it('says which demo has no screen rather than showing another one', () => {
    const invented = { ...DEMOS[0], id: 'not-a-demo' as never, brand: 'Nobody' };
    expect(() => renderToStaticMarkup(
      <DemoExperience demo={invented} options={DEFAULT_OPTIONS} panel={<p>panel</p>} onSelect={() => {}} verified={false} />,
    )).toThrow(/No demo screen for 'not-a-demo'/);
  });
});
