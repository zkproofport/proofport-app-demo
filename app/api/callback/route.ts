import { NextRequest, NextResponse } from 'next/server';
import { storeResult, broadcastSSE } from '@/lib/callback-store';

export async function POST(request: NextRequest) {
  const body = await request.text();

  console.log('\n=== Proof Response Received ===');
  console.log('Timestamp:', new Date().toISOString());

  let parsedBody: Record<string, unknown> | null = null;
  try {
    parsedBody = JSON.parse(body);
    console.log('Body:', JSON.stringify(parsedBody, null, 2));
  } catch {
    console.log('Body:', body);
  }
  console.log('==============================\n');

  // Store result for mobile page reload recovery
  if (parsedBody && typeof parsedBody.requestId === 'string') {
    storeResult(parsedBody.requestId, parsedBody);
  }

  // Push to all SSE clients
  broadcastSSE({
    type: 'proof-callback',
    timestamp: new Date().toISOString(),
    data: parsedBody || body,
  });

  return NextResponse.json({ success: true });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = Object.fromEntries(searchParams.entries());

  console.log('\n=== Proof Response Received (GET) ===');
  console.log('Timestamp:', new Date().toISOString());
  console.log('Query:', query);
  console.log('======================================\n');

  broadcastSSE({
    type: 'proof-callback',
    timestamp: new Date().toISOString(),
    data: query,
  });

  return NextResponse.json({ success: true, received: query });
}
