import { nanoid } from "nanoid";
import WebSocket, { WebSocketServer } from "ws";
import type { ClientToServer, ServerToClient, UserState } from "shared/src/messages";

const host = process.env.BACK_HOST || "0.0.0.0";
const port = Number(process.env.BACK_PORT) || 8080;
const wss = new WebSocketServer({ host, port });

const usersBySocket = new Map<WebSocket, UserState>();
const socketsById = new Map<string, WebSocket>();
const doorStates = new Map<string, boolean>();

const clientCount = () => wss.clients.size;
const palette = [
  0xffd166, 0x06d6a0, 0x118ab2, 0xef476f, 0x8ecae6, 0xfb8500,
];

const colorFromId = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i)) % palette.length;
  }
  return palette[hash];
};

const parseMessage = (raw: string): ClientToServer | null => {
  try {
    return JSON.parse(raw) as ClientToServer;
  } catch {
    return null;
  }
};

const send = (socket: WebSocket, message: ServerToClient) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
};

const broadcast = (message: ServerToClient, exclude?: WebSocket) => {
  const payload = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (exclude && client === exclude) return;
    client.send(payload);
  });
};

wss.on("listening", () => {
  console.log(`[ws] listening on ws://${host}:${port}`);
});

wss.on("connection", (socket) => {
  console.log(`[ws] client connected (${clientCount()} total)`);

  socket.on("message", (data) => {
    const raw = data.toString();
    const msg = parseMessage(raw);

    if (!msg) {
      console.warn("[ws] invalid JSON message");
      return;
    }

    if (msg.type === "join") {
      if (usersBySocket.has(socket)) return;

      const id = nanoid(8);
      const user: UserState = {
        id,
        nickname: msg.nickname,
        avatar: msg.avatar,
        color: colorFromId(id),
        x: 0,
        y: 0,
      };

      usersBySocket.set(socket, user);
      socketsById.set(user.id, socket);

      send(socket, {
        type: "welcome",
        id: user.id,
        users: Array.from(usersBySocket.values()),
        doors: Array.from(doorStates.entries()).map(([key, isOpen]) => ({
          key,
          isOpen,
        })),
      });

      broadcast({ type: "user_joined", user }, socket);
      return;
    }

    if (msg.type === "move") {
      const user = usersBySocket.get(socket);
      if (!user) return;
      user.x = msg.x;
      user.y = msg.y;
      broadcast({ type: "state", id: user.id, x: user.x, y: user.y }, socket);
      return;
    }

    if (msg.type === "door_toggle") {
      const nextState = !(doorStates.get(msg.key) ?? false);
      doorStates.set(msg.key, nextState);
      const payload: ServerToClient = {
        type: "door_state",
        key: msg.key,
        isOpen: nextState,
      };
      broadcast(payload);
      return;
    }
  });

  socket.on("close", () => {
    const user = usersBySocket.get(socket);
    if (user) {
      usersBySocket.delete(socket);
      socketsById.delete(user.id);
      broadcast({ type: "user_left", id: user.id }, socket);
    }

    console.log(`[ws] client disconnected (${clientCount()} total)`);
  });

  socket.on("error", (err) => {
    console.warn(`[ws] client error: ${String(err)}`);
  });
});
