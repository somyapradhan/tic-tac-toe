export type PlayerMark = 'X' | 'O';

export interface PlayerInfo {
  id: string;
  username: string;
}

export interface Move {
  playerId: string;
  mark: PlayerMark;
  index: number; // 0..8
  at: number; // timestamp
}

export interface GameState {
  id: string;
  board: (PlayerMark | null)[]; // 9 cells
  players: {
    X: PlayerInfo;
    O: PlayerInfo;
  };
  currentTurn: PlayerMark;
  status: 'waiting' | 'active' | 'completed';
  winner: PlayerMark | 'draw' | null;
  moves: Move[];
  startedAt: number;
  endedAt?: number;
}
