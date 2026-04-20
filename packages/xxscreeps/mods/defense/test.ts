import * as C from 'xxscreeps/game/constants/index.js';
import { RoomPosition } from 'xxscreeps/game/position.js';
import { create as createConstructionSite } from 'xxscreeps/mods/construction/construction-site.js';
import { create as createCreep } from 'xxscreeps/mods/creep/creep.js';
import { lookForStructures } from 'xxscreeps/mods/structure/structure.js';
import { assert, describe, simulate, test } from 'xxscreeps/test/index.js';
import { create as createRampart, StructureRampart } from './rampart.js';
import { create as createTower, StructureTower } from './tower.js';

describe('ramparts', () => {
	const roomWithUnbuiltRamparts = simulate({
		W0N0: room => {
			room['#level'] = 3;
			room['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(24, 25, 'W0N0'), [ C.MOVE ], 'rampart_movement', '100'));
			room['#insertObject'](createConstructionSite(new RoomPosition(25, 25, 'W0N0'), 'rampart', '100'));
		},
	});

	test('moveTo should be able to pass trough rampart csite', () => roomWithUnbuiltRamparts(async ({ player, tick }) => {
		await player('100', Game => {
			assert.strictEqual(Game.creeps.rampart_movement.moveTo(25, 25), C.OK);
		});

		await tick();

		await player('100', Game => {
			const pos = Game.creeps.rampart_movement.pos;
			const { x, y } = pos;
			assert.strictEqual(x, 25);
			assert.strictEqual(y, 25);
		});
	}));

	test('move should be able to pass trough rampart csite', () => roomWithUnbuiltRamparts(async ({ player, tick }) => {
		await player('100', Game => {
			assert.strictEqual(Game.creeps.rampart_movement.move(C.RIGHT), C.OK);
		});

		await tick();

		await player('100', Game => {
			const pos = Game.creeps.rampart_movement.pos;
			const { x, y } = pos;
			assert.strictEqual(x, 25);
			assert.strictEqual(y, 25);
		});
	}));
});

describe('setPublic', () => {
	const roomWithRampart = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createRampart(new RoomPosition(25, 25, 'W1N1'), '100'));
			room['#insertObject'](createCreep(new RoomPosition(24, 25, 'W1N1'), [ C.MOVE ], 'hostile', '101'));
		},
	});

	test('private rampart blocks hostile creep', () => roomWithRampart(async ({ player, tick }) => {
		await player('101', Game => {
			assert.strictEqual(Game.creeps.hostile.move(C.RIGHT), C.OK);
		});
		await tick();
		await player('101', Game => {
			assert(Game.creeps.hostile.pos.isEqualTo(24, 25), 'hostile creep should not have moved');
		});
	}));

	test('setPublic returns ERR_NOT_OWNER for non-owner', () => roomWithRampart(async ({ player }) => {
		await player('101', Game => {
			const rampart = lookForStructures(Game.rooms.W1N1, C.STRUCTURE_RAMPART)[0];
			assert.strictEqual(rampart.setPublic(true), C.ERR_NOT_OWNER);
		});
	}));

	test('public rampart allows hostile creep', () => roomWithRampart(async ({ player, tick }) => {
		await player('100', Game => {
			const rampart = lookForStructures(Game.rooms.W1N1, C.STRUCTURE_RAMPART)[0];
			assert.strictEqual(rampart.setPublic(true), C.OK);
		});
		await tick();
		await player('101', Game => {
			assert.strictEqual(Game.creeps.hostile.move(C.RIGHT), C.OK);
		});
		await tick();
		await player('101', Game => {
			assert(Game.creeps.hostile.pos.isEqualTo(25, 25), 'hostile creep should have moved through public rampart');
		});
	}));
});

