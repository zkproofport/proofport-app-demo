export function getApiUrl(): string {
  return process.env.API_URL || 'http://localhost:4000';
}

export function getRelayUrl(): string {
  return process.env.RELAY_URL || 'http://localhost:4001';
}

export function getDashboardUrl(): string {
  return process.env.DASHBOARD_URL || 'http://localhost:3000';
}

export function getDemoClientId(): string {
  return process.env.DEMO_CLIENT_ID || '';
}

export function getDemoApiKey(): string {
  return process.env.DEMO_API_KEY || '';
}
