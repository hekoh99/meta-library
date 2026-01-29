import Phaser from "phaser";
import { DEPTH } from "../depth";

type WorldLayers = {
  background?: Phaser.Tilemaps.TilemapLayer;
  wallSide?: Phaser.Tilemaps.TilemapLayer;
  wallTop?: Phaser.Tilemaps.TilemapLayer;
  collision?: Phaser.Tilemaps.TilemapLayer;
};

type WorldObjectLayers = {
  doors?: Phaser.Tilemaps.ObjectLayer;
  interactions?: Phaser.Tilemaps.ObjectLayer;
};

export type BuildWorldResult = {
  map?: Phaser.Tilemaps.Tilemap;
  tilesets: Phaser.Tilemaps.Tileset[];
  layers: WorldLayers;
  objectLayers: WorldObjectLayers;
  usedFallback: boolean;
  worldSize: { width: number; height: number };
};

export type BuildWorldOptions = {
  mapKey: string;
  maxTileCount: number;
  fallbackSize: { width: number; height: number };
  tilesets: {
    door: { name: string; key: string };
    furniture: { name: string; key: string };
    collisions: { name: string; key: string };
  };
};

export function buildWorld(
  scene: Phaser.Scene,
  options: BuildWorldOptions,
): BuildWorldResult {
  if (!scene.cache.tilemap.exists(options.mapKey)) {
    return createFallbackWorld(scene, options.fallbackSize);
  }

  try {
    const map = scene.make.tilemap({ key: options.mapKey });
    if (map.width * map.height > options.maxTileCount) {
      return createFallbackWorld(scene, options.fallbackSize);
    }

    const tilesets = [
      map.addTilesetImage(options.tilesets.door.name, options.tilesets.door.key),
      map.addTilesetImage(
        options.tilesets.furniture.name,
        options.tilesets.furniture.key,
      ),
      map.addTilesetImage(
        options.tilesets.collisions.name,
        options.tilesets.collisions.key,
      ),
    ].filter(Boolean) as Phaser.Tilemaps.Tileset[];

    if (tilesets.length === 0 || !tilesets[0]) {
      return createFallbackWorld(scene, options.fallbackSize);
    }

    const layers: WorldLayers = {
      background: map.createLayer("background", tilesets, 0, 0) ?? undefined,
      wallSide: map.createLayer("wall-side", tilesets, 0, 0) ?? undefined,
      wallTop: map.createLayer("wall-top", tilesets, 0, 0) ?? undefined,
      collision: map.createLayer("collision", tilesets, 0, 0) ?? undefined,
    };

    layers.background?.setDepth(DEPTH.BACKGROUND);
    layers.wallSide?.setDepth(DEPTH.WALL_SIDE);
    layers.wallTop?.setDepth(DEPTH.WALL_TOP);
    if (layers.collision) {
      layers.collision.setCollisionByExclusion([-1]);
      layers.collision.setVisible(false);
    }

    const objectLayers: WorldObjectLayers = {
      doors: map.getObjectLayer("doors") ?? undefined,
      interactions: map.getObjectLayer("interactions") ?? undefined,
    };

    return {
      map,
      tilesets,
      layers,
      objectLayers,
      usedFallback: false,
      worldSize: { width: map.widthInPixels, height: map.heightInPixels },
    };
  } catch (error) {
    console.error("[map] create failed", error);
    return createFallbackWorld(scene, options.fallbackSize);
  }
}

function createFallbackWorld(
  scene: Phaser.Scene,
  size: { width: number; height: number },
): BuildWorldResult {
  const { width, height } = size;
  const tileKey = "fallback-tile";
  if (!scene.textures.exists(tileKey)) {
    const tile = 32;
    const gfx = scene.add.graphics();
    gfx.fillStyle(0x2a2a2a, 1);
    gfx.fillRect(0, 0, tile, tile);
    gfx.lineStyle(1, 0x333333, 1);
    gfx.strokeRect(0, 0, tile, tile);
    gfx.generateTexture(tileKey, tile, tile);
    gfx.destroy();
  }

  scene.add
    .tileSprite(0, 0, width, height, tileKey)
    .setOrigin(0, 0)
    .setDepth(DEPTH.BACKGROUND);

  return {
    tilesets: [],
    layers: {},
    objectLayers: {},
    usedFallback: true,
    worldSize: { width, height },
  };
}
