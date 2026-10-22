import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// PUBLIC_SITE_URL — из env (домен пока не зарегистрирован; для тестов http://localhost:4321).
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  site: process.env.PUBLIC_SITE_URL || 'http://localhost:4321',
  trailingSlash: 'never',
  // Встроенная проверка Origin отключена: у нас собственная CSRF-защита (double-submit cookie
  // + сверка Origin с хостом запроса и PUBLIC_SITE_URL) в src/server/admin-auth.ts — см. задание §9.
  security: { checkOrigin: false },
  server: {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || 4321),
  },
  vite: {
    build: {
      // SVG-заглушки не инлайним: они и так локальные, а HTML главной держим ≤120 КБ gzip
      assetsInlineLimit: 1024,
    },
  },
});
