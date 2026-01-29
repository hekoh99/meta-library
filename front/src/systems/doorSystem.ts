import Phaser from "phaser";
import type { Interactable } from "./interactionRegistry";
import { DEPTH } from "../depth";

type DoorTile = {
  collisionKey: string;
  tileX: number;
  tileY: number;
  closedTileId: number;
  openTileId: number;
};

type DoorSystemOptions = {
  map: Phaser.Tilemaps.Tilemap;
  tilesets: Phaser.Tilemaps.Tileset[];
  objectLayer?: Phaser.Tilemaps.ObjectLayer;
  collisionLayer?: Phaser.Tilemaps.TilemapLayer;
  doorTilesetName: string;
  onToggleRequested?: (collisionKey: string) => void;
};

class DoorState {
  private states = new Map<string, boolean>();

  ensure(key: string, isOpen: boolean) {
    if (!this.states.has(key)) {
      this.states.set(key, isOpen);
    }
  }

  set(key: string, isOpen: boolean) {
    this.states.set(key, isOpen);
  }

  get(key: string) {
    return this.states.get(key) ?? false;
  }
}

class DoorRenderer {
  constructor(private layer?: Phaser.Tilemaps.TilemapLayer) {}

  render(doorTile: DoorTile, isOpen: boolean) {
    if (!this.layer) return;
    const tileId = isOpen ? doorTile.openTileId : doorTile.closedTileId;
    this.layer.putTileAt(tileId, doorTile.tileX, doorTile.tileY);
  }
}

class DoorCollision {
  constructor(private layer?: Phaser.Tilemaps.TilemapLayer) {}

  render(doorTile: DoorTile, isOpen: boolean) {
    if (!this.layer) return;
    if (isOpen) {
      this.layer.removeTileAt(doorTile.tileX, doorTile.tileY);
      return;
    }
    const tile = this.layer.putTileAt(
      doorTile.closedTileId,
      doorTile.tileX,
      doorTile.tileY,
    );
    if (tile) {
      tile.setCollision(true, true, true, true);
    }
  }
}

export class DoorSystem {
  private doorGroups = new Map<string, DoorTile[]>();
  private state = new DoorState();
  private renderer: DoorRenderer;
  private collision: DoorCollision;
  private tileSize: { width: number; height: number };
  private doorLayer?: Phaser.Tilemaps.TilemapLayer;
  private doorCollisionLayer?: Phaser.Tilemaps.TilemapLayer;

  constructor(private options: DoorSystemOptions) {
    this.tileSize = {
      width: options.map.tileWidth,
      height: options.map.tileHeight,
    };
    this.doorLayer =
      options.map.createBlankLayer("doors-runtime", options.tilesets, 0, 0) ??
      undefined;
    if (this.doorLayer) {
      this.doorLayer.setDepth(DEPTH.DOORS);
    }

    this.doorCollisionLayer =
      options.map.createBlankLayer("doors-collision", options.tilesets, 0, 0) ??
      undefined;
    if (this.doorCollisionLayer) {
      this.doorCollisionLayer.setCollisionByExclusion([-1]);
      this.doorCollisionLayer.setVisible(false);
    }

    this.renderer = new DoorRenderer(this.doorLayer);
    this.collision = new DoorCollision(this.doorCollisionLayer);

    this.buildFromObjects();
  }

  get collisionLayer() {
    return this.doorCollisionLayer;
  }

  createInteractables(): Interactable[] {
    const interactables: Interactable[] = [];
    for (const [key, tiles] of this.doorGroups.entries()) {
      const bounds = this.getGroupBounds(tiles);
      interactables.push({
        id: `door:${key}`,
        worldBounds: bounds,
        priority: 10,
        interact: () => this.requestToggle(key),
      });
    }
    return interactables;
  }

  applyDoorState(collisionKey: string, isOpen: boolean) {
    const group = this.doorGroups.get(collisionKey);
    if (!group) return;
    this.state.set(collisionKey, isOpen);
    group.forEach((doorTile) => {
      this.renderer.render(doorTile, isOpen);
      this.collision.render(doorTile, isOpen);
    });
  }

  toggleLocal(collisionKey: string) {
    const current = this.state.get(collisionKey);
    this.applyDoorState(collisionKey, !current);
  }

  private requestToggle(collisionKey: string) {
    if (this.options.onToggleRequested) {
      this.options.onToggleRequested(collisionKey);
      return;
    }
    this.toggleLocal(collisionKey);
  }

  private buildFromObjects() {
    const doorsLayer = this.options.objectLayer;
    if (!doorsLayer) return;

    const doorTileset =
      this.options.tilesets.find(
        (tileset) => tileset.name === this.options.doorTilesetName,
      ) ?? null;
    const doorFirstGid = doorTileset?.firstgid ?? 1;

    doorsLayer.objects.forEach((obj) => {
      if (!obj.gid) return;
      const properties = getObjectProperties(obj);
      const collisionKey = properties.collisionKey;
      const closedTileId = parseTileId(properties.closedTileId);
      const openTileId = parseTileId(properties.openTileId);
      const status = properties.status ?? "closed";

      if (!collisionKey || closedTileId === null || openTileId === null) return;

      const objX = obj.x ?? 0;
      const objY = obj.y ?? 0;
      const tileX = Math.floor(objX / this.tileSize.width);
      const tileY = Math.floor(
        (objY - this.tileSize.height) / this.tileSize.height + 0.01,
      );
      const isOpen = status === "open";

      const doorTile: DoorTile = {
        collisionKey,
        tileX,
        tileY,
        closedTileId: doorFirstGid + closedTileId,
        openTileId: doorFirstGid + openTileId,
      };

      const group = this.doorGroups.get(collisionKey) ?? [];
      group.push(doorTile);
      this.doorGroups.set(collisionKey, group);
      this.state.ensure(collisionKey, isOpen);

      if (this.options.collisionLayer) {
        const tile = this.options.collisionLayer.getTileAt(tileX, tileY);
        if (tile) {
          this.options.collisionLayer.removeTileAt(tileX, tileY);
        }
      }
    });

    for (const [key, tiles] of this.doorGroups.entries()) {
      this.applyDoorState(key, this.state.get(key));
    }
  }

  private getGroupBounds(tiles: DoorTile[]) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    tiles.forEach((tile) => {
      minX = Math.min(minX, tile.tileX);
      minY = Math.min(minY, tile.tileY);
      maxX = Math.max(maxX, tile.tileX);
      maxY = Math.max(maxY, tile.tileY);
    });

    const worldX = this.options.map.tileToWorldX(minX);
    const worldY = this.options.map.tileToWorldY(minY);
    const width = (maxX - minX + 1) * this.tileSize.width;
    const height = (maxY - minY + 1) * this.tileSize.height;
    return new Phaser.Geom.Rectangle(worldX, worldY, width, height);
  }
}

function getObjectProperties(obj: Phaser.Types.Tilemaps.TiledObject) {
  const props: Record<string, string> = {};
  if (!obj.properties) return props;
  obj.properties.forEach((prop: { name?: string; value?: unknown }) => {
    if (prop?.name) {
      props[prop.name] = String(prop.value ?? "");
    }
  });
  return props;
}

function parseTileId(value: string | undefined) {
  if (!value) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}
