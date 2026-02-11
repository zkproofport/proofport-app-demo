// In-memory store for callback results with TTL
// Uses globalThis for persistence across Next.js hot reloads

const RESULT_TTL = 5 * 60 * 1000; // 5 minutes

interface StoredResult {
  data: unknown;
  expiresAt: number;
}

function getStore(): Map<string, StoredResult> {
  const g = globalThis as unknown as { __callbackStore?: Map<string, StoredResult> };
  if (!g.__callbackStore) {
    g.__callbackStore = new Map();
  }
  return g.__callbackStore;
}

function getSSEClients(): Set<ReadableStreamDefaultController> {
  const g = globalThis as unknown as { __sseClients?: Set<ReadableStreamDefaultController> };
  if (!g.__sseClients) {
    g.__sseClients = new Set();
  }
  return g.__sseClients;
}

export function storeResult(requestId: string, data: unknown): void {
  const store = getStore();
  store.set(requestId, { data, expiresAt: Date.now() + RESULT_TTL });
  // Cleanup expired
  for (const [key, val] of store) {
    if (val.expiresAt < Date.now()) store.delete(key);
  }
}

export function getResult(requestId: string): unknown | null {
  const store = getStore();
  const entry = store.get(requestId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    store.delete(requestId);
    return null;
  }
  return entry.data;
}

export function addSSEClient(controller: ReadableStreamDefaultController): void {
  getSSEClients().add(controller);
}

export function removeSSEClient(controller: ReadableStreamDefaultController): void {
  getSSEClients().delete(controller);
}

export function broadcastSSE(data: unknown): void {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  const encoder = new TextEncoder();
  for (const client of getSSEClients()) {
    try {
      client.enqueue(encoder.encode(message));
    } catch {
      getSSEClients().delete(client);
    }
  }
}
