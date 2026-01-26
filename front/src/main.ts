import "./style.css";
import Phaser from "phaser";
import nipplejs from "nipplejs";
import type {
  ClientToServer,
  ServerToClient,
  UserState,
} from "shared/src/messages";

type Vec2 = { x: number; y: number };

let updateBootStatus = (_text: string) => {};
let updateNetStatus = (_text: string) => {};

class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private joystickDir: Vec2 = { x: 0, y: 0 };
  private speed = 220; // px/sec
  private socket?: WebSocket;
  private selfId: string | null = null;
  private peers = new Map<string, Phaser.GameObjects.Rectangle>();
  private lastSentAt = 0;
  private lastSentPos: Vec2 = { x: 0, y: 0 };
  private nickname = `guest-${Math.floor(Math.random() * 10000)}`;
  private avatar = "box";
  private mapWidth = 0;
  private mapHeight = 0;
  private readonly mapKey = "library-map";
  private readonly fallbackSize = { width: 2000, height: 1200 };
  private readonly maxTileCount = 250_000;
  private mapUrl = "";

  preload() {
    updateBootStatus("preload: starting");
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: any) => {
      const key = file?.key ?? "unknown";
      const url = file?.url ?? "unknown";
      updateBootStatus(`load error: ${key} (${url})`);
    });
    this.load.on(Phaser.Loader.Events.COMPLETE, () => {
      updateBootStatus("preload: complete");
    });

    this.mapUrl = new URL(
      "../assets/map/library-main.resolved.json",
      import.meta.url,
    ).toString();
    this.load.tilemapTiledJSON(this.mapKey, this.mapUrl);
    this.load.image(
      "tiles-door-and-room",
      new URL(
        "../assets/map/tilesets/fancy_mansion_room_door_tiles.png",
        import.meta.url,
      ).toString(),
    );
    this.load.image(
      "tiles-fancy-furniture",
      new URL(
        "../assets/map/tilesets/fancy_mansion_furnitureset.png",
        import.meta.url,
      ).toString(),
    );
  }

  create() {
    // 배경
    this.cameras.main.setBackgroundColor("#1b1b1b");
    updateBootStatus("create: starting");

    let usedFallback = false;

    if (!this.cache.tilemap.exists(this.mapKey)) {
      this.createFallbackWorld(`Map JSON not loaded (${this.mapUrl})`);
      usedFallback = true;
    } else {
      try {
        const map = this.make.tilemap({ key: this.mapKey });
        if (map.width * map.height > this.maxTileCount) {
          this.createFallbackWorld(
            `Map too large (${map.width}x${map.height} tiles)`,
          );
          usedFallback = true;
        } else {
          const tilesetDoor = map.addTilesetImage(
            "door-and-room",
            "tiles-door-and-room",
          );
          if (!tilesetDoor) {
            this.createFallbackWorld("Tileset image missing: door-and-room");
            usedFallback = true;
          } else {
            const tilesets = [tilesetDoor];
            const backgroundLayer = map.createLayer(
              "background",
              tilesets,
              0,
              0,
            );
            backgroundLayer?.setDepth(-10);

            // 월드 바운더리 설정 (고정된 맵 크기)
            this.mapWidth = map.widthInPixels;
            this.mapHeight = map.heightInPixels;
            this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
            this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);
          }
        }
      } catch (error) {
        console.error("[map] create failed", error);
        this.createFallbackWorld("Map parse/create failed");
        usedFallback = true;
      }
    }

    if (usedFallback) {
      this.mapWidth = this.physics.world.bounds.width;
      this.mapHeight = this.physics.world.bounds.height;
    }

    // 화면 중앙에 플레이어(일단 사각형)
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;

    this.player = this.add.rectangle(cx, cy, 20, 20, 0xffffff);
    this.player.setOrigin(0.5, 0.5);
    this.physics.add.existing(this.player);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true);
    this.playerBody.setAllowGravity(false);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);

    // 안내 텍스트(디버그)
    this.add
      .text(12, 12, "Move: joystick (mobile) / arrow keys (desktop)", {
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setAlpha(0.85)
      .setScrollFactor(0);

    this.setupJoystick();
    this.setupResizeHandling();
    this.setupSocket();

    updateBootStatus(usedFallback ? "create: fallback world" : "create: map ok");
  }

  update() {
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
    this.playerBody.setVelocity(dx * this.speed, dy * this.speed);

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
      this.joystickDir = { x: v.x, y: -v.y };
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

    updateNetStatus(`ws: connecting (${url})`);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      console.log("[ws] connected");
      updateNetStatus("ws: connected");
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
      updateNetStatus("ws: disconnected");
    });

    socket.addEventListener("error", () => {
      console.warn("[ws] connection error");
      updateNetStatus("ws: error");
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
    });
  }

  private createFallbackWorld(reason: string) {
    const { width, height } = this.fallbackSize;
    this.mapWidth = width;
    this.mapHeight = height;
    this.physics.world.setBounds(0, 0, width, height);
    this.cameras.main.setBounds(0, 0, width, height);

    const tileKey = "fallback-tile";
    if (!this.textures.exists(tileKey)) {
      const tile = 32;
      const gfx = this.add.graphics();
      gfx.fillStyle(0x2a2a2a, 1);
      gfx.fillRect(0, 0, tile, tile);
      gfx.lineStyle(1, 0x333333, 1);
      gfx.strokeRect(0, 0, tile, tile);
      gfx.generateTexture(tileKey, tile, tile);
      gfx.destroy();
    }

    this.add
      .tileSprite(0, 0, width, height, tileKey)
      .setOrigin(0, 0)
      .setDepth(-10);

    this.add
      .text(12, 36, `Map fallback: ${reason}`, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffb86b",
      })
      .setAlpha(0.9)
      .setScrollFactor(0);
  }
}

const appEl = document.querySelector<HTMLDivElement>("#app");
if (!appEl) throw new Error("#app not found");

const bootStatus = document.createElement("div");
bootStatus.id = "boot-status";
bootStatus.style.position = "fixed";
bootStatus.style.left = "8px";
bootStatus.style.top = "8px";
bootStatus.style.zIndex = "20";
bootStatus.style.padding = "6px 8px";
bootStatus.style.background = "rgba(0, 0, 0, 0.6)";
bootStatus.style.color = "#ffffff";
bootStatus.style.fontFamily = "monospace";
bootStatus.style.fontSize = "12px";
bootStatus.textContent = "boot: init";
appEl.appendChild(bootStatus);
updateBootStatus = (text: string) => {
  bootStatus.textContent = text;
};

const netStatus = document.createElement("div");
netStatus.id = "net-status";
netStatus.style.position = "fixed";
netStatus.style.left = "8px";
netStatus.style.top = "32px";
netStatus.style.zIndex = "20";
netStatus.style.padding = "6px 8px";
netStatus.style.background = "rgba(0, 0, 0, 0.6)";
netStatus.style.color = "#9be7ff";
netStatus.style.fontFamily = "monospace";
netStatus.style.fontSize = "12px";
netStatus.textContent = "ws: idle";
appEl.appendChild(netStatus);
updateNetStatus = (text: string) => {
  netStatus.textContent = text;
};

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
