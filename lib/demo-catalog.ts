import { CIRCUIT_IDS, type CircuitType } from '@zkproofport-app/sdk';

export type DemoId = 'giwa' | 'kyc' | 'country' | 'email' | 'ownership' | 'age' | 'region';
export type DemoDefinition = {
  id: DemoId; circuit: CircuitType; tab: string; brand: string; category: string;
  headline: string; description: string; image: number; imageAlt: string;
  actionTitle: string; actionDescription: string; credential: string; hides: string;
  outcomeTitle: string; outcomeDescription: string; outcomeItems: { title: string; description: string }[];
  note: string; experimental: boolean;
};

export const DEMOS: readonly DemoDefinition[] = [
{
  circuit: CIRCUIT_IDS.GIWA_ATTESTATION,
  "id": "giwa",
  "tab": "GIWA",
  "brand": "Madang",
  "category": "Private community on GIWA",
  "headline": "More opens up when you belong.",
  "description": "Private dinners, member-only drops and community access through an Upbit KYC proof.",
  "image": 0,
  "imageAlt": "People and AI agents sharing a contemporary Korean courtyard",
  "actionTitle": "Enter the community privately",
  "actionDescription": "Prove your Upbit KYC attestation on GIWA without sharing your KYC-linked wallet.",
  "credential": "Upbit KYC → GIWA EAS",
  "hides": "Your identity and KYC-linked wallet",
  "outcomeTitle": "Welcome to Madang.",
  "outcomeDescription": "Your GIWA account proof passed verification. The example community is open.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Upbit KYC → GIWA EAS"
    },
    {
      "title": "Private information",
      "description": "Your identity and KYC-linked wallet stay private."
    }
  ],
  "note": "GIWA Sepolia PoC using a test attestation that models Upbit KYC → GIWA EAS. Production Dojang integration is pending. Agent participation is a community concept; this proof does not authenticate or authorize agents.",
  "experimental": true
},
{
  circuit: CIRCUIT_IDS.COINBASE_ATTESTATION,
  "id": "kyc",
  "tab": "KYC",
  "brand": "Common",
  "category": "Private DeFi access",
  "headline": "DeFi. For verified people.",
  "description": "Coinbase KYC gets you in. Your identity stays with you.",
  "image": 1,
  "imageAlt": "",
  "actionTitle": "Unlock the markets",
  "actionDescription": "Prove Coinbase KYC to access this example DeFi workspace.",
  "credential": "Coinbase KYC completed",
  "hides": "Your identity and original wallet",
  "outcomeTitle": "Your market access is verified.",
  "outcomeDescription": "Your Coinbase account proof passed verification. Explore the example workspace.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Coinbase KYC completed"
    },
    {
      "title": "Private information",
      "description": "Your identity and original wallet stay private."
    }
  ],
  "note": "DeFi interface demonstration only. No deposits, borrowing, returns or transactions are provided. The circuit does not establish current EAS revocation or expiry status.",
  "experimental": false
},
{
  circuit: CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION,
  "id": "country",
  "tab": "Country",
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
  "tab": "Work email",
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
},
{
  circuit: CIRCUIT_IDS.MDL_KR_OWNERSHIP,
  "id": "ownership",
  "tab": "Mobile ID",
  "brand": "Korean Mobile ID",
  "category": "From identity to a private answer.",
  "headline": "Your ID. Less revealed.",
  "description": "Turn a Korean mobile ID into a proof of only what a service needs.",
  "image": 4,
  "imageAlt": "",
  "actionTitle": "Prove ID ownership",
  "actionDescription": "Demonstrate mobile ID ownership with all personal disclosure fields switched off.",
  "credential": "Mobile ID ownership",
  "hides": "Name, birth date, sex and phone number",
  "outcomeTitle": "Ownership proof verified.",
  "outcomeDescription": "Your experimental ownership proof passed with personal disclosure switched off.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Mobile ID ownership"
    },
    {
      "title": "Private information",
      "description": "Name, birth date, sex and phone number stay private."
    }
  ],
  "note": "Experimental mobile ID predicate on Base Sepolia. The current circuit does not cryptographically authenticate the credential issuer.",
  "experimental": true
},
{
  circuit: CIRCUIT_IDS.MDL_KR_AGE,
  "id": "age",
  "tab": "Age",
  "brand": "Korean Mobile ID",
  "category": "From identity to a private answer.",
  "headline": "Your ID. Less revealed.",
  "description": "Turn a Korean mobile ID into a proof of only what a service needs.",
  "image": 5,
  "imageAlt": "",
  "actionTitle": "Prove the age condition",
  "actionDescription": "Check an adult-purchase requirement without sharing your birth date.",
  "credential": "Age is above the requested threshold",
  "hides": "Your birth date and identity",
  "outcomeTitle": "Age condition verified.",
  "outcomeDescription": "Your proof passed the requested threshold check. Your birth date remains private.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Age is above the requested threshold"
    },
    {
      "title": "Private information",
      "description": "Your birth date and identity stay private."
    }
  ],
  "note": "Experimental Base Sepolia demo. Age uses current year minus birth year, not exact birthday age. Issuer authentication is not circuit-enforced.",
  "experimental": true
},
{
  circuit: CIRCUIT_IDS.MDL_KR_REGION,
  "id": "region",
  "tab": "Region",
  "brand": "Korean Mobile ID",
  "category": "From identity to a private answer.",
  "headline": "Your ID. Less revealed.",
  "description": "Turn a Korean mobile ID into a proof of only what a service needs.",
  "image": 6,
  "imageAlt": "",
  "actionTitle": "Prove your region",
  "actionDescription": "Check eligibility for local benefits without sharing your street address.",
  "credential": "Residence in the selected region",
  "hides": "Your street address and identity",
  "outcomeTitle": "Region condition verified.",
  "outcomeDescription": "Your proof matches the selected region. Your full address stays private.",
  "outcomeItems": [
    {
      "title": "Verified condition",
      "description": "Residence in the selected region"
    },
    {
      "title": "Private information",
      "description": "Your street address and identity stay private."
    }
  ],
  "note": "Experimental region predicate on Base Sepolia. The selected region is public. Credential issuer authentication is not circuit-enforced.",
  "experimental": true
}
];

export const REGIONS = [
  { label: 'Seoul', value: '서울특별시' }, { label: 'Gyeonggi', value: '경기도' },
  { label: 'Busan', value: '부산광역시' }, { label: 'Incheon', value: '인천광역시' },
  { label: 'Daegu', value: '대구광역시' }, { label: 'Daejeon', value: '대전광역시' },
  { label: 'Gwangju', value: '광주광역시' }, { label: 'Ulsan', value: '울산광역시' },
  { label: 'Sejong', value: '세종특별자치시' }, { label: 'Gangwon', value: '강원특별자치도' },
  { label: 'North Chungcheong', value: '충청북도' }, { label: 'South Chungcheong', value: '충청남도' },
  { label: 'North Jeolla', value: '전북특별자치도' }, { label: 'South Jeolla', value: '전라남도' },
  { label: 'North Gyeongsang', value: '경상북도' }, { label: 'South Gyeongsang', value: '경상남도' },
  { label: 'Jeju', value: '제주특별자치도' },
] as const;

export const demoById = (id: string) => DEMOS.find(demo => demo.id === id);
