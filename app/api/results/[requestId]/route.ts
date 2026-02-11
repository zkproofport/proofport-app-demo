import { NextRequest, NextResponse } from 'next/server';
import { getResult } from '@/lib/callback-store';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  const result = getResult(requestId);
  return NextResponse.json({ found: !!result, data: result || null });
}
