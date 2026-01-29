import Phaser from "phaser";

export interface Interactable {
  id: string;
  worldBounds: Phaser.Geom.Rectangle;
  priority?: number;
  containsPoint?: (point: Phaser.Math.Vector2) => boolean;
  interact(): void;
}

export class InteractionRegistry {
  private interactables = new Map<string, Interactable>();

  register(interactable: Interactable) {
    this.interactables.set(interactable.id, interactable);
  }

  unregister(id: string) {
    this.interactables.delete(id);
  }

  clear() {
    this.interactables.clear();
  }

  interactAtWorldPoint(point: Phaser.Math.Vector2): boolean {
    const target = this.findClosest(point, 0);
    if (!target) return false;
    target.interact();
    return true;
  }

  interactNearPoint(point: Phaser.Math.Vector2, maxDistance: number): boolean {
    const target = this.findClosest(point, maxDistance);
    if (!target) return false;
    target.interact();
    return true;
  }

  private findClosest(
    point: Phaser.Math.Vector2,
    maxDistance: number,
  ): Interactable | null {
    let best: Interactable | null = null;
    let bestPriority = Number.NEGATIVE_INFINITY;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const interactable of this.interactables.values()) {
      if (interactable.containsPoint && !interactable.containsPoint(point)) {
        continue;
      }
      const distance = distanceToRect(point, interactable.worldBounds);
      if (distance > maxDistance) continue;
      const priority = interactable.priority ?? 0;
      if (
        priority > bestPriority ||
        (priority === bestPriority && distance < bestDistance)
      ) {
        best = interactable;
        bestPriority = priority;
        bestDistance = distance;
      }
    }

    return best;
  }
}

function distanceToRect(
  point: Phaser.Math.Vector2,
  rect: Phaser.Geom.Rectangle,
) {
  const closestX = Phaser.Math.Clamp(point.x, rect.left, rect.right);
  const closestY = Phaser.Math.Clamp(point.y, rect.top, rect.bottom);
  return Phaser.Math.Distance.Between(point.x, point.y, closestX, closestY);
}
