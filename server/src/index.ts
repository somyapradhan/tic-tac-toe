import http from 'http';
import express from 'express';
import cors from 'cors';
import { env } from './config/env';
import healthRouter from './routes/health';
import leaderboardRouter from './routes/leaderboard';
import authRouter from './routes/auth';
import profileRouter from './routes/profile';
import { createSocketServer } from './socket/index';
import { ensureSchema } from './lib/schema';

const app = express();

app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());
app.use(express.static('public'));

app.use('/', healthRouter);
app.use('/', leaderboardRouter);
app.use('/', authRouter);
app.use('/', profileRouter);

const server = http.createServer(app);
const io = createSocketServer(server);

async function start() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error('[schema] failed to ensure schema', err);
  }

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

start();

export { app, server, io };
