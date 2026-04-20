import type { RoomPosition } from 'xxscreeps/game/position.js';
import type { RoomObject as RoomObjectType } from 'xxscreeps/game/object.js';
import * as C from 'xxscreeps/game/constants/index.js';
import { Game, intents, me } from 'xxscreeps/game/index.js';
import * as RoomObject from 'xxscreeps/game/object.js';
import { registerBuildableStructure } from 'xxscreeps/mods/construction/index.js';
import { OwnedStructure, checkPlacement, ownedStructureFormat } from 'xxscreeps/mods/structure/structure.js';
import { compose, declare, struct, variant, withOverlay } from 'xxscreeps/schema/index.js';
import { asUnion, assign } from 'xxscreeps/utility/utility.js';

export const format = declare('Rampart', () => compose(shape, StructureRampart));
const shape = struct(ownedStructureFormat, {
	...variant('rampart'),
	hits: 'int32',
	isPublic: 'bool',
	'#nextDecayTime': 'int32',
});

export class StructureRampart extends withOverlay(OwnedStructure, shape) {
	override get hitsMax() {
		return this['#user'] === this.room.controller?.['#user']
			? C.RAMPART_HITS_MAX[this.room.controller.level] ?? 0 : 0;
	}

	override get structureType() { return C.STRUCTURE_RAMPART; }
	@enumerable get ticksToDecay() { return Math.max(0, this['#nextDecayTime'] - Game.time); }

	/**
	 * Make this rampart public to allow other players' creeps to pass through.
	 * @param isPublic Whether this rampart should be public or non-public.
	 */
	setPublic(isPublic: boolean) {
		if (this['#user'] === me) {
			intents.save(this, 'setPublic', Boolean(isPublic));
			return C.OK;
		} else {
			return C.ERR_NOT_OWNER;
		}
	}

	// Track whether #captureDamage already applied damage (to avoid double-damage in rangedMassAttack)
	declare ['#damageApplied']: boolean | undefined;

	// Rampart layer is higher than default (0.5) so it captures damage before creeps/structures
	override get ['#layer']() { return 1; }

	// Absorb up to remaining hits and apply damage to self. captureDamage() does NOT call
	// #applyDamage on intermediate objects, so we must apply damage here. rangedMassAttack calls
	// both #captureDamage and #applyDamage, so we set a flag to avoid double-damage.
	override ['#captureDamage'](power: number, _type: number, _source: RoomObjectType | null) {
		const absorbed = Math.min(power, this.hits);
		this.hits -= absorbed;
		this['#damageApplied'] = true;
		if (this.hits <= 0) {
			this['#destroy']();
		}
		return power - absorbed;
	}

	// Skip if captureDamage already applied damage (rangedMassAttack case). When the rampart is
	// the direct target, captureDamage skips it and #applyDamage handles the hit normally.
	override ['#applyDamage'](power: number, _type: number, _source?: RoomObjectType) {
		if (this['#damageApplied']) {
			this['#damageApplied'] = undefined;
			return;
		}
		if ((this.hits -= power) <= 0) {
			this['#destroy']();
		}
	}

	override '#checkObstacle'(user: string) {
		return !this.isPublic && user !== this['#user'];
	}
}

export function create(pos: RoomPosition, owner: string) {
	const rampart = assign(RoomObject.create(new StructureRampart(), pos), {
		hits: 1,
		isPublic: false,
	});
	rampart['#nextDecayTime'] = Game.time + C.RAMPART_DECAY_TIME - 1;
	rampart['#user'] = owner;
	return rampart;
}

registerBuildableStructure(C.STRUCTURE_RAMPART, {
	obstacle: false,
	checkPlacement(room, pos) {

		// Don't allow double ramparts
		for (const object of room['#lookAt'](pos)) {
			asUnion(object);
			if (object.structureType === 'rampart') {
				return null;
			}
		}
		return checkPlacement(room, pos) === C.OK ? 1 : null;
	},
	create(site) {
		return create(site.pos, site['#user']);
	},
});
