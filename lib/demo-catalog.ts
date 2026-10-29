import { CIRCUIT_IDS, type CircuitId } from '@zkproofport-app/sdk';

/**
 * The circuits this demo has a tab for -- named here, not taken from the SDK's
 * full list, so the tables keyed by circuit (verifiers, public-input counts)
 * hold exactly these rows and a circuit the SDK adds is not silently required.
 */
export const DEMO_CIRCUITS = [
  CIRCUIT_IDS.GIWA_ATTESTATION, CIRCUIT_IDS.DOJANG_PLAYGROUND, CIRCUIT_IDS.COINBASE_ATTESTATION, CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION,
  CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION,
] as const;
export type DemoCircuit = (typeof DEMO_CIRCUITS)[number];

/**
 * SDK circuits this demo deliberately has no tab for. Each row is a decision,
 * so a circuit the SDK adds still fails the coverage test until someone either
 * gives it a tab or lists it here.
 *
 * Empty since `dojang_playground` got the Ssiat tab (lib/useSsiatDrop.ts).
 */
export const SDK_CIRCUITS_WITHOUT_A_DEMO: readonly CircuitId[] = [];

export type DemoId = 'giwa' | 'ssiat' | 'kyc' | 'country' | 'email';
export type DemoDefinition = {
  id: DemoId; circuit: DemoCircuit; tab: string; brand: string; category: string;
  headline: string; description: string; image: number; imageAlt: string;
  actionTitle: string; actionDescription: string; credential: string; hides: string;
  outcomeTitle: string; outcomeDescription: string; outcomeItems: { title: string; description: string }[];
  note: string; experimental: boolean;
};

export const DEMOS: readonly DemoDefinition[] = [
{
  circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
  "id": "giwa",
  "tab": "Gotgan",
  "brand": "Gotgan",
  "category": "Institutional KRW treasury",
  "headline": "Institutional KRW vault.",
  "description": "Gotgan, a KYC-gated vault on GIWA for institutional KRW treasuries.",
  "image": 0,
  "imageAlt": "",
  "actionTitle": "Prove deposit eligibility",
  "actionDescription": "Prove GIWA test-attestation eligibility for your operational wallet's dKRW deposit.",
  "credential": "Upbit KYC · Test attestation",
  "hides": "The underlying KYC account address",
  "outcomeTitle": "Deposit eligibility verified.",
  "outcomeDescription": "The Vault checks your proof before accepting the deposit.",
  "outcomeItems": [
    { "title": "Verified condition", "description": "GIWA test-attestation eligibility" },
    { "title": "Private information", "description": "The underlying KYC account address is not sent to the Vault." }
  ],
  "note": "GIWA Sepolia testnet vault. dKRW has no KRW backing or monetary value. Test attestation models Upbit KYC; production integration is pending. No yield is generated.",
  "experimental": true
},
{
  circuit: CIRCUIT_IDS.DOJANG_PLAYGROUND,
  "id": "ssiat",
  "tab": "Ssiat",
  "brand": "Ssiat",
  "category": "Seed drop for early GIWA testers",
  "headline": "Plant a seed. Claim once.",
  "description": "Ssiat, a fictional testnet drop for wallets that issued themselves a Dojang through the GIWA Playground faucet.",
  "image": 7,
  "imageAlt": "",
  "actionTitle": "Prove you used the Playground faucet",
  "actionDescription": "Prove your faucet wallet signed a Playground Dojang issuance, and sign the claim for the wallet that receives the seeds.",
  "credential": "Signed a GIWA Playground faucet issuance",
  "hides": "Which faucet wallet is claiming",
  "outcomeTitle": "Seeds claimed.",
  "outcomeDescription": "The drop checked your proof on GIWA Sepolia and sent SEED to the recipient you signed for.",
  "outcomeItems": [
    { "title": "Verified condition", "description": "The faucet wallet signed a payAndIssueEAS() call to the GIWA Playground faucet" },
    { "title": "Private information", "description": "The faucet wallet's address is not sent to the drop contract." }
  ],
  "note": "Fictional brand on GIWA Sepolia testnet; not a GIWA, Upbit or Dojang airdrop. SEED has no value. The proof shows the faucet wallet signed a Playground issuance, not that the transaction was mined, so the drop is open to anyone who builds a proof by hand.",
  "experimental": true
},
{
  circuit: CIRCUIT_IDS.COINBASE_ATTESTATION,
  "id": "kyc",
  "tab": "Markets",
  "brand": "Common",
  "category": "Private DeFi access",
  "headline": "DeFi. For verified people.",
  "description": "Coinbase KYC gets you in. The original KYC account address is not included in the proof.",
  "image": 1,
  "imageAlt": "",
  "actionTitle": "Unlock the markets",
  "actionDescription": "Prove Coinbase KYC to access this example DeFi workspace.",
  "credential": "Coinbase KYC completed",
  "hides": "The original KYC account address",
  "outcomeTitle": "Your market access is verified.",
  "outcomeDescription": "Your Coinbase account proof passed verification. Explore the example workspace.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Coinbase KYC completed"
    },
    {
      "title": "Private information",
      "description": "The original KYC account address is not included in the proof."
    }
  ],
  "note": "DeFi interface demonstration only. No deposits, borrowing, returns or transactions are provided. The circuit does not establish current EAS revocation or expiry status.",
  "experimental": false
},
{
  circuit: CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION,
  "id": "country",
  "tab": "Borderless",
  "brand": "Borderless",
  "category": "Private eligibility",
  "headline": "Prove you’re not on the list.",
  "description": "Show that your country is outside a blocklist. Keep your actual country private.",
  "image": 2,
  "imageAlt": "",
  "actionTitle": "Check your eligibility",
  "actionDescription": "Prove your Coinbase-attested country is not in the selected blacklist.",
  "credential": "Country is NOT in the blocklist",
  "hides": "Your actual country and original wallet",
  "outcomeTitle": "You meet the country policy.",
  "outcomeDescription": "Your proof confirms that your country is outside the selected blocklist.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Country is NOT in the blocklist"
    },
    {
      "title": "Private information",
      "description": "Your actual country and original wallet stay private."
    }
  ],
  "note": "The editable example blocklist is a demo policy, not a legal sanctions list. The country policy is public; the credential country remains private.",
  "experimental": false
},
{
  circuit: CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION,
  "id": "email",
  "tab": "zkBlind",
  "brand": "zk blind",
  "category": "Work is better off the record.",
  "headline": "Real colleagues. Real anonymity.",
  "description": "The conversations you want to have. Without your work email attached.",
  "image": 3,
  "imageAlt": "",
  "actionTitle": "Find your company",
  "actionDescription": "Verify your work domain to enter an anonymous company space.",
  "credential": "Work email domain membership",
  "hides": "Your full email and sign-in token",
  "outcomeTitle": "You’re in the company space.",
  "outcomeDescription": "Your proof matches the requested work domain and sign-in provider.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Work email domain membership"
    },
    {
      "title": "Private information",
      "description": "Your full email and sign-in token stay private."
    }
  ],
  "note": "Independent fictional workplace-community demo, not affiliated with Blind. Sample discussions are illustrative. Production integrations must separately enforce provider-key trust and token freshness.",
  "experimental": false
}
];

export const demoById = (id: string) => DEMOS.find(demo => demo.id === id);
