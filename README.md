# ZKProofport Demo Site

A Next.js web application that showcases the ZKProofport SDK integration patterns and provides interactive demonstrations of zero-knowledge proof generation and verification workflows.

**Live at:** `http://localhost:3300` (when running with Docker)

## Overview

This demo site illustrates how to integrate the `@zkproofport-app/sdk` into web applications, demonstrating:

- KYC (Know Your Customer) verification using Coinbase attestations
- Country-based proof verification with inclusion/exclusion logic
- On-chain proof verification via ethers v6
- Real-time proof delivery using Socket.IO
- Multi-step workflows from proof request to verification

The demo consists of 4 interactive pages, each showcasing different aspects of the ZKProofport ecosystem.

## Tech Stack

- **Next.js 15** (App Router)
- **React 19**
- **TypeScript 5.7**
- **@zkproofport-app/sdk** ^0.1.2-beta.1
- **ethers v6** (on-chain verification)
- **socket.io-client** ^4.8.0 (real-time proof delivery)
- **Node.js 20** (Docker)

## Features

### Landing Page (`/`)

A visually rich product showcase with live interactive demos:

- Dark theme with glassmorphism effects and gradient mesh backgrounds
- Two functional demo cards:
  - **KYC Verification**: Generate a proof for Coinbase KYC attestation
  - **Country Verification**: Prove country inclusion/exclusion
- QR code generation for mobile scanning
- Proof status polling with real-time updates
- On-chain verification display
- Features overview, code examples, and beta invite modal
- Confetti animation on successful proof completion

### SDK Demo (`/demo`)

Full SDK integration walkthrough with educational UI:

- Light theme, card-based layout
- **Authentication Section**:
  - Client ID and API Key input fields
  - Live auth token display with expiration
- **Circuit Selection**:
  - Toggle between KYC and Country circuits
  - Circuit-specific input forms (country lists, inclusion flags)
  - Form validation and error handling
- **Proof Generation**:
  - QR code display for mobile scanning
  - Real-time proof status via `sdk.waitForProof()`
  - Timeout handling and error recovery
- **Proof Result Display**:
  - Full proof data with formatted JSON
  - Proof verification status
  - Public input analysis

### Relay Demo (`/relay-demo`)

Complete relay workflow demonstration with developer visibility:

- Dark navy theme for contrast
- **Step-by-Step Flow**:
  - Authentication with demo credentials
  - Proof request creation via relay API
  - Result collection and display
  - Nullifier management (Plan 1 and Plan 2)
- **Nullifier Plans**:
  - **Plan 1** (localStorage): Client-side nullifier tracking in browser storage
  - **Plan 2** (on-chain): On-chain registry verification using ethers v6
- **Developer Log Panel** with 3 tabs:
  - **API Logs**: All REST API calls to relay and backend
  - **Events Log**: Real-time Socket.IO events
  - **Nullifier Log**: Nullifier registration and verification attempts
- **BaseScan Integration**: Direct links to verify on-chain transactions

### ZKPSwap (`/zkpswap`)

A DeFi-inspired use case demonstrating conditional proof requirements:

- Simulated wallet connection and token swap interface
- Trade simulation: ETH to USDC conversion
- **Conditional Proof Verification**:
  - Trades under $10,000 USD execute without proof
  - Trades exceeding $10,000 USD require ZKProofport verification
- **Proof Modal**:
  - QR code for mobile scanning
  - Real-time proof status
  - On-chain verification confirmation
- **Success State**:
  - Transaction confirmation with hash
  - Confetti animation on completion
