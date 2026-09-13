import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoExperience from '../app/components/DemoExperience';
import DemoFields from '../app/components/DemoFields';
import { DEFAULT_OPTIONS } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * Open every tab, for real.
 *
 * Twice in one day the Arc tab crashed or showed the Korean mobile ID screen —
 * once because the screen chooser ended in an unconditional return, once
 * because a wording lookup that belongs inside the Korean ID branch sat above
 * every branch and threw for Arc. Both were invisible to tests that read source
 * text. This renders each tab and reads what comes out.
 */
describe('every tab renders its own screen', () => {
  it('discloses Arc candidate-address checking and describes any selected instruction', () => {
    const demo = DEMOS.find(item => item.id === 'arc')!;
    const html = renderToStaticMarkup(
      <DemoExperience demo={demo} options={{...DEFAULT_OPTIONS, arcAction: 'Transfer'}} panel={<p>panel</p>} onSelect={() => {}} verified={false} />,
    );
    expect(html).toContain('anyone test a candidate KYC wallet address');
    expect(html).toContain('This exact instruction was authorized.');
    expect(html).not.toContain('This exact deposit was authorized.');
    expect(JSON.stringify(demo)).toContain('candidate KYC wallet address');
    expect(JSON.stringify(demo)).not.toContain('wallet stay private');
  });

  for (const demo of DEMOS) {
    it(`${demo.tab} opens without throwing`, () => {
      const html = renderToStaticMarkup(
        <DemoExperience demo={demo} options={DEFAULT_OPTIONS} panel={<p>panel</p>} onSelect={() => {}} verified={false} />,
      );
      expect(html).toContain(demo.brand);
      expect(html).toContain('panel');
    });

    it(`${demo.tab} shows its own fields`, () => {
      const html = renderToStaticMarkup(
        <DemoFields demo={demo} options={DEFAULT_OPTIONS} onChange={() => {}} disabled={false} />,
      );
      expect(html).toContain('</fieldset>');
    });
  }

  it('says which demo has no screen rather than showing another one', () => {
    const invented = { ...DEMOS[0], id: 'not-a-demo' as never, brand: 'Nobody' };
    expect(() => renderToStaticMarkup(
      <DemoExperience demo={invented} options={DEFAULT_OPTIONS} panel={<p>panel</p>} onSelect={() => {}} verified={false} />,
    )).toThrow(/No demo screen for 'not-a-demo'/);
  });
});
