/**
 * Room code shape, shared by the client and the server.
 *
 * The alphabet lives here rather than on the server because the lobby needs it
 * too: it filters what a player is allowed to type, so a typo is rejected at the
 * keystroke instead of becoming a failed join a moment later.
 *
 * 0/O and 1/I/L are excluded — codes get read out loud.
 */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;
