# Tic-Tac-Toe Server

Node.js + TypeScript + Express + Socket.IO server.

## Scripts

- npm run dev — start in watch mode (ts-node-dev)
- npm run build — compile to dist/
- npm run start — run compiled output

## Env

Copy `.env.example` to `.env` and adjust as needed.

## Health

GET `/health` → `{ status: 'ok', service: 'tic-tac-toe', version: '0.1.0' }`
