import { describe, expect, it } from 'vitest';
import { ALL_CIRCUIT_IDS, isCircuitId } from '@zkproofport-app/sdk';
import { DEMO_CIRCUITS, DEMOS, demoById, type DemoId } from '../lib/demo-catalog';
import { DEMO_VERIFIERS } from '../lib/demo-policy';
import { CARD_SCOPES, LIVE_SECTION_SCOPES, cardScope, liveSectionScope } from '../lib/demo-scopes';
import { VERIFIER_DEPLOYMENTS, verifierAddress } from '../lib/verifier-deployments';

/**
 * The three Korean ID circuits left the demo and the SDK on 2026-10-29. An id
 * that is no longer served must be an error that names what IS known, never a
 * row that quietly resolves to something: every lookup keyed by these ids is
 * asked here, so a stray row added back fails by name.
 */
const GONE = ['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'] as const;
const GONE_TABS = ['ownership', 'age', 'region'] as const;

describe.each(GONE)('%s is unknown', circuit => {
  it('to the published SDK', () => {
    expect(isCircuitId(circuit)).toBe(false);
    expect(ALL_CIRCUIT_IDS as readonly string[]).not.toContain(circuit);
  });

  it('to the demo catalog and its keyed tables', () => {
    expect(DEMO_CIRCUITS as readonly string[]).not.toContain(circuit);
    expect(DEMOS.map(demo => demo.circuit as string)).not.toContain(circuit);
    expect(Object.keys(DEMO_VERIFIERS)).not.toContain(circuit);
    expect(Object.keys(VERIFIER_DEPLOYMENTS)).not.toContain(circuit);
    expect(Object.keys(LIVE_SECTION_SCOPES)).not.toContain(circuit);
  });

  it('to the verifier lookup, which names the known circuits', () => {
    expect(() => verifierAddress(circuit, 84532)).toThrow(
      new RegExp(`No verifier table for circuit '${circuit}'\\. Known: ${Object.keys(VERIFIER_DEPLOYMENTS).join(', ')}\\.`),
    );
  });

  it('to the live-section scope lookup, which names the known circuits', () => {
    expect(() => liveSectionScope(circuit)).toThrow(
      `No scope for circuit '${circuit}' in the live section. Known: ${Object.keys(LIVE_SECTION_SCOPES).join(', ')}.`,
    );
  });
});

describe.each(GONE_TABS)("the '%s' tab is unknown", id => {
  it('to the catalog', () => {
    expect(demoById(id)).toBeUndefined();
  });

  it('to the card scope lookup, which names the known demos', () => {
    expect(() => cardScope(id as unknown as DemoId)).toThrow(
      `No scope for demo '${id}'. Known: ${Object.keys(CARD_SCOPES).join(', ')}.`,
    );
  });
});