describe('Tower isActive', () => {
	// Tower has energy so the energy check passes first (matching official check ordering),
	// verifying that ERR_RCL_NOT_ENOUGH comes from the isActive check in the intent chain
	const simulation = simulate({
		W3N2: room => {
			const tower = createTower(new RoomPosition(25, 25, 'W3N2'), '100');
			tower.store['#add'](C.RESOURCE_ENERGY, C.TOWER_ENERGY_COST);
			room['#insertObject'](tower);
			room['#insertObject'](createCreep(new RoomPosition(26, 25, 'W3N2'), [ C.MOVE ], 'target', '101'));
			room['#level'] = 2;
			room['#user'] = room.controller!['#user'] = '100';
		},
	});

	test('tower attack returns ERR_RCL_NOT_ENOUGH when inactive', () => simulation(async ({ player }) => {
		await player('100', Game => {
			const tower = lookForStructures(Game.rooms.W3N2, C.STRUCTURE_TOWER)[0];
			assert.strictEqual(tower.attack(Game.rooms.W3N2.find(C.FIND_HOSTILE_CREEPS)[0]), C.ERR_RCL_NOT_ENOUGH);
		});
	}));
});

describe('rampart protection', () => {

	// Rampart protects creep from melee attack
	const meleeSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.TOUGH ], 'defender', '100'));
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 10000;
			room['#insertObject'](rampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 26, 'W1N1'), [ C.MOVE, C.ATTACK ], 'attacker', '101'));
		},
	});

	test('rampart protects creep from melee attack', () => meleeSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);
		const defenderId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_CREEPS, 25, 25)[0].id);

		await player('101', Game => {
			const attacker = Game.creeps.attacker;
			const defender = Game.getObjectById(defenderId)!;
			assert.strictEqual(attacker.attack(defender as any), C.OK);
		});

		await tick();

		await player('100', Game => {
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			const defender = Game.creeps.defender;
			assert.strictEqual(rampart.hits, 10000 - C.ATTACK_POWER);
			assert.strictEqual(defender.hits, 200);
		});
	}));

	// Rampart protects creep from ranged attack
	const rangedSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.TOUGH ], 'defender', '100'));
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 10000;
			room['#insertObject'](rampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 27, 'W1N1'), [ C.MOVE, C.RANGED_ATTACK ], 'ranger', '101'));
		},
	});

	test('rampart protects creep from ranged attack', () => rangedSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);
		const defenderId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_CREEPS, 25, 25)[0].id);

		await player('101', Game => {
			const ranger = Game.creeps.ranger;
			const defender = Game.getObjectById(defenderId)!;
			assert.strictEqual(ranger.rangedAttack(defender as any), C.OK);
		});

		await tick();

		await player('100', Game => {
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			const defender = Game.creeps.defender;
			assert.strictEqual(rampart.hits, 10000 - C.RANGED_ATTACK_POWER);
			assert.strictEqual(defender.hits, 200);
		});
	}));

	// Rampart protects creep from tower attack
	const towerSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.TOUGH ], 'defender', '100'));
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 100000;
			room['#insertObject'](rampart);
			const tower = createTower(new RoomPosition(25, 30, 'W1N1'), '101');
			tower.store['#add'](C.RESOURCE_ENERGY, C.TOWER_CAPACITY);
			room['#insertObject'](tower);
		},
	});

	test('rampart protects creep from tower attack', () => towerSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);
		const defenderId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_CREEPS, 25, 25)[0].id);

		await player('101', Game => {
			const tower = Object.values(Game.structures).find(
				(s: any) => s.structureType === 'tower') as StructureTower;
			const defender = Game.getObjectById(defenderId)!;
			assert.strictEqual(tower.attack(defender as any), C.OK);
		});

		await tick();

		await player('100', Game => {
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			const defender = Game.creeps.defender;
			assert.ok(rampart.hits < 100000);
			assert.strictEqual(defender.hits, 200);
		});
	}));

	// Rampart protects creep from rangedMassAttack
	const massAttackSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.TOUGH ], 'defender', '100'));
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 10000;
			room['#insertObject'](rampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 26, 'W1N1'), [ C.MOVE, C.RANGED_ATTACK ], 'massAttacker', '101'));
		},
	});

	test('rampart protects creep from rangedMassAttack', () => massAttackSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);

		await player('101', Game => {
			const massAttacker = Game.creeps.massAttacker;
			assert.strictEqual(massAttacker.rangedMassAttack(), C.OK);
		});

		await tick();

		await player('100', Game => {
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			const defender = Game.creeps.defender;
			assert.ok(rampart.hits < 10000);
			assert.strictEqual(defender.hits, 200);
		});
	}));

	// Low-HP rampart destroyed, remaining damage hits creep
	const lowHpRampartSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.TOUGH ], 'defender', '100'));
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 10;
			room['#insertObject'](rampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 26, 'W1N1'), [ C.MOVE, C.ATTACK ], 'attacker', '101'));
		},
	});

	test('rampart destroyed, remaining damage hits creep', () => lowHpRampartSetup(async ({ player, tick, peekRoom }) => {
		const defenderId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_CREEPS, 25, 25)[0].id);

		await player('101', Game => {
			const attacker = Game.creeps.attacker;
			const defender = Game.getObjectById(defenderId)!;
			assert.strictEqual(attacker.attack(defender as any), C.OK);
		});

		await tick();

		await player('100', Game => {
			const defender = Game.creeps.defender;
			assert.strictEqual(defender.hits, 200 - (C.ATTACK_POWER - 10));
			const structures = Game.rooms.W1N1.find(C.FIND_STRUCTURES);
			const ramparts = structures.filter((s: any) => s.structureType === 'rampart');
			assert.strictEqual(ramparts.length, 0);
		});
	}));

	// Dismantle redirected to rampart
	const dismantleSetup = simulate({
		W1N1: room => {
			room['#level'] = 8;
			room['#user'] = room.controller!['#user'] = '100';
			const tower = createTower(new RoomPosition(25, 25, 'W1N1'), '100');
			room['#insertObject'](tower);
			const rampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			rampart.hits = 10000;
			room['#insertObject'](rampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 26, 'W1N1'), [ C.MOVE, C.WORK ], 'dismantler', '101'));
		},
	});

	test('dismantle redirected to rampart', () => dismantleSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);
		const towerId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'tower')!.id);

		await player('101', Game => {
			const dismantler = Game.creeps.dismantler;
			const tower = Game.getObjectById<StructureTower>(towerId)!;
			assert.strictEqual(dismantler.dismantle(tower), C.OK);
		});

		await tick();

		await player('100', Game => {
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			const tower = Game.getObjectById<StructureTower>(towerId)!;
			assert.strictEqual(rampart.hits, 10000 - C.DISMANTLE_POWER);
			assert.strictEqual(tower.hits, C.TOWER_HITS);
		});
	}));

	// Counter-attack redirected to attacker's rampart
	const counterAttackSetup = simulate({
		W1N1: room => {
			room['#level'] = 3;
			room['#user'] = room.controller!['#user'] = '100';
			room['#insertObject'](createCreep(new RoomPosition(25, 25, 'W1N1'), [ C.MOVE, C.ATTACK ], 'attacker', '100'));
			const attackerRampart = createRampart(new RoomPosition(25, 25, 'W1N1'), '100');
			attackerRampart.hits = 10000;
			room['#insertObject'](attackerRampart);
			room['#insertObject'](createCreep(new RoomPosition(25, 26, 'W1N1'), [ C.MOVE, C.ATTACK ], 'counterAttacker', '101'));
		},
	});

	test('counter-attack redirected to attacker rampart', () => counterAttackSetup(async ({ player, tick, peekRoom }) => {
		const rampartId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_STRUCTURES, 25, 25).find(
				(s: any) => s.structureType === 'rampart')!.id);
		const counterAttackerId = await peekRoom('W1N1', room =>
			room.lookForAt(C.LOOK_CREEPS, 25, 26)[0].id);

		await player('100', Game => {
			const attacker = Game.creeps.attacker;
			const target = Game.getObjectById(counterAttackerId)!;
			assert.strictEqual(attacker.attack(target as any), C.OK);
		});

		await tick();

		await player('100', Game => {
			const attacker = Game.creeps.attacker;
			const rampart = Game.getObjectById<StructureRampart>(rampartId)!;
			assert.strictEqual(rampart.hits, 10000 - C.ATTACK_POWER);
			assert.strictEqual(attacker.hits, 200);
		});
	}));
});
