// shared/src/messages.ts

export type ClientToServer =
  | { type: "join"; room: string; nickname: string; avatar: string }
  | { type: "move"; x: number; y: number }
  | { type: "signal"; to: string; data: any }
  | { type: "door_toggle"; key: string };

export type ServerToClient =
  | { type: "welcome"; id: string; users: UserState[]; doors: DoorState[] }
  | { type: "user_joined"; user: UserState }
  | { type: "user_left"; id: string }
  | { type: "state"; id: string; x: number; y: number }
  | { type: "signal"; from: string; data: any }
  | { type: "door_state"; key: string; isOpen: boolean };

export interface UserState {
  id: string;
  nickname: string;
  avatar: string;
  color: number;
  x: number;
  y: number;
}

export interface DoorState {
  key: string;
  isOpen: boolean;
}
