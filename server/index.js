/**
 * Authoritative game server for AZ Tank online multiplayer.
 *
 * Serves the built client (production) and hosts the WebSocket game protocol on
 * the same HTTP server, so a single Render web service covers both. In dev the
 * client is served by Vite; this process only needs to provide the WS endpoint.
 *
 * Run: `node server/index.js`  (PORT env overrides the default 8080)
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { MSG, PROTOCOL_VERSION } from '../src/net/protocol.js';
import { RoomManager } from './RoomManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const app = express();
const DIST = path.join(__dirname, '..', 'dist');
app.use(express.static(DIST));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.count, v: PROTOCOL_VERSION }));
// SPA fallback so a deep link / refresh still serves the client. (Express 5 no
// longer accepts a bare '*' route, so this is a terminal middleware instead.)
app.use((req, res) => {
  if (req.method !== 'GET') return res.status(404).end();
  res.sendFile(path.join(DIST, 'index.html'), (err) => err && res.status(404).end());
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new RoomManager();

let nextId = 1;

wss.on('connection', (ws) => {
  const conn = { id: `c${nextId++}`, room: null };

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, conn, msg);
  });

  ws.on('close', () => {
    if (conn.room) conn.room.removeMember(conn.id);
    conn.room = null;
  });

  ws.on('error', () => {
    /* close handler does the cleanup */
  });
});

function handle(ws, conn, msg) {
  switch (msg.t) {
    case MSG.CREATE_ROOM: {
      const room = rooms.createRoom();
      joinRoom(ws, conn, room, msg.name);
      break;
    }
    case MSG.JOIN_ROOM: {
      const room = rooms.getRoom(msg.code);
      if (!room) return send(ws, { t: MSG.JOIN_RESULT, ok: false, reason: 'Room not found' });
      if (room.started) return send(ws, { t: MSG.JOIN_RESULT, ok: false, reason: 'Match already started' });
      if (room.isFull) return send(ws, { t: MSG.JOIN_RESULT, ok: false, reason: 'Room is full' });
      joinRoom(ws, conn, room, msg.name);
      break;
    }
    case MSG.START_MATCH: {
      conn.room?.start(conn.id);
      break;
    }
    case MSG.INPUT: {
      conn.room?.setInput(conn.id, msg);
      break;
    }
    case MSG.LEAVE_ROOM: {
      if (conn.room) conn.room.removeMember(conn.id);
      conn.room = null;
      break;
    }
    case MSG.PING: {
      send(ws, { t: MSG.PONG, time: msg.time });
      break;
    }
    default:
      break;
  }
}

function joinRoom(ws, conn, room, name) {
  const slot = room.addMember(conn.id, ws, name);
  if (slot < 0) return send(ws, { t: MSG.JOIN_RESULT, ok: false, reason: 'Could not join' });
  conn.room = room;
  send(ws, { t: MSG.JOIN_RESULT, ok: true, code: room.code, slot, isHost: room.hostId === conn.id });
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

server.listen(PORT, () => {
  console.log(`AZ Tank server listening on :${PORT}  (ws path /ws, protocol v${PROTOCOL_VERSION})`);
});
