export type GameMode='cpu'|'local'|'training';
export interface MatchSetup { mode:GameMode;p1:string;p2:string;difficulty:'EASY'|'NORMAL'|'HARD';stage?:'freezer'|'magicForest'|'diningTable'; }
export const DEFAULT_SETUP:MatchSetup={mode:'cpu',p1:'alien',p2:'doge',difficulty:'NORMAL'};
