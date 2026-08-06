import type { RoomObjectEffect } from './object.js';
import { struct, vector } from 'xxscreeps/schema/index.js';

/**
 * A stored power effect: an absolute `endTime` game tick plus the rank that applied it. Expiry is
 * lazy — nothing sweeps the list, readers filter against `Game.time`. This is the engine's existing
 * per-object timer idiom (controller safe mode, invader-core collapse) widened just far enough to
 * carry the `power`/`level` pair the real `RoomObject.effects` API reports.
 *
 * There is deliberately no generic effects substrate: only the objects a power can actually target
 * carry `'#effects'`, and each one opts in by putting `powerEffectsFormat` in its own shape.
 */
export interface PowerEffect {
	power: number;
	level: number;
	endTime: number;
}

/** Schema format for a `'#effects'` field. */
export const powerEffectsFormat = vector(struct({
	power: 'int32',
	level: 'int32',
	endTime: 'int32',
}));

/** `RoomObject.effects` entry. `power` is a non-standard alias of `effect`, kept for readability. */
export interface AppliedPowerEffect extends RoomObjectEffect {
	power: number;
}

/** Apply or refresh `power` on an effect list — one live record per power, as the real game does. */
export function applyPowerEffect(effects: PowerEffect[], power: number, level: number, endTime: number) {
	const existing = effects.find(effect => effect.power === power);
	if (existing) {
		existing.level = level;
		existing.endTime = endTime;
	} else {
		effects.push({ power, level, endTime });
	}
}

/** Project a stored effect list into the public `effects` shape, dropping expired records. */
export function readPowerEffects(effects: PowerEffect[], time: number): AppliedPowerEffect[] {
	return effects.filter(effect => effect.endTime > time).map(effect => ({
		effect: effect.power,
		power: effect.power,
		level: effect.level,
		ticksRemaining: effect.endTime - time,
	}));
}
