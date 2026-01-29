import "./style.css";
import Phaser from "phaser";
import nipplejs from "nipplejs";
import type {
  ClientToServer,
  ServerToClient,
  UserState,
} from "shared/src/messages";

type Vec2 = { x: number; y: number };

type DoorTile = {
  collisionKey: string;
  tileX: number;
  tileY: number;
  closedTileId: number;
  openTileId: number;
  isOpen: boolean;
  collider?: Phaser.Physics.Arcade.Image;
};

class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private joystickDir: Vec2 = { x: 0, y: 0 };
  private speed = 220; // px/sec
  private socket?: WebSocket;
  private selfId: string | null = null;
  private peers = new Map<string, Phaser.GameObjects.Sprite>();
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
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  private map?: Phaser.Tilemaps.Tilemap;
  private doorLayer?: Phaser.Tilemaps.TilemapLayer;
  private doorTiles: DoorTile[] = [];
  private doorGroups = new Map<string, DoorTile[]>();
  private interactKey?: Phaser.Input.Keyboard.Key;
  private doorColliderGroup?: Phaser.Physics.Arcade.StaticGroup;
  private doorTileSize = { width: 32, height: 32 };
  private pointerListenerAttached = false;
  private lastDoorToggleAt = 0;

  preload() {
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
    this.load.image(
      "tiles-furniture",
      new URL(
        "../assets/map/tilesets/InteriorTilesLITE.png",
        import.meta.url,
      ).toString(),
    );
    this.load.image(
      "tiles-collisions",
      new URL("../assets/map/tilesets/Bricks.png", import.meta.url).toString(),
    );
  }

  create() {
    // 배경
    this.cameras.main.setBackgroundColor("#1b1b1b");

    let usedFallback = false;

    if (!this.cache.tilemap.exists(this.mapKey)) {
      this.createFallbackWorld();
      usedFallback = true;
    } else {
      try {
        const map = this.make.tilemap({ key: this.mapKey });
        this.map = map;
        if (map.width * map.height > this.maxTileCount) {
            this.createFallbackWorld();
          usedFallback = true;
        } else {
          const tilesetDoor = map.addTilesetImage(
            "door-and-room",
            "tiles-door-and-room",
          );
          const tilesetFurniture = map.addTilesetImage(
            "furniture",
            "tiles-furniture",
          );
          const tilesetCollisions = map.addTilesetImage(
            "collisions",
            "tiles-collisions",
          );
          const tilesets = [
            tilesetDoor,
            tilesetFurniture,
            tilesetCollisions,
          ].filter(Boolean) as Phaser.Tilemaps.Tileset[];
          if (!tilesetDoor || tilesets.length === 0) {
            this.createFallbackWorld();
            usedFallback = true;
          } else {
            const backgroundLayer = map.createLayer(
              "background",
              tilesets,
              0,
              0,
            );
            backgroundLayer?.setDepth(-10);

            const wallSideLayer = map.createLayer(
              "wall-side",
              tilesets,
              0,
              0,
            );
            wallSideLayer?.setDepth(1);

            const wallTopLayer = map.createLayer(
              "wall-top",
              tilesets,
              0,
              0,
            );
            wallTopLayer?.setDepth(2);

            this.collisionLayer =
              map.createLayer(
              "collision",
              tilesets,
              0,
              0,
              ) ?? undefined;
            if (this.collisionLayer) {
              this.collisionLayer.setCollisionByExclusion([-1]);
              this.collisionLayer.setVisible(false);
            }
            this.setupDoors(map, tilesets);

            // 월드 바운더리 설정 (고정된 맵 크기)
            this.mapWidth = map.widthInPixels;
            this.mapHeight = map.heightInPixels;
            this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
            this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

          }
        }
      } catch (error) {
        console.error("[map] create failed", error);
        this.createFallbackWorld();
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

    this.ensurePlayerTexture();
    this.player = this.physics.add.sprite(cx, cy, "player-box");
    this.player.setOrigin(0.5, 0.5);
    this.player.setTint(0xffffff);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true);
    this.playerBody.setAllowGravity(false);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    if (this.collisionLayer) {
      this.physics.add.collider(this.player, this.collisionLayer);
    }
    if (this.doorColliderGroup) {
      this.physics.add.collider(this.player, this.doorColliderGroup);
    }
    this.interactKey = this.input.keyboard?.addKey(
      Phaser.Input.Keyboard.KeyCodes.E,
    );

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
    this.setupPointerInteraction();
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

    if (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      const doorKey = this.findNearbyDoorKey();
      if (doorKey) {
        this.tryDoorToggle(doorKey);
      }
    }
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
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
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
            this.player.setTint(user.color);
            return;
          }
          this.upsertPeer(user);
        });
        msg.doors.forEach((door) => {
          this.applyDoorState(door.key, door.isOpen);
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

      if (msg.type === "door_state") {
        this.applyDoorState(msg.key, msg.isOpen);
      }
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
    let sprite = this.peers.get(user.id);
    if (!sprite) {
      this.ensurePlayerTexture();
      sprite = this.add.sprite(user.x, user.y, "player-box");
      sprite.setOrigin(0.5, 0.5);
      sprite.setTint(user.color);
      this.peers.set(user.id, sprite);
      return;
    }

    sprite.setPosition(user.x, user.y);
  }

  private updatePeerPosition(id: string, x: number, y: number) {
    const sprite = this.peers.get(id);
    if (!sprite) {
      this.upsertPeer({ id, nickname: "", avatar: "", color: 0x66ccff, x, y });
      return;
    }

    sprite.setPosition(x, y);
  }

  private removePeer(id: string) {
    const sprite = this.peers.get(id);
    if (!sprite) return;
    sprite.destroy();
    this.peers.delete(id);
  }

  private ensurePlayerTexture() {
    const key = "player-box";
    if (this.textures.exists(key)) return;
    const size = 20;
    const gfx = this.add.graphics();
    gfx.fillStyle(0xffffff, 1);
    gfx.fillRect(0, 0, size, size);
    gfx.generateTexture(key, size, size);
    gfx.destroy();
  }

  private setupDoors(
    map: Phaser.Tilemaps.Tilemap,
    tilesets: Phaser.Tilemaps.Tileset[],
  ) {
    const doorsLayer = map.getObjectLayer("doors");
    if (!doorsLayer) return;

    const doorTileset =
      tilesets.find((tileset) => tileset.name === "door-and-room") ?? null;
    const doorFirstGid = doorTileset?.firstgid ?? 1;

    this.doorTileSize = { width: map.tileWidth, height: map.tileHeight };
    this.doorColliderGroup = this.physics.add.staticGroup();

    this.doorLayer =
      map.createBlankLayer("doors-runtime", tilesets, 0, 0) ?? undefined;
    if (this.doorLayer) {
      this.doorLayer.setDepth(3);
    }

    const tileWidth = map.tileWidth;
    const tileHeight = map.tileHeight;

    doorsLayer.objects.forEach((obj) => {
      if (!obj.gid) return;
      const properties = this.getObjectProperties(obj);
      const collisionKey = properties.collisionKey;
      const closedTileId = this.parseTileId(properties.closedTileId);
      const openTileId = this.parseTileId(properties.openTileId);
      const status = properties.status ?? "closed";

      if (!collisionKey || closedTileId === null || openTileId === null) return;

      const objX = obj.x ?? 0;
      const objY = obj.y ?? 0;
      const tileX = Math.floor(objX / tileWidth);
      const tileY = Math.floor((objY - tileHeight) / tileHeight + 0.01);
      const isOpen = status === "open";

      const doorTile: DoorTile = {
        collisionKey,
        tileX,
        tileY,
        closedTileId: doorFirstGid + closedTileId,
        openTileId: doorFirstGid + openTileId,
        isOpen,
      };

      this.doorTiles.push(doorTile);
      const group = this.doorGroups.get(collisionKey) ?? [];
      group.push(doorTile);
      this.doorGroups.set(collisionKey, group);

      if (this.collisionLayer) {
        const tile = this.collisionLayer.getTileAt(doorTile.tileX, doorTile.tileY);
        if (tile) {
          this.collisionLayer.removeTileAt(doorTile.tileX, doorTile.tileY);
        }
      }

      this.renderDoorTile(doorTile);
    });
  }

  private renderDoorTile(doorTile: DoorTile) {
    const tileId = doorTile.isOpen ? doorTile.openTileId : doorTile.closedTileId;
    if (this.doorLayer) {
      this.doorLayer.putTileAt(tileId, doorTile.tileX, doorTile.tileY);
    }
    if (doorTile.isOpen) {
      if (doorTile.collider) {
        doorTile.collider.destroy();
        doorTile.collider = undefined;
      }
      return;
    }

    if (!this.doorColliderGroup) return;

    if (!doorTile.collider) {
      this.ensureDoorColliderTexture();
      const centerX =
        doorTile.tileX * this.doorTileSize.width +
        this.doorTileSize.width / 2;
      const centerY =
        doorTile.tileY * this.doorTileSize.height +
        this.doorTileSize.height / 2;
      doorTile.collider = this.doorColliderGroup.create(
        centerX,
        centerY,
        "door-collider",
      ) as Phaser.Physics.Arcade.Image;
      doorTile.collider.setDisplaySize(
        this.doorTileSize.width,
        this.doorTileSize.height,
      );
      doorTile.collider.setVisible(false);
      doorTile.collider.refreshBody();
    }
  }

  private applyDoorState(collisionKey: string, isOpen: boolean) {
    const group = this.doorGroups.get(collisionKey);
    if (!group) return;
    group.forEach((doorTile) => {
      doorTile.isOpen = isOpen;
      this.renderDoorTile(doorTile);
    });
  }

  private requestDoorToggle(collisionKey: string) {
    const group = this.doorGroups.get(collisionKey);
    if (!group || group.length === 0) return;
    const nextState = !group[0].isOpen;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload: ClientToServer = { type: "door_toggle", key: collisionKey };
      this.socket.send(JSON.stringify(payload));
      return;
    }
    this.applyDoorState(collisionKey, nextState);
  }

  private tryDoorToggle(collisionKey: string) {
    const now = this.time?.now ?? performance.now();
    if (now - this.lastDoorToggleAt < 250) return;
    this.lastDoorToggleAt = now;
    this.requestDoorToggle(collisionKey);
  }

  private findNearbyDoorKey(): string | null {
    if (!this.map || this.doorTiles.length === 0) return null;
    const playerTileX = this.map.worldToTileX(this.player.x);
    const playerTileY = this.map.worldToTileY(this.player.y);
    if (playerTileX === null || playerTileY === null) return null;
    for (const doorTile of this.doorTiles) {
      const dx = Math.abs(doorTile.tileX - playerTileX);
      const dy = Math.abs(doorTile.tileY - playerTileY);
      if (dx <= 1 && dy <= 1) return doorTile.collisionKey;
    }
    return null;
  }

  private findDoorKeyAtWorld(x: number, y: number): string | null {
    if (!this.map || this.doorTiles.length === 0) return null;
    const tileX = this.map.worldToTileX(x);
    const tileY = this.map.worldToTileY(y);
    if (tileX === null || tileY === null) return null;
    const match = this.doorTiles.find(
      (doorTile) => doorTile.tileX === tileX && doorTile.tileY === tileY,
    );
    return match?.collisionKey ?? null;
  }

  private getObjectProperties(obj: Phaser.Types.Tilemaps.TiledObject) {
    const props: Record<string, string> = {};
    if (!obj.properties) return props;
    obj.properties.forEach((prop: { name?: string; value?: unknown }) => {
      if (prop?.name) {
        props[prop.name] = String(prop.value ?? "");
      }
    });
    return props;
  }

  private parseTileId(value: string | undefined) {
    if (!value) return null;
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  }

  private ensureDoorColliderTexture() {
    const key = "door-collider";
    if (this.textures.exists(key)) return;
    const gfx = this.add.graphics();
    gfx.fillStyle(0xffffff, 1);
    gfx.fillRect(0, 0, 2, 2);
    gfx.generateTexture(key, 2, 2);
    gfx.destroy();
  }

  private setupPointerInteraction() {
    if (this.pointerListenerAttached) return;
    this.pointerListenerAttached = true;
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const doorKey = this.findDoorKeyAtWorld(pointer.worldX, pointer.worldY);
      if (doorKey) {
        this.tryDoorToggle(doorKey);
      }
    });

    const canvas = this.game.canvas;
    const onTouch = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const target = event.target as Node | null;
      const zone = document.getElementById("joystick-zone");
      if (zone && target && zone.contains(target)) return;

      const rect = canvas.getBoundingClientRect();
      const localX = touch.clientX - rect.left;
      const localY = touch.clientY - rect.top;
      const worldPoint = this.cameras.main.getWorldPoint(localX, localY);
      const doorKey = this.findDoorKeyAtWorld(worldPoint.x, worldPoint.y);
      if (doorKey) {
        this.tryDoorToggle(doorKey);
      }
    };

    canvas.addEventListener("touchend", onTouch, { passive: true });
    this.events.once("shutdown", () => {
      canvas.removeEventListener("touchend", onTouch);
    });
  }

  private setupResizeHandling() {
    // Vite + Phaser에서 resize 대응
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const { width, height } = gameSize;
      this.cameras.resize(width, height);
    });
  }

  private createFallbackWorld() {
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
