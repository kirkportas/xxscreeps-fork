import type { ProcessorContext } from 'xxscreeps/engine/processor/room.js';
import type { RoomObject } from 'xxscreeps/game/object.js';
import type { Direction } from 'xxscreeps/game/position.js';
import { recordDroppedIntent } from 'xxscreeps/engine/processor/dropped-intents.js';
import { registerIntentProcessor, registerObjectPreTickProcessor, registerObjectTickProcessor } from 'xxscreeps/engine/processor/index.js';
import * as Movement from 'xxscreeps/engine/processor/movement.js';
import { applyPowerEffect } from 'xxscreeps/game/effects.js';
import { Game } from 'xxscreeps/game/index.js';
import { createRoomObject, saveAction } from 'xxscreeps/game/object.js';
import { appendEventLog } from 'xxscreeps/game/room/event-log.js';
import { isBorder } from 'xxscreeps/game/terrain.js';
import { Source } from 'xxscreeps/mods/classic/source/source.js';
import { StructureController } from 'xxscreeps/mods/classic/controller/controller.js';
import { checkCarrier } from 'xxscreeps/mods/classic/creep/creep.js';
import { borderExitPosition, commitMove, flushActionLog, kRetainActionsTime, processDrop, processPickup, processSay, processTransfer, processWithdraw, teleportCreep } from 'xxscreeps/mods/classic/creep/processor.js';
import { Tombstone } from 'xxscreeps/mods/classic/creep/tombstone.js';
import { drop as dropResource } from 'xxscreeps/mods/classic/resource/processor/resource.js';
import { OpenStore } from 'xxscreeps/mods/classic/resource/store.js';
import { StructureSpawn, registerSpawnTimeEffect } from 'xxscreeps/mods/classic/spawn/spawn.js';
import { checkIsActive, checkMyStructure } from 'xxscreeps/mods/classic/structure/structure.js';
import { StructurePowerBank } from 'xxscreeps/mods/modern/powerbank/powerbank.js';
import { StructurePowerSpawn } from 'xxscreeps/mods/modern/powerspawn/powerspawn.js';
import * as C from 'xxscreeps:mods/constants';
import * as Constants from './constants.js';
import * as Model from './model.js';
import { PowerCreep, checkEnableRoom, checkRenew, checkUsePower, createSpawnedPowerCreep, powerInfoTable, powerOpsCost } from './powercreep.js';

function buryPowerCreep(creep: PowerCreep) {
	const tombstone = createRoomObject(new Tombstone(), creep.pos);
	tombstone.deathTime = Game.time;
	tombstone.store = new OpenStore();
	for (const [ resourceType, amount ] of creep.store['#entries']()) {
		tombstone.store['#add'](resourceType, amount);
	}
	const saying = creep['#saying'];
	tombstone['#creep'] = {
		body: [],
		id: creep.id,
		name: creep.name,
		saying: saying?.isPublic && saying.time === Game.time ? saying.message : undefined,
		ticksToLive: creep.ticksToLive ?? 0,
		user: creep['#user'],
	};
	tombstone['#decayTime'] = Game.time + C.TOMBSTONE_DECAY_POWER_CREEP;
	creep.room['#insertObject'](tombstone);
}

// `classic/spawn` owns the only spawn-duration computation but cannot see this mod's power table, so
// hand it the per-rank multipliers PWR_OPERATE_SPAWN applies. Both mods provide the 'processor' slot,
// so this registration is in place before any spawn intent is processed.
registerSpawnTimeEffect(C.PWR_OPERATE_SPAWN, powerInfoTable[C.PWR_OPERATE_SPAWN]!.effect!);

// Diagnostics only: power id -> `PWR_*` name, built lazily off the mod's own constants so the map
// cannot drift from the table it describes.
let powerNames: Map<number, string> | undefined;
function powerName(power: number) {
	powerNames ??= new Map(Object.entries(Constants)
		.filter((entry): entry is [ string, number ] =>
			entry[0].startsWith('PWR_') && typeof entry[1] === 'number')
		.map(([ name, value ]): [ number, string ] => [ value, name ]));
	return powerNames.get(power) ?? `power ${power}`;
}

