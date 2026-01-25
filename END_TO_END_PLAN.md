#+#+#+#+############################################################
# End-to-End Delivery Plan (7 Phases)
############################################################

This document translates the README vision into a practical, sequential plan
to reach a fully runnable metaverse library product. Each phase defines
completion criteria, dependencies, deliverables, risks, and a concrete checklist.

---

## Phase 1: Workspace Baseline & Dev Loop
**Objective (done looks like):** A clean, reproducible dev environment where
the frontend and backend can both start locally and communicate over a
temporary health-check channel.

**Key tasks**
- Implementation: standardize workspace scripts and shared types entrypoints
- Deployment/infra: define local ports and .env defaults
- Testing: minimal smoke checks (start, connect, send/receive)
- Design/UX: none (placeholder visuals ok)
- Docs: add local run instructions and troubleshooting

**Inputs/dependencies**
- Current repo structure (`front`, `back`, `shared`)
- Node.js + pnpm installed locally

**Outputs/deliverables**
- Working local start commands from repo root
- Shared message schema imported by both apps
- Health-check WS ping/pong demo

**Risks/unknowns + de-risk**
- Tooling mismatch (node/pnpm versions): pin versions in `.nvmrc` or README
- WS port collisions: document port map, allow override via `.env`

**Checklist**
- [ ] Add root-level `scripts` to run `front` and `back` easily
- [ ] Define `PORT`/`WS_URL` defaults for local dev
- [ ] Create a basic WS ping/pong in `back/src/index.ts`
- [ ] Add a minimal client WS connect in `front/src/main.ts`
- [ ] Document `pnpm install` + run steps

---

## Phase 2: Core World Rendering & Movement
**Objective (done looks like):** Users can load a 2D room, see their avatar,
move with keyboard/joystick, and stay within bounds consistently.

**Key tasks**
- Implementation: scene system, camera, boundaries, tiles or placeholder map
- Deployment/infra: none
- Testing: manual movement test + basic unit tests for math helpers
- Design/UX: placeholder sprites and UI hints
- Docs: update controls and controls FAQ

**Inputs/dependencies**
- Phase 1 dev loop
- Phaser scene structure in `front`

**Outputs/deliverables**
- Stable movement with frame-rate independent motion
- Camera scale/responsiveness on resize
- Simple asset pipeline (spritesheet or placeholder tiles)

**Risks/unknowns + de-risk**
- Performance on mobile: test on low-end device early
- Input conflicts: centralize input handling and add dead zones

**Checklist**
- [ ] Introduce `Scene`/`Room` structure
- [ ] Add world bounds and collision geometry
- [ ] Plug in sprites or placeholder tiles
- [ ] Implement input normalization and dead-zone handling

---

## Phase 3: Realtime Multiplayer Sync (WebSocket)
**Objective (done looks like):** Multiple clients join the same room and see
each other’s position updates in near real time.

**Key tasks**
- Implementation: WS server loop, presence list, client sync protocol
- Deployment/infra: configure WS server host/port
- Testing: manual 2+ browser sync; basic latency logging
- Design/UX: show other avatars with simple name labels
- Docs: protocol overview and message schemas

**Inputs/dependencies**
- Phase 1 WS baseline
- Shared message types in `shared/src/messages.ts`

**Outputs/deliverables**
- Join/leave and position update messages
- Client interpolation/smoothing
- Basic identity (guest id + nickname)

**Risks/unknowns + de-risk**
- State divergence: add periodic full-state snapshots
- Message floods: add send rate limits + server validation

**Checklist**
- [ ] Define WS message schema for presence and movement
- [ ] Implement server room state with in-memory store
- [ ] Broadcast position updates to nearby users
- [ ] Render remote avatars with smoothing

---

## Phase 4: WebRTC Signaling & Proximity Audio
**Objective (done looks like):** Users can hear others within distance using
WebRTC audio; signaling is relayed by the WS server.

