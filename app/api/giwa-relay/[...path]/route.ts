import { NextRequest, NextResponse } from 'next/server';

// The public relay does not allow localhost origins. Keep this same-origin
// adapter restricted to the three HTTP endpoints needed by the Vault demo.
// Never forward browser credentials or a caller-selected upstream URL.
const relayURL = process.env.NEXT_PUBLIC_RELAY_URL || 'https://relay.zkproofport.app';
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

async function relay(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const endpoint = path.join('/');
  const allowed = request.method === 'GET'
    ? endpoint === 'api/v1/challenge' || new RegExp(`^api/v1/proof/${uuid}$`, 'i').test(endpoint)
    : request.method === 'POST' && endpoint === 'api/v1/proof/request';
  if (!allowed) return NextResponse.json({ error: 'Relay endpoint not supported.' }, { status: 404 });
  let body: string | undefined;
  if (request.method === 'POST') {
    body = await request.text();
    if (body.length > 16384) return NextResponse.json({ error: 'Proof request is too large.' }, { status: 413 });
    try {
      const payload = JSON.parse(body);
      if (payload.circuitId !== 'giwa_attestation' || !/^giwa-vault:v1:[a-f0-9]{64}$/.test(payload.inputs?.scope ?? '')) {
        return NextResponse.json({ error: 'A GIWA Vault proof request is required.' }, { status: 400 });
      }
    } catch { return NextResponse.json({ error: 'Invalid proof request.' }, { status: 400 }); }
  }
  try {
    const response = await fetch(`${relayURL.replace(/\/$/, '')}/${endpoint}`, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000),
    });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'The proof relay is unavailable. Please try again shortly.' }, { status: 502 });
  }
}
export const GET = relay;
export const POST = relay;
