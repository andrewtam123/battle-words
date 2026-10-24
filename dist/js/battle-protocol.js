/** Shared wire compatibility and battle timing; no browser or service dependencies. */
export const PROTOCOL_VERSION = 1;
export const ACCEPTED_WORDS_SHA256 = '0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d';
export const TARGET_WORDS_SHA256 = 'dbd074bb98944d70e5791f544c62d213d92303c163ebec5d7721398b566b16de';
export const CLASSIFIED_TARGETS_SHA256 = '4de0f47dd08b450262ba32a1e6230e5c85a387acfb97857ce9098eeba88d75f7';
export const TARGET_SELECTION_POLICY = 'regular-inflections-v1';
export const DICTIONARY_VERSION = `scowl-2020.12.07:${ACCEPTED_WORDS_SHA256}:${TARGET_WORDS_SHA256}:${TARGET_SELECTION_POLICY}:${CLASSIFIED_TARGETS_SHA256}`;

// Previously sampled rooms already contain their full puzzle sequence. They can
// still be played because their accepted-answer bank and wire protocol are the
// same. This exact exception applies only to received match snapshots: HTTP
// handshakes must continue to pair the current frontend and Worker versions.
const LEGACY_ACCEPTED_WORDS_SHA256 = '0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d';
const LEGACY_DICTIONARY_VERSION = 'scowl-2020.12.07:0ac42b1613d53c6f06b4b7f240b00086c3a2f96b596c0e966b00bc16fa964f7d:dbd074bb98944d70e5791f544c62d213d92303c163ebec5d7721398b566b16de';
export function isCompatibleMatchDictionary(version) {
  return version === DICTIONARY_VERSION ||
    (ACCEPTED_WORDS_SHA256 === LEGACY_ACCEPTED_WORDS_SHA256 && version === LEGACY_DICTIONARY_VERSION);
}

export const COUNTDOWN_MS = 3_000;
export const TIE_MS = 200;
export const REVEAL_MS = 2_000;
export const LOBBY_MS = 30 * 60_000;
