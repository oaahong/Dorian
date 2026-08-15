export interface FighterIntent {
  move: -1 | 0 | 1;
  crouch: boolean;
  jumpPressed: boolean;
  lightPressed: boolean;
  heavyPressed: boolean;
  specialPressed: boolean;
  ultimatePressed: boolean;
}

export interface Controller {
  update(nowMs: number): FighterIntent;
  reset(): void;
}

export const EMPTY_INTENT: FighterIntent = {
  move: 0,
  crouch: false,
  jumpPressed: false,
  lightPressed: false,
  heavyPressed: false,
  specialPressed: false,
  ultimatePressed: false,
};
