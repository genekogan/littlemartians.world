// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://www.littlemartians.world',
  output: 'static',
  trailingSlash: 'always',
  // robots.txt points at a sitemap, so one has to exist
  integrations: [sitemap()],
  build: { format: 'directory' },
});
