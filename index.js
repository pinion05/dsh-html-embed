/**
 * Host half of the @local/html-embed bundle.
 *
 * All behavior lives in the Client module (`./client.js`), which registers a
 * Conversation event definition and a Chat node renderer. The Host half is an
 * empty activation so the row exists in every session without Host services.
 */
export function apply() {}