- **Developer Panel** with 4 tabs:
  - API calls
  - WebSocket events
  - Nullifier tracking
  - Step-by-step execution log

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/callback` | POST, GET | Receives proof callbacks from relay server; broadcasts to SSE clients |
| `/api/events` | GET | Server-Sent Events (SSE) endpoint for real-time proof delivery |
| `/api/results/[requestId]` | GET | Retrieves stored proof result by request ID |
| `/api/proxy/[...path]` | All | Proxies requests to backend API (`API_URL` environment variable) |
| `/api/relay/[...path]` | All | Proxies requests to relay server (`RELAY_URL` environment variable) |
| `/api/demo/config` | GET | Returns demo configuration (client ID, API key, dashboard URL) |

## Project Structure

```
proofport-app-demo/
├── app/
│   ├── layout.tsx              # Root layout with dark theme and metadata
│   ├── globals.css             # CSS reset and utility classes
│   ├── page.tsx                # Landing page
│   ├── demo/
│   │   └── page.tsx            # SDK Demo page
│   ├── relay-demo/
│   │   └── page.tsx            # Relay Demo page
│   ├── zkpswap/
│   │   ├── layout.tsx          # ZKPSwap layout
│   │   └── page.tsx            # ZKPSwap page
│   └── api/
│       ├── callback/route.ts   # Proof callback handler + SSE broadcaster
│       ├── events/route.ts     # SSE endpoint for real-time updates
│       ├── results/[requestId]/route.ts   # Result lookup by request ID
│       ├── proxy/[...path]/route.ts       # API proxy middleware
│       ├── relay/[...path]/route.ts       # Relay proxy middleware
│       └── demo/config/route.ts           # Configuration endpoint
├── lib/
│   ├── sdk.ts                  # SDK initialization helper (environment detection)
│   ├── env.ts                  # Server-side environment variable getters
│   └── callback-store.ts       # In-memory result store and SSE management
├── public/
│   ├── favicon.ico
│   ├── favicon.png
│   └── og-image.png
├── Dockerfile                  # Node.js 20 Alpine container
├── next.config.ts              # Environment variable exposure
├── package.json
├── tsconfig.json
└── README.md
```

## Environment Variables

### Server-Side (Backend Only)

These variables are available only in Node.js server code and API routes:

| Variable | Description | Default (Docker) |
|----------|-------------|------------------|
| `API_URL` | Backend API server base URL | `http://api:4000` |
| `RELAY_URL` | Relay server base URL | `http://relay:4001` |

### Client-Side (Browser)

These variables are exposed to the browser via `next.config.ts`:

| Variable | Description | Required | Example |
|----------|-------------|----------|---------|
| `DASHBOARD_URL` | Dashboard application URL | Yes | `http://192.168.x.x:3000` |
| `DEMO_CLIENT_ID` | Demo dApp client ID for SDK auth | Yes | Provided by platform |
| `DEMO_API_KEY` | Demo dApp API key for SDK auth | Yes | Provided by platform |

**Setting Environment Variables:**

For Docker (in root `.env.development`):
```bash
API_URL=http://api:4000
RELAY_URL=http://relay:4001
DASHBOARD_URL=http://192.168.x.x:3000
DEMO_CLIENT_ID=your-client-id
DEMO_API_KEY=your-api-key
```

For local development (create `.env.local` in this directory):
```bash
DASHBOARD_URL=http://localhost:3000
DEMO_CLIENT_ID=your-client-id
DEMO_API_KEY=your-api-key
```

## Quick Start

### Standalone Development

```bash
cd proofport-app-demo
npm install
npm run dev
```

Visit `http://localhost:3300` in your browser.

**Prerequisites:** Node.js 18+ with npm

### With Docker (Full Stack)

From the parent repository root:

```bash
./scripts/dev.sh
```

This starts all services including the demo site on port 3300. The script automatically detects your LAN IP and configures relay callback URLs correctly.

**Services Started:**
- Demo Site: `http://<HOST_IP>:3300`
- API Server: `http://<HOST_IP>:4000`
- Relay Server: `http://<HOST_IP>:4001`
- Dashboard: `http://<HOST_IP>:3000`

### Build and Production

```bash
npm run build
npm start
```

The demo runs on port 3300 in production mode.

## SDK Integration Pattern

This is the standard pattern for integrating ZKProofport SDK into web applications:

```typescript
import { ProofportSDK } from '@zkproofport-app/sdk';

// 1. Create SDK instance (environment auto-detected)
const sdk = ProofportSDK.create('local'); // or 'staging', 'production'

// 2. Authenticate with your dApp credentials
const auth = await sdk.login({
  clientId: 'your-client-id',
  apiKey: 'your-api-key'
});

// 3. Create a relay proof request
const relay = await sdk.createRelayRequest(
  'coinbase_attestation', // circuit ID
  {
    scope: 'myapp.com' // application scope
  },
  {
    callbackUrl: `${window.location.origin}/api/callback`
  }
);

// 4. Generate QR code for mobile scanning
const qrHtml = await sdk.generateQRCode(relay.deepLink);

// 5. Wait for proof (Socket.IO connection with 2-minute timeout)
const result = await sdk.waitForProof(relay.requestId, {
  timeout: 120000
});

// 6. Verify proof on-chain (optional)
if (result.status === 'completed') {
  const verification = await sdk.verifyResponseOnChain(result);
  console.log('On-chain verification:', verification);
}
```

### Supported Circuits

