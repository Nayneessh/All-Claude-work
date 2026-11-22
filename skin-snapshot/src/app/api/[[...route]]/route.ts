import { handle } from 'hono/vercel';
import { createApp } from '@/server/app';
import { getDeps } from '@/server/deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const app = createApp(getDeps);
export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
