import { registerStruct } from 'xxscreeps/engine/schema/index.js';
import { roomObjectShape } from 'xxscreeps/game/schema.js';
import { ownedStructureShape } from 'xxscreeps/mods/classic/structure/schema.js';
import { declare, struct, variant, vector } from 'xxscreeps/schema/index.js';

/** @internal */
export const sourceShape = declare('Source', struct(roomObjectShape, {
	...variant('source'),

	/**
	 * The remaining amount of energy.
	 * @public
	 * @see https://docs.screeps.com/api/#Source.energy
	 */
	energy: 'int32',

	/**
	 * The total amount of energy in the source.
	 * @public
	 * @see https://docs.screeps.com/api/#Source.energyCapacity
	 */
	energyCapacity: 'int32',
	'#nextRegenerationTime': 'int32',

	// Applied power effects (harness patch: only PWR_REGEN_SOURCE writes here today). Sources are
	// instantiated from shard.json/create() at boot, so extending the shape does not invalidate any
	// pre-serialized blob.
	'#effects': vector(struct({
		power: 'int32',
		level: 'int32',
		endTime: 'int32',
	})),
}));

/** @internal */
export const keeperLairShape = declare('KeeperLair', struct(ownedStructureShape, {
	...variant('keeperLair'),
	'#nextSpawnTime': 'int32',
}));

// Register schema extensions
export type SourceSchemaRoomSchema = typeof roomSchema;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const roomSchema = registerStruct('Room', {
	'#cumulativeEnergyHarvested': 'int32',
});
