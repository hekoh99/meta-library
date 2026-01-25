#+#+#+#+############################################################
# Phase 1 PR Todo List
############################################################

This document breaks Phase 1 into small, PR-sized tasks. Each task is designed
to be implemented in a single PR and includes clear scope and acceptance
criteria so an AI can execute it reliably.

---

## PR 1: Root workspace scripts + env defaults
**Goal:** Run both apps from repo root with predictable local ports and URLs.

**Detailed tasks**
- Create or update root `package.json` to include:
  - `dev:front` → `pnpm --filter front dev`
  - `dev:back` → `pnpm --filter back dev`
  - `dev` → `pnpm -r --parallel --filter front --filter back dev`
- Add root `.env.example` with:
  - `VITE_WS_URL=ws://localhost:8080`
  - `BACK_PORT=8080`
- Add `front/.env.example` and `back/.env.example` with the same keys.
- Ensure `.gitignore` keeps `.env` files untracked, but `.env.example` tracked.

**Acceptance criteria**
- `pnpm dev:front` starts Vite without errors.
- `pnpm dev:back` starts the WS server without errors.
- `pnpm dev` runs both processes in parallel from repo root.
- `.env.example` files exist in root, `front`, and `back`.

---

## PR 2: Shared message schema entrypoint
**Goal:** A typed message contract that both `front` and `back` import from
`shared`.

**Detailed tasks**
- Add `shared/src/messages.ts` (if missing) with:
  - `export type WsPing = { type: "ping"; ts: number }`
  - `export type WsPong = { type: "pong"; ts: number }`
  - `export type WsMessage = WsPing | WsPong`
- Add `shared/src/index.ts` exporting `WsPing`, `WsPong`, and `WsMessage`.
- If required, update `shared/package.json` to expose types:
  - Ensure `"main"` points to `index.js` (or a build output if used).
  - Add `"types"` or `exports` if TypeScript resolution fails.

**Acceptance criteria**
- `front` can import `WsMessage` from `shared`.
- `back` can import `WsMessage` from `shared`.
- TypeScript builds succeed in both packages.

---

## PR 3: Backend WebSocket ping/pong
**Goal:** A minimal WS server that accepts clients and replies with `pong`.

**Detailed tasks**
- Implement `back/src/index.ts`:
  - Start a `ws` server on `process.env.BACK_PORT || 8080`.
  - On `connection`, log a short message (client count optional).
  - On `message`, parse JSON to `WsMessage`.
  - If `type === "ping"`, send `{ type: "pong", ts }` back to the client.
  - Handle malformed JSON safely (try/catch + log warning).
  - On `close` and `error`, log short info.
- If needed, update `back/tsconfig.json` for Node + ES module compatibility.

**Acceptance criteria**
- `pnpm --filter back dev` starts a WS server on the configured port.
- A client sending `{ type: "ping", ts }` receives `{ type: "pong", ts }`.
- Invalid JSON does not crash the server.

---

## PR 4: Frontend WS client smoke test
**Goal:** The client connects to the backend and logs a `pong` response.

**Detailed tasks**
- In `front/src/main.ts`:
  - Create a `WebSocket` using `import.meta.env.VITE_WS_URL`.
  - On `open`, send `{ type: "ping", ts: Date.now() }`.
  - On `message`, parse JSON to `WsMessage` and log `pong`.
  - On `error` or `close`, log a warning (don’t throw).
- Optionally add a tiny UI text indicator (e.g., `WS: connected`) for visual
  confirmation during manual tests.

**Acceptance criteria**
- With backend running, frontend logs one `pong` after page load.
- If backend is down, frontend continues to render without runtime errors.

---

## PR 5: Local run documentation
**Goal:** A clear, copy-pasteable local run guide in README.

**Detailed tasks**
- Update `README.md` with:
  - `pnpm install` at repo root.
  - `pnpm dev` or `pnpm dev:front` / `pnpm dev:back`.
  - Environment setup: copy `.env.example` → `.env` for root/front/back.
  - Default ports and URLs (e.g., `http://localhost:5173`, `ws://localhost:8080`).
- Add a small troubleshooting section:
  - WS connection refused → check backend running and `VITE_WS_URL`.
  - Port in use → change `BACK_PORT`.

**Acceptance criteria**
- README includes explicit commands and environment setup.
- A new developer can run the app without guessing ports or scripts.
