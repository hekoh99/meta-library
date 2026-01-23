import "./style.css";
import Phaser from "phaser";
import nipplejs from "nipplejs";

type Vec2 = { x: number; y: number };

class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private joystickDir: Vec2 = { x: 0, y: 0 };
  private speed = 220; // px/sec

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
