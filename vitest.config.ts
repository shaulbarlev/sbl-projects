import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: 'test-password',
          SESSION_SECRET: 'test-session-secret',
          FALLBACK_URL: 'https://fallback.example.com/',
          GIPHY_API_KEY: 'test-giphy-key',
          API_TOKEN: 'test-token',
          AGENT_TOKEN: 'test-agent-token',
        },
      },
    }),
  ],
});
