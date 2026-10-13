import type { DemoDefinition } from '@/lib/demo-catalog';
import { REGIONS } from '@/lib/demo-catalog';
import type { DemoOptions } from '@/lib/demo-policy';

type Props = { demo: DemoDefinition; options: DemoOptions; onChange: (options: DemoOptions) => void; disabled: boolean };

export default function DemoFields({ demo, options, onChange, disabled }: Props) {
  const update = (patch: Partial<DemoOptions>) => onChange({ ...options, ...patch });
  return <fieldset className="proof-fields" disabled={disabled}>
    <legend className="sr-only">{demo.tab} proof requirements</legend>
    {demo.id === 'country' && <>
      <label htmlFor="country-codes">Blocked country codes</label>
      <input id="country-codes" value={options.countries} onChange={event => update({ countries: event.target.value })} aria-describedby="country-help" autoCapitalize="characters" spellCheck={false} required />
      <p id="country-help" className="field-help">Example blocklist. Edit up to 10 country codes.</p>
      <p className="exclusion-policy">Required result: NOT in this list.</p>
    </>}
    {demo.id === 'email' && <>
      <label htmlFor="email-domain">Organization domain</label>
      <input id="email-domain" value={options.domain} onChange={event => update({ domain: event.target.value })} placeholder="company.com" autoCapitalize="none" autoCorrect="off" spellCheck={false} required aria-describedby="domain-help" />
      <p id="domain-help" className="field-help">Use your work domain, not your full email.</p>
      <label htmlFor="email-provider">Sign-in provider</label>
      <select id="email-provider" value={options.provider} onChange={event => update({ provider: event.target.value as DemoOptions['provider'] })}>
        <option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option>
      </select>
    </>}
    {demo.id === 'age' && <>
      <label htmlFor="age-threshold">Minimum age</label>
      <div className="age-input"><input id="age-threshold" type="number" min="1" max="150" step="1" required value={options.age} onChange={event => update({ age: event.target.value })} aria-describedby="age-help" /><span>years</span></div>
      <p id="age-help" className="field-help">Checks birth year against the current year.</p>
    </>}
    {demo.id === 'region' && <>
      <label htmlFor="residency-region">Resident region</label>
      <select id="residency-region" value={options.region} onChange={event => update({ region: event.target.value })} aria-describedby="region-help">
        {REGIONS.map(region => <option key={region.value} value={region.value}>{region.label}</option>)}
      </select>
      <p id="region-help" className="field-help">Your street address stays private.</p>
    </>}
    {demo.id === 'ownership' && <div className="anonymous-setting"><span>Personal field disclosure</span><strong>None selected</strong><p>Name, birth date, sex and phone number stay private.</p></div>}
  </fieldset>;
}
