// shared/src/messages.ts

export type ClientToServer =
  | { type: "join"; room: string; nickname: string; avatar: string }
  | { type: "move"; x: number; y: number }
  | { type: "signal"; to: string; data: any };

export type ServerToClient =
  | { type: "welcome"; id: string; users: UserState[] }
  | { type: "user_joined"; user: UserState }
  | { type: "user_left"; id: string }
  | { type: "state"; id: string; x: number; y: number }
  | { type: "signal"; from: string; data: any };

export interface UserState {
  id: string;
  nickname: string;
  avatar: string;
  x: number;
  y: number;
}
