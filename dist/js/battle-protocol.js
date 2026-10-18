/** Shared wire compatibility and battle timing; no browser or service dependencies. */
export const PROTOCOL_VERSION = 1;
export const ACCEPTED_WORDS_SHA256 = '0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d';
export const TARGET_WORDS_SHA256 = 'dbd074bb98944d70e5791f544c62d213d92303c163ebec5d7721398b566b16de';
export const DICTIONARY_VERSION = `scowl-2020.12.07:${ACCEPTED_WORDS_SHA256}:${TARGET_WORDS_SHA256}`;
export const COUNTDOWN_MS = 3_000;
export const TIE_MS = 200;
export const REVEAL_MS = 2_000;
export const LOBBY_MS = 30 * 60_000;
