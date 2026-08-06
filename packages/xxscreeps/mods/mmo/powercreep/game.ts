import { registerVariant } from 'xxscreeps/engine/schema/index.js';
import { hooks, registerGlobal } from 'xxscreeps/game/index.js';
import { registerFindHandlers, registerLook } from 'xxscreeps/game/room/index.js';
import { compose } from 'xxscreeps/schema/index.js';
import * as C from 'xxscreeps:mods/constants';
import { PowerCreep, accountIntents, gplLevel, read } from './powercreep.js';
import { powerCreepShape } from './schema.js';

declare module 'xxscreeps/engine/runner/index.js' {
	interface TickResult {
		powerCreepAccountIntents?: typeof accountIntents;
	}
}

let roster: PowerCreep[] = [];

// Materialize the roster blob the driver sends: once on boot, then again whenever a mutation lands.
// The per-tick half deliberately does NOT live in `receive` — see the gameInitializer below.
hooks.register('runtimeConnector', {
	initialize(payload) {
		if (payload.powerCreepsBlob) {
			roster = read(payload.powerCreepsBlob);
		}
	},

	send(payload) {
		// Account-op intents (PowerCreep.create / upgrade — harness patch, see powercreep.ts):
		// ride the TickResult to driver.ts, which calls the backend routes' Model functions.
		if (accountIntents.length) {
			payload.powerCreepAccountIntents = accountIntents.splice(0);
		}
	},
});

// Add `powerCreeps` to the global `Game` object, keyed by name (including unspawned creeps). A spawned
// creep is a room object whose `#addToMyGame` overrides its roster entry here, so the spawned form wins
// wherever the creep is visible.
declare module 'xxscreeps/game/game.js' {
	interface Game {
		/**
		 * A hash containing all your power creeps with their names as hash keys. Even power creeps not
		 * spawned in the world can be accessed here.
		 * @public
		 * @see https://docs.screeps.com/api/#Game.powerCreeps
		 */
		powerCreeps: Record<string, PowerCreep>;
	}
}
hooks.register('gameInitializer', (Game, payload) => {
	// Read this tick's roster blob HERE, not in the connector's `receive`: `runWithGame`
	// (game/index.ts) constructs the Game object — running these initializers — and only then runs
	// the task that fires `receive`. A roster materialized in `receive` therefore reaches `Game` one
	// tick late, and player code that acts on roster state re-issues its whole create/upgrade
	// sequence on the following tick. `gplPower` below is read off the payload for the same reason.
	if (payload && 'powerCreepsBlob' in payload) {
		roster = payload.powerCreepsBlob == null ? [] : read(payload.powerCreepsBlob);
	}
	Game.powerCreeps = Object.create(null) as Record<string, PowerCreep>;
	for (const creep of roster) {
		Game.powerCreeps[creep.name] = creep;
	}
	// Game.gpl from the driver-forwarded account power (real-API shape; level starts at 0, matching
	// the engine's own capacity math in checkCreatePowerCreep).
	const power = payload?.gplPower ?? 0;
	const level = gplLevel(power);
	Game.gpl = {
		level,
		progress: power - Math.floor(level ** C.POWER_LEVEL_POW * C.POWER_LEVEL_MULTIPLY),
		progressTotal: Math.floor((level + 1) ** C.POWER_LEVEL_POW * C.POWER_LEVEL_MULTIPLY),
	};
});

declare module 'xxscreeps/game/game.js' {
	interface Game {
		/**
		 * Your Global Power Level.
		 * @see https://docs.screeps.com/api/#Game.gpl
		 */
		gpl: { level: number; progress: number; progressTotal: number };
	}
}

export type PowerCreepRoomSchema = typeof powerCreepSchema;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const powerCreepSchema = registerVariant('Room.objects', compose(powerCreepShape, PowerCreep));

export type PowerCreepFind = typeof find;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const find = registerFindHandlers({
	[C.FIND_POWER_CREEPS]: room => room['#lookFor'](C.LOOK_POWER_CREEPS),
	[C.FIND_MY_POWER_CREEPS]: room => room['#lookFor'](C.LOOK_POWER_CREEPS).filter(creep => creep.my),
	[C.FIND_HOSTILE_POWER_CREEPS]: room => room['#lookFor'](C.LOOK_POWER_CREEPS).filter(creep => !creep.my),
});

export type PowerCreepLook = [ typeof look ];
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const look = registerLook<PowerCreep>()(C.LOOK_POWER_CREEPS);

registerGlobal(PowerCreep);
declare module 'xxscreeps/game/runtime.js' {
	interface Global { PowerCreep: typeof PowerCreep }
}
