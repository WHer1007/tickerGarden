import { Hono } from 'hono';
import app from '../src/index.ts';

if (!(app instanceof Hono)) throw new Error('pipeline entrypoint must export a Hono application');
export default app;