// The duration a power's effect lasts at `level`, flat or per-rank.
function powerDuration(info: { duration?: number | number[] }, level: number) {
	const { duration } = info;
	return (Array.isArray(duration) ? duration[level - 1] : duration) ?? 0;
}

// The roster lives in account keyspace, so the death writeback rides `context.task`.
function killPowerCreep(creep: PowerCreep, context: ProcessorContext) {
	// A nuke's sweep and blast can each kill the same creep in one tick pass; only the first buries.
	if (!creep['#destroy']()) {
		return;
	}
	const user = creep['#user'];
	const id = creep.id;
	buryPowerCreep(creep);
	context.task(Model.setSpawnCooldown(context.shard.db, user, id, Date.now() + C.POWER_CREEP_SPAWN_COOLDOWN));
	context.setActive();
}

export type PowerCreepIntents = typeof intents;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const intents = [
	// The intent carries only the roster id; `claimSpawn` validates it against the authoritative
	// roster and returns the stored entry that seeds the room object.
	registerIntentProcessor(StructurePowerSpawn, 'spawnPowerCreep', {}, (spawn, context, id: string) => {
		if (checkMyStructure(spawn, StructurePowerSpawn) !== C.OK || checkIsActive(spawn) !== C.OK) {
			return;
		}
		if (spawn['#spawnTime'] === Game.time) {
			return;
		}
		spawn['#spawnTime'] = Game.time;
		const ageTime = Game.time + C.POWER_CREEP_LIFE_TIME;
		context.task(Model.claimSpawn(context.shard.db, spawn['#user']!, id, ageTime), entry => {
			if (entry) {
				spawn.room['#insertObject'](createSpawnedPowerCreep(spawn.pos, entry));
				context.didUpdate();
			}
		});
	}),

	registerIntentProcessor(PowerCreep, 'drop', { before: 'transfer' }, processDrop),

	registerIntentProcessor(PowerCreep, 'move', {}, (creep, context, direction: Direction) => {
		if (checkCarrier(creep) === C.OK) {
			// No MOVE parts to rank on; any creep that can move takes a contested tile first.
			Movement.announce(creep, direction, commit => commit(-Infinity, pos => {
				commitMove(creep, pos, C.ROAD_WEAROUT_POWER_CREEP);
				context.didUpdate();
			}));
		}
	}),

	registerIntentProcessor(PowerCreep, 'pickup', {}, processPickup),

	registerIntentProcessor(PowerCreep, 'say', {}, processSay),

	registerIntentProcessor(PowerCreep, 'transfer', { before: 'withdraw' }, processTransfer),

	registerIntentProcessor(PowerCreep, 'withdraw', { before: 'pickup' }, processWithdraw),

	registerIntentProcessor(PowerCreep, 'enableRoom', {}, (creep, context, id: string) => {
		const target = Game.getObjectById<StructureController>(id)!;
		if (checkEnableRoom(creep, target) === C.OK) {
			target.isPowerEnabled = true;
			saveAction(creep, 'attack', target.pos);
			context.didUpdate();
		}
	}),

	registerIntentProcessor(PowerCreep, 'renew', {}, (creep, context, id: string) => {
		const target = Game.getObjectById<StructurePowerSpawn | StructurePowerBank>(id)!;
		if (checkRenew(creep, target) === C.OK) {
			creep['#ageTime'] = Game.time + C.POWER_CREEP_LIFE_TIME;
			saveAction(creep, 'healed', target.pos);
			context.didUpdate();
		}
	}),

	registerIntentProcessor(PowerCreep, 'suicide', {}, (creep, context) => {
		if (checkCarrier(creep) === C.OK) {
			killPowerCreep(creep, context);
		}
	}),

	registerIntentProcessor(PowerCreep, 'usePower', {}, (creep, context, power: number, id: string | null) => {
		const target = id === null ? undefined : Game.getObjectById<RoomObject>(id) ?? undefined;
		if (checkUsePower(creep, power, target) !== C.OK) {
			return;
		}
		const info = powerInfoTable[power]!;
		const entry = creep['#powers'].find(entry => entry.power === power)!;
		switch (power) {
			case C.PWR_GENERATE_OPS: {
				const amount = info.effect![entry.level - 1]!;
				const overflow = Math.max(amount - creep.store.getFreeCapacity(C.RESOURCE_OPS), 0);
				creep.store['#add'](C.RESOURCE_OPS, amount - overflow);
				if (overflow > 0) {
					dropResource(creep.pos, C.RESOURCE_OPS, overflow);
				}
				break;
			}
			case C.PWR_OPERATE_SPAWN: {
				// The effect rides the spawn; `classic/spawn`'s needTime computation reads it when
				// the next spawn intent runs (see `spawnTimeMultiplier`). `checkUsePower` validates
				// ops/cooldown/range but not target type, so the type check belongs here.
				if (!(target instanceof StructureSpawn)) {
					recordDroppedIntent(`usePower ${powerName(power)}`,
						'target was not a spawn — checkUsePower validates range but not target type');
					return;
				}
				applyPowerEffect(
					target['#effects'], power, entry.level,
					Game.time + powerDuration(info, entry.level));
				break;
			}
			case C.PWR_REGEN_SOURCE: {
				// Harness patch: register the effect on the source (real API shape — level/duration
				// from POWER_INFO). The periodic +energy pulse is NOT implemented yet; player code
				// observing `source.effects` sees the application, which is what matters first.
				const source = target as Source;
				applyPowerEffect(
					source['#effects'], power, entry.level,
					Game.time + powerDuration(info, entry.level));
				break;
			}
			default:
				// Powers land one at a time; an unimplemented power's intent drops without cost. It
				// is ACCEPTED, though — nothing surfaces to the player or to a test driver — so the
				// no-op goes on the dropped-intent ledger rather than vanishing.
				recordDroppedIntent(`usePower ${powerName(power)}`, 'power is not implemented by this engine');
				return;
		}
		creep.store['#subtract'](C.RESOURCE_OPS, powerOpsCost(info, entry.level));
		entry.cooldownTime = Game.time + info.cooldown;
		appendEventLog(creep.room, {
			event: C.EVENT_POWER,
			objectId: creep.id,
			power,
			targetId: target?.id,
		});
		saveAction(creep, 'power', target?.pos ?? creep.pos);
		context.didUpdate();
	}),
];

registerObjectPreTickProcessor(PowerCreep, (creep, context) => {
	flushActionLog(creep['#actionLog'], context);
	const saying = creep['#saying'];
	if (saying) {
		if (saying.time <= Game.time - kRetainActionsTime) {
			creep['#saying'] = undefined;
			context.didUpdate();
		} else {
			context.wakeAt(saying.time + kRetainActionsTime);
		}
	}
});

PowerCreep.prototype['#applyNukeImpact'] = function(this: PowerCreep, _nuke: RoomObject, context: ProcessorContext) {
	killPowerCreep(this, context);
};

registerObjectTickProcessor(PowerCreep, (creep, context) => {
	// Settle damage deferred by `#applyDamage`
	const damage = creep.tickRawDamage ?? 0;
	if (damage > 0) {
		creep.hits = Math.max(0, creep.hits - damage);
		creep.tickRawDamage = 0;
		context.didUpdate();
	}
	if (creep.ticksToLive === 0 || creep.hits <= 0) {
		killPowerCreep(creep, context);
	} else if (isBorder(creep.pos.x, creep.pos.y)) {
		teleportCreep(creep, borderExitPosition(creep.pos), context);
	} else {
		context.wakeAt(creep['#ageTime']);
	}
});
