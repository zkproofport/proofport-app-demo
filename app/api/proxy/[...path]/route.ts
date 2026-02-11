import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.API_URL || 'http://localhost:4000';

async function proxyToApi(request: NextRequest, params: Promise<{ path: string[] }>) {
  const { path } = await params;
  const subPath = path.join('/');

  // Map proxy paths to API paths
  // /api/proxy/auth/... -> API_URL/api/auth/...
  // /api/proxy/dapps/... -> API_URL/api/dapps/...
  // /api/proxy/inquiries/... -> API_URL/api/inquiries/...
  const targetUrl = new URL(`/api/${subPath}`, API_URL);

  // Copy search params
  const { searchParams } = new URL(request.url);
  searchParams.forEach((value, key) => targetUrl.searchParams.set(key, value));

  const headers = new Headers(request.headers);
  headers.set('host', new URL(API_URL).host);
  headers.delete('connection');

  try {
    const body = request.method !== 'GET' && request.method !== 'HEAD'
      ? await request.text()
      : undefined;

    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body,
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('[Proxy Error]', err);
    return NextResponse.json(
      { error: 'Proxy error', details: String(err) },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, ctx.params);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, ctx.params);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, ctx.params);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyToApi(req, ctx.params);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key, Authorization',
    },
  });
}
