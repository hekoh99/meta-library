import "./style.css";
import Phaser from "phaser";
import nipplejs from "nipplejs";
import type {
  ClientToServer,
  UserState,
} from "shared/src/messages";
import { DEPTH } from "./depth";
import { DoorSystem } from "./systems/doorSystem";
import { InteractionRegistry } from "./systems/interactionRegistry";
import { NetworkClient, WorldStateApplier } from "./systems/network";
import { buildWorld } from "./world/buildWorld";

type WorldPoint = { x: number; y: number };

class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerBody!: Phaser.Physics.Arcade.Body;
  private joystickDir: WorldPoint = { x: 0, y: 0 };
  private speed = 220; // px/sec
  private network?: NetworkClient;
  private stateApplier?: WorldStateApplier;
  private selfId: string | null = null;
  private peers = new Map<string, Phaser.GameObjects.Sprite>();
  private lastSentAt = 0;
  private lastSentPos: WorldPoint = { x: 0, y: 0 };
  private nickname = `guest-${Math.floor(Math.random() * 10000)}`;
  private avatar = "box";
  private mapWidth = 0;
  private mapHeight = 0;
  private readonly mapKey = "library-map";
  private readonly fallbackSize = { width: 2000, height: 1200 };
  private readonly maxTileCount = 250_000;
  private mapUrl = "";
  private collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  private doorSystem?: DoorSystem;
  private interactKey?: Phaser.Input.Keyboard.Key;
  private interactionRegistry?: InteractionRegistry;
  private interactionRange = 48;
  private pointerListenerAttached = false;
  private lastDoorToggleAt = 0;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private pendingDoorToggles = new Set<string>();

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

    const world = buildWorld(this, {
      mapKey: this.mapKey,
      maxTileCount: this.maxTileCount,
      fallbackSize: this.fallbackSize,
      tilesets: {
        door: { name: "door-and-room", key: "tiles-door-and-room" },
        furniture: { name: "furniture", key: "tiles-furniture" },
        collisions: { name: "collisions", key: "tiles-collisions" },
      },
    });
    this.collisionLayer = world.layers.collision;
    this.mapWidth = world.worldSize.width;
    this.mapHeight = world.worldSize.height;
    this.physics.world.setBounds(0, 0, this.mapWidth, this.mapHeight);
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.interactionRegistry = new InteractionRegistry();
    if (world.map) {
      this.doorSystem = new DoorSystem({
        map: world.map,
        tilesets: world.tilesets,
        objectLayer: world.objectLayers.doors,
        collisionLayer: world.layers.collision,
        doorTilesetName: "door-and-room",
        onToggleRequested: (collisionKey) => this.tryDoorToggle(collisionKey),
      });
      this.doorSystem
        .createInteractables()
        .forEach((entry) => this.interactionRegistry?.register(entry));
      this.interactionRange =
        Math.max(world.map.tileWidth, world.map.tileHeight) * 1.5;
    }

    // 화면 중앙에 플레이어(일단 사각형)
    const cx = this.mapWidth / 2;
    const cy = this.mapHeight / 2;

    this.ensurePlayerTexture();
    this.player = this.physics.add.sprite(cx, cy, "player-box");
    this.player.setOrigin(0.5, 0.5);
    this.player.setTint(0xffffff);
    this.player.setDepth(DEPTH.PLAYER);
    this.playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    this.playerBody.setCollideWorldBounds(true);
    this.playerBody.setAllowGravity(false);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    if (this.collisionLayer) {
      this.physics.add.collider(this.player, this.collisionLayer);
    }
    if (this.doorSystem?.collisionLayer) {
      this.physics.add.collider(this.player, this.doorSystem.collisionLayer);
    }
    this.interactKey = this.input.keyboard?.addKey(
      Phaser.Input.Keyboard.KeyCodes.E,
    );
    this.cursors = this.input.keyboard?.createCursorKeys();

    // 안내 텍스트(디버그)
    this.add
      .text(12, 12, "Move: joystick (mobile) / arrow keys (desktop)", {
        fontFamily: "monospace",
        fontSize: "14px",
      })
      .setAlpha(0.85)
      .setScrollFactor(0)
      .setDepth(DEPTH.UI);

    this.setupJoystick();
    this.setupResizeHandling();
    this.setupNetwork();
    this.setupPointerInteraction();
  }

  update() {
    // 데스크탑용: 방향키도 같이 지원
    const cursors = this.cursors;
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
      const point = new Phaser.Math.Vector2(this.player.x, this.player.y);
      this.interactionRegistry?.interactNearPoint(
        point,
        this.interactionRange,
      );
    }
  }

  private setupJoystick() {
    // joystick-zone DOM 만들기
    const app = document.querySelector<HTMLDivElement>("#app");
    if (!app) throw new Error("#app not found");

    let zone = document.getElementById("joystick-zone") as HTMLDivElement | null;
    let createdHere = false;
    if (!zone) {
      zone = document.createElement("div");
      zone.id = "joystick-zone";
      app.appendChild(zone);
      createdHere = true;
    }

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

    this.events.once("shutdown", () => {
      manager.destroy();
      if (createdHere && zone?.parentElement) {
        zone.parentElement.removeChild(zone);
      }
    });
  }

  private setupNetwork() {
    const url =
      (import.meta.env.VITE_WS_URL as string | undefined) ??
      "ws://localhost:8080";
    const network = new NetworkClient();
    network.connect(url);
    this.network = network;

    this.stateApplier = new WorldStateApplier({
      onWelcome: (msg) => {
        this.selfId = msg.id;
        msg.users.forEach((user) => {
          if (user.id === this.selfId) {
            this.player.setTint(user.color);
            return;
          }
          this.upsertPeer(user);
        });
        msg.doors.forEach((door) => {
          this.doorSystem?.applyDoorState(door.key, door.isOpen);
        });
        if (this.pendingDoorToggles.size > 0) {
          this.pendingDoorToggles.forEach((key) => {
            this.network?.send({ type: "door_toggle", key });
          });
          this.pendingDoorToggles.clear();
        }
      },
      onUserJoined: (user) => {
        if (user.id === this.selfId) return;
        this.upsertPeer(user);
      },
      onUserLeft: (id) => {
        this.removePeer(id);
      },
      onState: (msg) => {
        if (msg.id === this.selfId) return;
        this.updatePeerPosition(msg.id, msg.x, msg.y);
      },
      onDoorState: (msg) => {
        this.doorSystem?.applyDoorState(msg.key, msg.isOpen);
      },
    });

    network.onOpen(() => {
      const join: ClientToServer = {
        type: "join",
        room: "lobby",
        nickname: this.nickname,
        avatar: this.avatar,
      };
      network.send(join);
      this.sendMove();
    });

    network.onMessage((msg) => {
      this.stateApplier?.apply(msg);
    });
  }

  private sendMove() {
    const payload: ClientToServer = {
      type: "move",
      x: this.player.x,
      y: this.player.y,
    };
    if (!this.network?.send(payload)) return;
    this.lastSentAt = this.time.now;
    this.lastSentPos = { x: this.player.x, y: this.player.y };
  }

  private sendMoveIfNeeded(nowMs: number) {
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
      sprite.setDepth(DEPTH.PLAYER);
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

  private requestDoorToggle(collisionKey: string) {
    const payload: ClientToServer = { type: "door_toggle", key: collisionKey };
    const sent = this.network?.send(payload) ?? false;
    if (!sent) {
      this.pendingDoorToggles.add(collisionKey);
      this.doorSystem?.toggleLocal(collisionKey);
    }
  }

  private tryDoorToggle(collisionKey: string) {
    const now = this.time?.now ?? performance.now();
    if (now - this.lastDoorToggleAt < 250) return;
    this.lastDoorToggleAt = now;
    this.requestDoorToggle(collisionKey);
  }

  private setupPointerInteraction() {
    if (this.pointerListenerAttached) return;
    this.pointerListenerAttached = true;
    const onPointerDown = (pointer: Phaser.Input.Pointer) => {
      this.interactionRegistry?.interactAtWorldPoint(
        new Phaser.Math.Vector2(pointer.worldX, pointer.worldY),
      );
    };
    this.input.on("pointerdown", onPointerDown);

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
      this.interactionRegistry?.interactAtWorldPoint(
        new Phaser.Math.Vector2(worldPoint.x, worldPoint.y),
      );
    };

    canvas.addEventListener("touchend", onTouch, { passive: true });
    this.events.once("shutdown", () => {
      canvas.removeEventListener("touchend", onTouch);
      this.input.off("pointerdown", onPointerDown);
    });
  }

  private setupResizeHandling() {
    // Vite + Phaser에서 resize 대응
    this.scale.on("resize", (gameSize: Phaser.Structs.Size) => {
      const { width, height } = gameSize;
      this.cameras.resize(width, height);
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