| Circuit ID | Display Name | Purpose |
|-----------|--------------|---------|
| `coinbase_attestation` | Coinbase KYC | User has Coinbase KYC verification |
| `coinbase_country_attestation` | Coinbase Country | User is from allowed countries |

## Key Concepts

### Proof Request Flow

1. **Create Request**: SDK generates proof request with unique `requestId`
2. **Generate QR**: Client generates QR code containing deep link
3. **Mobile Scan**: User scans QR on phone with ZKProofport app installed
4. **Generate Proof**: Phone generates proof locally using Mopro
5. **Submit Proof**: Phone sends proof to relay server
6. **Callback**: Relay notifies browser via `callbackUrl` endpoint
7. **Verify**: Browser optionally verifies proof on-chain via ethers v6

### Real-Time Updates

The demo uses Server-Sent Events (SSE) for real-time proof updates:

- **`/api/callback`** receives POST requests from relay
- **`/api/events`** streams events to connected clients
- **Socket.IO fallback** for browsers that disconnect from SSE

### Nullifier Management

Two-tier nullifier tracking:

- **Plan 1 (localStorage)**: Client-side tracking prevents duplicate proofs in same browser
- **Plan 2 (on-chain)**: Validates nullifier against `ZKProofPortNullifierRegistry` smart contract

## Development Workflows

### Testing KYC Verification

1. Navigate to `/demo` page
2. Enter demo credentials (Client ID + API Key)
3. Keep "KYC" circuit selected
4. Enter a dApp name (e.g., "My App")
5. Click "Generate QR Code"
6. Use ZKProofport app to scan and generate proof
7. View proof result and on-chain verification

### Testing Country Verification

1. Navigate to `/demo` page
2. Authenticate with demo credentials
3. Switch to "Country" circuit
4. Enter comma-separated country codes (e.g., "US,KR,JP")
5. Toggle "Is Included" to test inclusion or exclusion logic
6. Generate QR and complete proof workflow

### Inspecting API Traffic

1. Navigate to `/relay-demo` page
2. Click through the step-by-step workflow
3. View **API Logs** tab to inspect all requests/responses
4. View **Events Log** tab to see Socket.IO events
5. View **Nullifier Log** tab to see nullifier registration

### Mobile Testing

1. Ensure mobile device and demo site are on same network
2. Visit demo site on mobile browser: `http://<HOST_IP>:3300`
3. Click demo card or generate QR code
4. Open ZKProofport mobile app
5. Scan QR code to initiate proof generation
6. Accept proof request and complete generation
7. Proof callback received and verified on demo site

## Docker Deployment

The demo includes a production-ready Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json next.config.ts ./
COPY public ./public
COPY app ./app
COPY lib ./lib
EXPOSE 3300
CMD ["npx", "next", "dev", "-p", "3300", "-H", "0.0.0.0"]
```

**Build and Run:**

```bash
docker build -t zkproofport-demo .
docker run -p 3300:3300 \
  -e API_URL=http://api:4000 \
  -e RELAY_URL=http://relay:4001 \
  -e DASHBOARD_URL=http://localhost:3000 \
  -e DEMO_CLIENT_ID=your-client-id \
  -e DEMO_API_KEY=your-api-key \
  zkproofport-demo
```

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start development server on port 3300 |
| `npm run build` | Build for production |
| `npm start` | Start production server |
| `npm run lint` | Run Next.js linter |

## Troubleshooting

### "Cannot find module '@zkproofport-app/sdk'"

The SDK is a private package. Ensure it's available in npm registry and credentials are configured.

```bash
npm install
```

### QR Code Not Scanning

- Ensure mobile device is on the same network as demo site
- Check that `DASHBOARD_URL` environment variable points to correct relay
- Verify relay server is running and accessible from mobile device

### Proof Callbacks Not Received

- Check `/api/callback` receives POST from relay (check server logs)
- Verify `callbackUrl` is correct and relay can reach it
- Check browser console for SSE connection errors
- Inspect Network tab to verify `/api/events` SSE connection

### On-Chain Verification Failing

- Ensure ethers v6 is properly initialized
- Verify smart contract addresses are correct for the network
- Check contract ABI matches deployed contract
- Inspect browser console for ethers errors

## Support

For issues or questions:

1. Check the individual demo pages (`/demo`, `/relay-demo`, `/zkpswap`)
2. Review API logs in the Developer Log panels
3. Inspect browser console for client-side errors
4. Check server logs for API and relay errors

## License

This is part of the ZKProofport project. See parent repository for license terms.
