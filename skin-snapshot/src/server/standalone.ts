// Run the API on any Node host, without Next.js or Vercel:  npm run serve:node
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { getDeps } from './deps';

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: createApp(getDeps).fetch, port }, (i) => console.log(`skin-snapshot API listening on :${i.port}`));
