import type { ClientToServer, ServerToClient, UserState } from "shared/src/messages";

type MessageListener = (msg: ServerToClient) => void;
type OpenListener = () => void;

export class NetworkClient {
  private socket?: WebSocket;
  private messageListeners = new Set<MessageListener>();
  private openListeners = new Set<OpenListener>();
  private bufferedMessages: ServerToClient[] = [];
  private isOpen = false;

  connect(url: string) {
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.isOpen = true;
      this.openListeners.forEach((listener) => listener());
    });

    socket.addEventListener("message", async (event) => {
      const msg = await this.parseServerMessage(event.data);
      if (!msg) {
        console.warn("[ws] invalid message");
        return;
      }
      if (this.messageListeners.size === 0) {
        this.bufferedMessages.push(msg);
        return;
      }
      this.messageListeners.forEach((listener) => listener(msg));
    });
  }

  onOpen(listener: OpenListener) {
    this.openListeners.add(listener);
    if (this.isOpen) {
      listener();
    }
  }

  onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    this.flushBufferedMessages();
  }

  send(payload: ClientToServer): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify(payload));
    return true;
  }

  private flushBufferedMessages() {
    if (this.messageListeners.size === 0) return;
    while (this.bufferedMessages.length > 0) {
      const msg = this.bufferedMessages.shift();
      if (!msg) continue;
      this.messageListeners.forEach((listener) => listener(msg));
    }
  }

  private async parseServerMessage(
    data: unknown,
  ): Promise<ServerToClient | null> {
    const text = await this.readMessageText(data);
    if (text === null) return null;
    try {
      return JSON.parse(text) as ServerToClient;
    } catch {
      return null;
    }
  }

  private async readMessageText(data: unknown): Promise<string | null> {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return await data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    return null;
  }
}

type WorldStateHandlers = {
  onWelcome: (payload: Extract<ServerToClient, { type: "welcome" }>) => void;
  onUserJoined: (user: UserState) => void;
  onUserLeft: (id: string) => void;
  onState: (payload: Extract<ServerToClient, { type: "state" }>) => void;
  onDoorState: (payload: Extract<ServerToClient, { type: "door_state" }>) => void;
};

export class WorldStateApplier {
  constructor(private handlers: WorldStateHandlers) {}

  apply(msg: ServerToClient) {
    if (msg.type === "welcome") {
      this.handlers.onWelcome(msg);
      return;
    }
    if (msg.type === "user_joined") {
      this.handlers.onUserJoined(msg.user);
      return;
    }
    if (msg.type === "user_left") {
      this.handlers.onUserLeft(msg.id);
      return;
    }
    if (msg.type === "state") {
      this.handlers.onState(msg);
      return;
    }
    if (msg.type === "door_state") {
      this.handlers.onDoorState(msg);
    }
  }
}
