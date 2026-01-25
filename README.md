# Metaverse Library Web App

**Feature Development Technical Specification (v0.1)**

---

## 1. Project Overview

### 1.1 Purpose

This project aims to provide a **library-like space for exploration, reading, and conversation** within a web-based 2D metaverse environment.

Unlike real-world libraries, which require silence, this platform enables a **“talk-friendly library”** by leveraging **selective auditory control** in an online setting.

### 1.2 Design References

- 2D pixel-art–based metaverse UX
- Avatar movement and spatial interaction
- Reference: Gather Town

---

## 2. System Architecture Overview

### 2.1 Client (Web)

- TypeScript + Vite
- Phaser 3 (2D game / world rendering)
- WebRTC (voice and screen sharing)
- Web Audio API (spatial audio processing)
- Mobile-first design (touch / joystick-based input)

### 2.2 Server

- Node.js + TypeScript
- WebSocket (`ws`)
  - User position synchronization
  - Avatar state management
  - WebRTC signaling relay
- Future extension: REST API (book data, user statistics)

### 2.3 Data Layer (Initial / Scalable)

- Initial: In-memory state management
- Scalable: PostgreSQL (user statistics, book metadata)
- Cache / real-time state: Redis (optional)

---

## 3. User Access & Identification

### 3.1 Guest Access (MVP)

- Users can access the site without registration
- On entry:
  - A **temporary user ID** is generated (IP- or fingerprint-based)
  - Automatic nickname and avatar assignment
- Features available to guests:
  - Movement within spaces
  - Voice communication
  - Browsing and reading books
  - Viewing bulletin boards

### 3.2 Member Features (Planned)

- Login / signup UI provided via an **Information Desk NPC**
- Member-only features:
  - Book borrowing / returns
  - Visit history tracking
  - Personal settings (default audio filters, etc.)

---

## 4. Spatial Structure & Features

### 4.1 Space List

| Space | Function |
|------|----------|
| Information Desk | NPC guidance, login/signup, personal settings |
| Bookshelves | Literature / Non-fiction (expandable categories) |
| Public Reading Area | Free movement, proximity-based voice chat |
| Study Rooms | Small group discussions and screen sharing |
| Bulletin Board | Announcements, events, user posts |

Spaces are managed using **roomId-based routing**, and transitions occur via door/portal objects.

---

## 5. Voice & Communication Features

### 5.1 Voice Chat (Audio Only)

- WebRTC-based **audio-only communication**
- Default policy: Proximity-based voice chat

### 5.2 Spatial Audio Processing

- Distance calculation between users
- Distance-based volume control:
  - Louder when closer
  - Quieter when farther
  - Muted beyond a threshold distance
- Implementation:
  - Web Audio API `GainNode`
  - Per-stream audio control on the client side

### 5.3 Selective Auditory Control (Core Feature)

Users can **actively choose what they hear**.

Available controls:
- Mute specific users
- Listen only to pinned users
- Listen only within a certain distance
- Listen only to sounds from a specific location/table/study room
- Global mute (Quiet Mode)

> The server only transmits **who is where**.
>
> **All actual audio filtering logic is handled client-side.**

---

## 6. Screen Sharing

### 6.1 Study Room–Focused Feature

- Uses WebRTC `getDisplayMedia`
- Sharing scoped to study rooms or specific tables
- Managed as a separate track from audio

### 6.2 Access Control

- Screen sharing requires explicit user action
- Default: only users within the same room can receive the stream

---

## 7. User Activity Data & Sharing

### 7.1 Collected Data (Optional)

- Visit frequency
- Access time ranges
- Types of spaces visited (bookshelves, study rooms, etc.)

### 7.2 Privacy Principles

- Default: **Private**
- Data is shared only if the user explicitly opts in:
  - Visible to other users
  - Shown in personal profiles or statistics

### 7.3 Example Use Cases

- “Frequent visitors to this space”
- “Users who often visit at similar times”

---

## 8. Security & Access Control (Initial Design)

- HTTPS enforced
- WebRTC encryption enabled by default
- Guest access is unrestricted initially, with future considerations for:
  - Rate limiting
  - Feature restrictions
- Rooms / study rooms may optionally support private or secret links

---

## 9. Phased Development Scope

### MVP (Phase 1)

- 2D metaverse environment
- Avatar movement
- Proximity-based voice chat
- Selective muting
- Guest access

### Expansion (Phase 2)

- Book data integration
- Study rooms with screen sharing
- User activity analytics
- Membership system
