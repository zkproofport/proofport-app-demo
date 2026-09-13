import type { DemoDefinition } from '@/lib/demo-catalog';
import { REGIONS } from '@/lib/demo-catalog';
import type { ArcActionChoice, ArcCustomField, ArcFieldType, DemoOptions } from '@/lib/demo-policy';
import { ARC_ACTIONS, ARC_FIELD_TYPES } from '@/lib/demo-policy';

/** What each action is called on screen. The struct names stay English — a wallet renders them verbatim. */
const ACTION_LABELS: Record<(typeof ARC_ACTIONS)[number]['name'], string> = { Deposit: 'Deposit', Withdraw: 'Withdraw', Transfer: 'Transfer' };

const namedActionFields = (name: ArcActionChoice) => ARC_ACTIONS.find(action => action.name === name)?.fields ?? [];

const replaceField = (fields: ArcCustomField[], index: number, patch: Partial<ArcCustomField>): ArcCustomField[] =>
  fields.map((field, at) => (at === index ? { ...field, ...patch } : field));

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
    {demo.id === 'arc' && <>
      <span className="field-label" id="arc-action-label">Action</span>
      <div className="action-choices" role="radiogroup" aria-labelledby="arc-action-label">
        {[...ARC_ACTIONS.map(action => ({ name: action.name as ArcActionChoice, label: ACTION_LABELS[action.name] })),
          { name: 'custom' as ArcActionChoice, label: 'Write your own' }].map(choice =>
          <button key={choice.name} type="button" role="radio" aria-checked={options.arcAction === choice.name}
            className={options.arcAction === choice.name ? 'action-choice picked' : 'action-choice'}
            onClick={() => update({ arcAction: choice.name })} disabled={disabled}>{choice.label}</button>)}
      </div>

      {options.arcAction !== 'custom' && <>
        {namedActionFields(options.arcAction).some(field => field.name === 'to') && <>
          <label htmlFor="arc-to">Recipient</label>
          <input id="arc-to" value={options.arcTo} onChange={event => update({ arcTo: event.target.value })} spellCheck={false} autoCapitalize="none" autoCorrect="off" required />
        </>}
        <label htmlFor="arc-amount">Amount</label>
        <div className="age-input"><input id="arc-amount" value={options.arcAmount} onChange={event => update({ arcAmount: event.target.value })} inputMode="numeric" spellCheck={false} required aria-describedby="arc-amount-help" /><span>USDC units</span></div>
        <p id="arc-amount-help" className="field-help">Smallest units — 1000000 is one USDC.</p>
        <label htmlFor="arc-nonce">Nonce</label>
        <input id="arc-nonce" value={options.arcNonce} onChange={event => update({ arcNonce: event.target.value })} inputMode="numeric" spellCheck={false} required aria-describedby="arc-nonce-help" />
        <p id="arc-nonce-help" className="field-help">Makes this authorization single-use. Your wallet shows every field before you sign.</p>
      </>}

      {options.arcAction === 'custom' && <>
        <label htmlFor="arc-custom-name">Action name</label>
        <input id="arc-custom-name" value={options.arcCustomName} onChange={event => update({ arcCustomName: event.target.value })} spellCheck={false} autoCapitalize="none" autoCorrect="off" required aria-describedby="arc-custom-help" />
        <p id="arc-custom-help" className="field-help">The struct your wallet names when it asks you to sign — a grant of authority, a subscription, anything.</p>

        <span className="field-label">Fields</span>
        <ul className="custom-fields">
          {options.arcCustomFields.map((field, index) => <li key={index}>
            <input aria-label={`Field ${index + 1} name`} value={field.name} placeholder="name" spellCheck={false} autoCapitalize="none" autoCorrect="off"
              onChange={event => update({ arcCustomFields: replaceField(options.arcCustomFields, index, { name: event.target.value }) })} />
            <select aria-label={`Field ${index + 1} type`} value={field.type}
              onChange={event => update({ arcCustomFields: replaceField(options.arcCustomFields, index, { type: event.target.value as ArcFieldType }) })}>
              {ARC_FIELD_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
            <input aria-label={`Field ${index + 1} value`} value={field.value} placeholder="value" spellCheck={false} autoCapitalize="none" autoCorrect="off"
              onChange={event => update({ arcCustomFields: replaceField(options.arcCustomFields, index, { value: event.target.value }) })} />
            <button type="button" className="field-remove" aria-label={`Remove field ${index + 1}`} disabled={disabled || options.arcCustomFields.length === 1}
              onClick={() => update({ arcCustomFields: options.arcCustomFields.filter((_, at) => at !== index) })}>&times;</button>
          </li>)}
        </ul>
        <button type="button" className="field-add" disabled={disabled}
          onClick={() => update({ arcCustomFields: [...options.arcCustomFields, { name: '', type: 'string', value: '' }] })}>Add a field</button>
        <p className="field-help">Every field is hashed into what you sign. The circuit never reads them, so any structure is provable — and your wallet shows all of them before you agree.</p>
      </>}

      <p className="field-help">Chain and verifier are fixed — Arc Testnet, the contract we deployed. Everything else about this proof is the same Coinbase KYC check as the KYC demo.</p>
    </>}
    {demo.id === 'ownership' && <div className="anonymous-setting"><span>Personal field disclosure</span><strong>None selected</strong><p>Name, birth date, sex and phone number stay private.</p></div>}
  </fieldset>;
}
