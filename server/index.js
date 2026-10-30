import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 4000);
const seaRouterUrl = (process.env.SEA_ROUTER_URL || '').replace(/\/$/, '');
const seaRouterKey = process.env.SEA_ROUTER_KEY || '';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://tiles.openfreemap.org', 'https://*.openfreemap.org', 'https://raw.githubusercontent.com', 'https://nominatim.openstreetmap.org'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      ...(process.env.NODE_ENV === 'production' ? { upgradeInsecureRequests: [] } : {}),
    },
  },
}));

const seaLimiter = rateLimit({
  windowMs: 60_000,
  limit: Number(process.env.SEA_RATE_LIMIT_PER_MINUTE || 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many route requests. Please wait a minute and try again.' },
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', seaRouterConfigured: Boolean(seaRouterUrl && seaRouterKey) });
});

app.get('/api/sea/route', seaLimiter, async (req, res) => {
  if (!seaRouterUrl || !seaRouterKey) {
    return res.status(503).json({ error: 'Sea routing is not configured on the server. Please contact the site administrator.' });
  }

  const { from, to } = req.query;
  const coordinatePattern = /^-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/;
  if (typeof from !== 'string' || typeof to !== 'string' || !coordinatePattern.test(from) || !coordinatePattern.test(to)) {
    return res.status(400).json({ error: 'Invalid coordinates. Expected from and to as latitude,longitude.' });
  }
  const validPair = (value) => {
    const [lat, lon] = value.split(',').map(Number);
    return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  };
  if (!validPair(from) || !validPair(to)) {
    return res.status(400).json({ error: 'Coordinates are outside valid latitude/longitude ranges.' });
  }

  const upstream = new URL('/route', seaRouterUrl);
  upstream.searchParams.set('from', from);
  upstream.searchParams.set('to', to);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.SEA_ROUTER_TIMEOUT_MS || 90_000));
  try {
    const upstreamResponse = await fetch(upstream, {
      headers: { 'X-Api-Key': seaRouterKey, Accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await upstreamResponse.text();
    res.status(upstreamResponse.status);
    res.type(upstreamResponse.headers.get('content-type') || 'application/json');
    return res.send(body);
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    return res.status(timedOut ? 504 : 502).json({
      error: timedOut ? 'The sea-routing service took too long to respond. Try again.' : 'The sea-routing service is temporarily unavailable.',
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use(express.static(distDir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true }));
app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));

app.listen(port, '0.0.0.0', () => {
  console.log(`Global Route Atlas server listening on ${port}`);
});
