// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [svelte()],
  server: { host: true, port: 4321 },
  security: {
    // Requests come through oauth2-proxy with Host = the public hostname, so the default
    // origin check would reject POSTs; the app is only reachable on the internal Docker network.
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
    ssr: { external: ['better-sqlite3'] },
  },
});
