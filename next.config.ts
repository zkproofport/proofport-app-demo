import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  env: {
    DASHBOARD_URL: process.env.DASHBOARD_URL,
    DEMO_CLIENT_ID: process.env.DEMO_CLIENT_ID,
    DEMO_API_KEY: process.env.DEMO_API_KEY,
  },
};

export default nextConfig;
