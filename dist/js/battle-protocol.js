/** Shared wire compatibility and battle timing; no browser or service dependencies. */
export const PROTOCOL_VERSION = 1;
export const ACCEPTED_WORDS_SHA256 = '1de6e4a5ed213fb0b47b4fb8683b27ca61f5f5c85a032f7e7d7d2b34eac72a5a';
export const TARGET_WORDS_SHA256 = '3c6fa5455e4705c4516ee8ff0f77e0e66172a5eba8e523729810c7647e9f944d';
export const CLASSIFIED_TARGETS_SHA256 = 'e11332b277f2b4c880d8f78b1d677891e7452df62be242f4f0de3e0e1e591906';
export const TARGET_SELECTION_POLICY = 'regular-inflections-v1';
export const DICTIONARY_VERSION = `scowl-2020.12.07:${ACCEPTED_WORDS_SHA256}:${TARGET_WORDS_SHA256}:${TARGET_SELECTION_POLICY}:${CLASSIFIED_TARGETS_SHA256}`;

export const OUTDATED_ROOM_MESSAGE = 'This battle uses a different game version. Start a new battle from Home.';

export const COUNTDOWN_MS = 3_000;
export const TIE_MS = 200;
export const REVEAL_MS = 2_000;
export const LOBBY_MS = 30 * 60_000;
