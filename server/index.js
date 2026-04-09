
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { Server } from 'socket.io';

function createDatabase(dbFilePath) {
  const db = new Database(dbFilePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      payload TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function logEvent(insertLog, event, payload = null) {
  insertLog.run(event, payload ? JSON.stringify(payload) : null);
}

export function startPulseSignalingServer({
  port = 3001,
  host = '127.0.0.1',
  dbFilePath = 'pulsemesh.db',
  corsOrigin = '*',
} = {}) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigin,
    },
  });
  const db = createDatabase(dbFilePath);

  const insertMessage = db.prepare('INSERT INTO messages (room, sender, body) VALUES (?, ?, ?)');
  const insertLog = db.prepare('INSERT INTO logs (event, payload) VALUES (?, ?)');

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/logs', (_req, res) => {
    const rows = db
      .prepare('SELECT id, event, payload, created_at as createdAt FROM logs ORDER BY id DESC LIMIT 300')
      .all();
    res.json(rows);
  });

  app.get('/api/messages/:roomId', (req, res) => {
    const rows = db
      .prepare(
        'SELECT id, room, sender, body, created_at as createdAt FROM messages WHERE room = ? ORDER BY id DESC LIMIT 300',
      )
      .all(req.params.roomId);
    res.json(rows.reverse());
  });

  io.on('connection', (socket) => {
    logEvent(insertLog, 'peer:connected', { socketId: socket.id });

    socket.on('join-room', (roomId) => {
      socket.join(roomId);
      socket.to(roomId).emit('user-connected', socket.id);
      logEvent(insertLog, 'room:join', { roomId, socketId: socket.id });
    });

    socket.on('signal', (payload) => {
      if (!payload?.to || !payload?.signal) return;
      io.to(payload.to).emit('signal', { from: socket.id, signal: payload.signal });
      logEvent(insertLog, 'signal:forward', { from: socket.id, to: payload.to, type: payload.signal?.type ?? 'ice' });
    });

    socket.on('chat-message', (payload) => {
      if (!payload?.room || !payload?.user || !payload?.content) return;
      insertMessage.run(payload.room, payload.user, payload.content);
      io.to(payload.room).emit('chat-message', payload);
      logEvent(insertLog, 'chat:message', { room: payload.room, user: payload.user });
    });

    socket.on('disconnect', (reason) => {
      logEvent(insertLog, 'peer:disconnected', { socketId: socket.id, reason });
    });
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      const endpoint = `http://${host}:${actualPort}`;
      logEvent(insertLog, 'server:started', { endpoint, dbFilePath });
      resolve({
        app,
        io,
        db,
        endpoint,
        port: actualPort,
        stop: () =>
          new Promise((stopResolve) => {
            io.close(() => {
              httpServer.close(() => {
                db.close();
                stopResolve(true);
              });
            });
          }),
      });
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startPulseSignalingServer({ port: Number(process.env.PORT ?? 3001), host: process.env.HOST ?? '0.0.0.0' })
    .then(({ endpoint }) => {
      console.log(`[PulseMesh] signaling server started at ${endpoint}`);
    })
    .catch((error) => {
      console.error('[PulseMesh] failed to start signaling server', error);
      process.exitCode = 1;
    });
}