**Key tasks**
- Implementation: WebRTC offer/answer/ICE via WS; audio stream attach
- Deployment/infra: STUN/TURN configuration for NAT traversal
- Testing: two users audio test on different networks
- Design/UX: mic permission flow and audio indicators
- Docs: troubleshooting audio setup and permissions

**Inputs/dependencies**
- Phase 3 realtime user presence
- Browser audio permissions and device support

**Outputs/deliverables**
- Working audio call per peer
- Distance-based volume attenuation
- Basic audio indicator UI

**Risks/unknowns + de-risk**
- NAT failures: add TURN in dev/prod and test early
- Echo/feedback: enable echo cancellation + gain controls

**Checklist**
- [ ] Add signaling message types to `shared`
- [ ] Implement WebRTC peer connection manager
- [ ] Integrate distance-based gain nodes
- [ ] Add mic permission + mute UX

---

## Phase 5: Selective Auditory Control (Core Feature)
**Objective (done looks like):** Users can control what they hear: mute users,
pin users, and filter by distance or location.

**Key tasks**
- Implementation: client-side audio routing and filter logic
- Deployment/infra: none
- Testing: local tests for filter precedence and UI toggles
- Design/UX: quick-access controls and settings panel
- Docs: explain filtering modes and priority rules

**Inputs/dependencies**
- Phase 4 audio pipeline
- User identity and location info

**Outputs/deliverables**
- Mute/pin/zone filters applied in real time
- Persisted user preferences (local storage)
- Clear UI states for each control

**Risks/unknowns + de-risk**
- Conflicting rules: define explicit precedence order
- Usability: conduct quick UX feedback sessions

**Checklist**
- [ ] Implement filter policy (mute > pin > distance/zone)
- [ ] Add control UI and shortcuts
- [ ] Persist preferences locally

---

## Phase 6: Rooms, Study Spaces & Screen Sharing
**Objective (done looks like):** Users can transition between spaces, join
study rooms, and share screens within a scoped audience.

**Key tasks**
- Implementation: room routing, portal logic, per-room membership
- Deployment/infra: scale WS rooms; update signaling to scope audiences
- Testing: room transition + screen share permission flows
- Design/UX: room labels, portal feedback, share UI
- Docs: explain room types and screen sharing flow

**Inputs/dependencies**
- Phase 3 room state and Phase 4 signaling
- UI patterns for room navigation

**Outputs/deliverables**
- Room-based routing with portals/doors
- Screen sharing stream scoped to room
- Study room UX ready for real use

**Risks/unknowns + de-risk**
- Screen share restrictions (browser/security): test Chrome/Edge/Safari
- Room isolation bugs: add server-side membership checks

**Checklist**
- [ ] Add room routing and portal entities
- [ ] Implement screen share track handling
- [ ] Scope stream delivery to current room

---

## Phase 7: Hardening, Deployment & Runbook
**Objective (done looks like):** The product is stable, deployable, and has
clear run steps for local and production environments.

**Key tasks**
- Implementation: error handling, reconnection, cleanup
- Deployment/infra: build pipeline, hosting plan, TURN/WS config
- Testing: smoke, regression, and manual UX pass
- Design/UX: polish UI and accessibility improvements
- Docs: deployment guide, ops runbook, user guide

**Inputs/dependencies**
- Phases 1–6 features implemented
- Hosting environment selected (VM or PaaS)

**Outputs/deliverables**
- Production build for frontend
- Backend service with env-configured ports and TURN creds
- Final documentation and runbook

**Risks/unknowns + de-risk**
- Deployment complexity: create a minimal docker setup
- Runtime stability: add health checks and logging

**Checklist**
- [ ] Add reconnection and error recovery flows
- [ ] Create production build and preview steps
- [ ] Document env vars and deployment steps
- [ ] Add basic monitoring/health checks

---

## Current Repo → Local Run (Quick Path)
1. `pnpm install` at repo root
2. `pnpm --filter back dev` to start WebSocket server
3. `pnpm --filter front dev` to start Vite client
4. Open the Vite URL (default: `http://localhost:5173`)

If backend and frontend need environment variables, add a `.env` file in each
package (or root) and document required values in README.
