/**
 * Conversation history sent by the client with each inquiry (DECISIONS.md 31). No imports, so the browser bundle
 * can use this module without pulling in the rest of core.
 */

/** One earlier exchange: what the inquirer wrote and the reply they were shown. */
export interface Turn {
  inquiry: string;
  reply: string;
}

/** Earlier exchanges the model sees, newest last. Older ones are dropped, so the token budget stays predictable. */
export const HISTORY_LIMIT = 5;
