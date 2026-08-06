/**
 * Dropped-intent ledger.
 *
 * An intent this engine ACCEPTS and then silently no-ops is invisible: no error reaches the player
 * code, no exception reaches whatever is driving the shard, and a test calibrated to the intent's
 * effect passes vacuously. That is a distinct failure class from a *rejected* intent, which the
 * player sees, and from a refused world seed, which the driver sees — nothing on either side is ever
 * asked about an accepted no-op.
 *
 * So every site that knowingly discards a well-formed intent records it here instead of returning in
 * silence. The ledger is process-global and cumulative, keyed by a short human-readable `kind`; the
 * first record of each distinct kind also prints one line to stderr, so a plain run surfaces the
 * no-op with no instrumentation on the caller's side at all. A driver that wants to gate on it reads
 * `droppedIntents` / `describeDroppedIntents` directly.
 */

/** Count of dropped intents by kind, cumulative for the life of the process. */
export const droppedIntents = new Map<string, number>();
const reasons = new Set<string>();
const announced = new Set<string>();

/**
 * Record one accepted-but-no-op intent. `kind` is the aggregation key (keep it stable and short);
 * `reason` explains why it was dropped and is collected once per distinct string.
 */
export function recordDroppedIntent(kind: string, reason?: string) {
	droppedIntents.set(kind, (droppedIntents.get(kind) ?? 0) + 1);
	if (reason !== undefined) {
		reasons.add(reason);
	}
	// One line per kind, not per occurrence: a power used on a cooldown loop would otherwise flood
	// the log, and the count is already in the ledger for anyone who wants it.
	if (!announced.has(kind)) {
		announced.add(kind);
		console.error(`[dropped intent] ${kind}${reason === undefined ? '' : ` — ${reason}`}. The intent ` +
			'was accepted and had no effect; whatever depends on it did not happen.');
	}
}

/** One line for a report: what was dropped and how often, then why. */
export function describeDroppedIntents() {
	const kinds = [ ...droppedIntents ]
		.map(([ kind, count ]) => count > 1 ? `${kind} ×${count}` : kind)
		.join('; ');
	return reasons.size > 0 ? `${kinds} — ${[ ...reasons ].join('; ')}` : kinds;
}

/** Reset the ledger. Only tests need this; the process-global lifetime is the point elsewhere. */
export function clearDroppedIntents() {
	droppedIntents.clear();
	reasons.clear();
	announced.clear();
}
