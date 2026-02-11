import { addSSEClient, removeSSEClient } from '@/lib/callback-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      addSSEClient(controller);
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));
    },
    cancel(controller) {
      removeSSEClient(controller);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
