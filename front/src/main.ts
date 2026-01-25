import "./style.css";
import Phaser from "phaser";
import nipplejs from "nipplejs";
import type {
  ClientToServer,
  ServerToClient,
  UserState,
} from "shared/src/messages";

type Vec2 = { x: number; y: number };

class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private joystickDir: Vec2 = { x: 0, y: 0 };
  private speed = 220; // px/sec
  private socket?: WebSocket;
  private selfId: string | null = null;
  private peers = new Map<string, Phaser.GameObjects.Rectangle>();
  private lastSentAt = 0;
  private lastSentPos: Vec2 = { x: 0, y: 0 };
  private nickname = `guest-${Math.floor(Math.random() * 10000)}`;
  private avatar = "box";

  create() {
    // 배경
    this.cameras.main.setBackgroundColor("#1b1b1b");

    // 화면 중앙에 플레이어(일단 사각형)
    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;

    this.player = this.add.rectangle(cx, cy, 20, 20, 0xffffff);
    this.player.setOrigin(0.5, 0.5);

    // 안내 텍스트(디버그)
    this.add
      .text(12, 12, "Move: joystick (mobile) / arrow keys (desktop)", {
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setAlpha(0.85);

    this.setupJoystick();
    this.setupResizeHandling();
    this.setupSocket();
  }

  update(_: number, deltaMs: number) {
    const dt = deltaMs / 1000;

    // 데스크탑용: 방향키도 같이 지원
    const cursors = this.input.keyboard?.createCursorKeys();
    let dx = this.joystickDir.x;
    let dy = this.joystickDir.y;

    if (cursors) {
      if (cursors.left?.isDown) dx -= 1;
      if (cursors.right?.isDown) dx += 1;
      if (cursors.up?.isDown) dy -= 1;
      if (cursors.down?.isDown) dy += 1;
    }

    // 정규화 (대각선 속도 과속 방지)
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      dx /= len;
      dy /= len;
    }

    // 이동
    this.player.x += dx * this.speed * dt;
    this.player.y += dy * this.speed * dt;

    // 화면 밖으로 나가지 않게 클램프
    const pad = 10;
    this.player.x = Phaser.Math.Clamp(this.player.x, pad, this.scale.width - pad);
    this.player.y = Phaser.Math.Clamp(this.player.y, pad, this.scale.height - pad);

    this.sendMoveIfNeeded(this.time.now);
  }

  private setupJoystick() {
    // joystick-zone DOM 만들기
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("#app not found");

    const zone = document.createElement("div");
    zone.id = "joystick-zone";
    app.appendChild(zone);

    // nipplejs 매니저 생성
    const manager = nipplejs.create({
      zone,
      mode: "static",
      position: { left: "90px", bottom: "90px" },
      color: "white",
      size: 140,
    });

    manager.on("move", (_evt: any, data: any) => {
      // data.vector: -1..1
      const v = data?.vector;
      if (!v) return;
      this.joystickDir = { x: v.x, y: v.y };
    });

    manager.on("end", () => {
      this.joystickDir = { x: 0, y: 0 };
    });
  }

  private setupSocket() {
    const url =
      (import.meta.env.VITE_WS_URL as string | undefined) ??
      "ws://localhost:8080";
    if (!import.meta.env.VITE_WS_URL) {
      console.warn(`[ws] VITE_WS_URL not set, using ${url}`);
    }

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      console.log("[ws] connected");
      const join: ClientToServer = {
        type: "join",
        room: "lobby",
        nickname: this.nickname,
        avatar: this.avatar,
      };
      socket.send(JSON.stringify(join));
      this.sendMove();
    });

    socket.addEventListener("message", async (event) => {
      const msg = await this.parseServerMessage(event.data);
      if (!msg) {
        console.warn("[ws] invalid message");
        return;
      }

      if (msg.type === "welcome") {
        this.selfId = msg.id;
        msg.users.forEach((user) => {
          if (user.id === this.selfId) {
            this.player.setFillStyle(user.color);
            return;
          }
          this.upsertPeer(user);
        });
        return;
      }

      if (msg.type === "user_joined") {
        if (msg.user.id === this.selfId) return;
        this.upsertPeer(msg.user);
        return;
      }

      if (msg.type === "user_left") {
        this.removePeer(msg.id);
        return;
      }

      if (msg.type === "state") {
        if (msg.id === this.selfId) return;
        this.updatePeerPosition(msg.id, msg.x, msg.y);
      }
    });

    socket.addEventListener("close", () => {
      console.warn("[ws] disconnected");
    });

    socket.addEventListener("error", () => {
      console.warn("[ws] connection error");
    });
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

  private sendMove() {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload: ClientToServer = {
      type: "move",
      x: this.player.x,
      y: this.player.y,
    };
    this.socket.send(JSON.stringify(payload));
    this.lastSentAt = this.time.now;
    this.lastSentPos = { x: this.player.x, y: this.player.y };
  }

  private sendMoveIfNeeded(nowMs: number) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const dx = this.player.x - this.lastSentPos.x;
    const dy = this.player.y - this.lastSentPos.y;
    if (Math.hypot(dx, dy) < 0.5) return;
    if (nowMs - this.lastSentAt < 50) return;
    this.sendMove();
  }

  private upsertPeer(user: UserState) {
    let rect = this.peers.get(user.id);
    if (!rect) {
      rect = this.add.rectangle(user.x, user.y, 20, 20, user.color);
      rect.setOrigin(0.5, 0.5);
      this.peers.set(user.id, rect);
      return;
    }

    rect.setPosition(user.x, user.y);
  }

  private updatePeerPosition(id: string, x: number, y: number) {
    const rect = this.peers.get(id);
    if (!rect) {
      this.upsertPeer({ id, nickname: "", avatar: "", color: 0x66ccff, x, y });
      return;
    }

    rect.setPosition(x, y);
  }

  private removePeer(id: string) {
    const rect = this.peers.get(id);
    if (!rect) return;
    rect.destroy();
    this.peers.delete(id);
  }

  private setupResizeHandling() {
    // Vite + Phaser에서 resize 대응
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const { width, height } = gameSize;
      this.cameras.resize(width, height);

      // 플레이어가 화면 밖에 있으면 안으로
      const pad = 10;
      this.player.x = Phaser.Math.Clamp(this.player.x, pad, width - pad);
      this.player.y = Phaser.Math.Clamp(this.player.y, pad, height - pad);
    });
  }
}

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) throw new Error("#app not found");

// Phaser 게임 시작
new Phaser.Game({
  type: Phaser.AUTO,
  parent: appEl,
  width: "100%",
  height: "100%",
  backgroundColor: "#1b1b1b",
  scene: [MainScene],
  physics: { default: "arcade" },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // 모바일에서 오디오/터치 이슈 줄이기 위한 옵션(지금은 오디오 안 쓰지만)
  input: {
    touch: {
      capture: true,
    },
  },
});
