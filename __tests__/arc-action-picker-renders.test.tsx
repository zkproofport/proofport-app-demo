import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DemoFields from '../app/components/DemoFields';
import { DEFAULT_OPTIONS, ARC_FIELD_TYPES } from '../lib/demo-policy';
import { DEMOS } from '../lib/demo-catalog';

/**
 * The Arc action picker is on screen, not just in the options type.
 *
 * A first version of this screen offered two JSON textareas — types and
 * message — which is not a demo, it is homework. This renders the component and
 * reads what a visitor would actually see.
 */
const arc = DEMOS.find(demo => demo.id === 'arc')!;
const render = (patch: Partial<typeof DEFAULT_OPTIONS> = {}) =>
  renderToStaticMarkup(<DemoFields demo={arc} options={{ ...DEFAULT_OPTIONS, ...patch }} onChange={() => {}} disabled={false} />);

describe('the Arc screen offers actions, not a JSON box', () => {
  it('shows the three named actions and the way to write your own', () => {
    const html = render();
    for (const label of ['Deposit', 'Withdraw', 'Transfer', 'Write your own']) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('<textarea');
  });

  it('asks for a recipient on 전송 and not on 예치', () => {
    expect(render({ arcAction: 'Transfer' })).toContain('id="arc-to"');
    expect(render({ arcAction: 'Deposit' })).not.toContain('id="arc-to"');
  });

  it('opens name-type-value rows when you write your own, with every type offered', () => {
    const html = render({ arcAction: 'custom' });
    expect(html).toContain('id="arc-custom-name"');
    expect(html).toContain('Add a field');
    for (const type of ARC_FIELD_TYPES) expect(html).toContain(`value="${type}"`);
    // One row per field the options carry, each with its own remove button.
    expect((html.match(/aria-label="Remove field /g) ?? []).length).toBe(DEFAULT_OPTIONS.arcCustomFields.length);
  });

  it('keeps the field rows out of sight until you ask for them', () => {
    expect(render({ arcAction: 'Deposit' })).not.toContain('Add a field');
  });

  it('never puts the chain or the verifier on screen as something to fill in', () => {
    const html = render({ arcAction: 'custom' });
    expect(html).not.toContain('5042002');
    expect(html.toLowerCase()).not.toContain('0xcbc8e63f');
  });
});
