import C from 'xxscreeps/game/constants/index.js';
import { assert, describe, simulate, test } from 'xxscreeps/test/index.js';
import { RoomPosition } from 'xxscreeps/game/position.js';
import { create as createCreep } from 'xxscreeps/mods/creep/creep.js';

describe('Controller', () => {
	// W7N3: Player 100's owned room (always controlled)
	// W8N4: Unclaimed room with a claimer creep adjacent to the controller
	const claimRoom = simulate({
		W7N3: room => {
			room['#level'] = 1;
			room['#user'] =
				room.controller!['#user'] = '100';
		},
		W8N4: room => {
			room['#user'] = null;
			if (room.controller) {
				room.controller['#user'] = null;
			}
			// Controller at (30, 43), creep at (30, 44)
			room['#insertObject'](createCreep(new RoomPosition(30, 44, 'W8N4'), [ C.CLAIM, C.MOVE ], 'claimer', '100'));
		},
	});

	test('claimController succeeds with GCL 2', () => claimRoom(async({ shard, player, tick, peekRoom }) => {
		// GCL 1000000 → level 2, capacity 2 rooms. Player owns W7N3 (count = 1).
		await shard.db.data.hset('user/100', 'gcl', `${C.GCL_MULTIPLY}`);
		await shard.scratch.sadd('user/100/controlledRooms', [ 'W7N3' ]);

		await player('100', Game => {
			assert.strictEqual(Game.creeps.claimer.claimController(Game.rooms.W8N4.controller!), C.OK);
		});

		await tick();

		await peekRoom('W8N4', room => {
			assert.strictEqual(room.controller!['#user'], '100');
			assert(room.controller!.level > 0, 'Controller should have a level after claiming');
		});
	}));

	test('claimController fails with GCL 1', () => claimRoom(async({ shard, player }) => {
		// GCL 100 → level 1, capacity 1 room. Player owns W7N3 (count = 1).
		await shard.db.data.hset('user/100', 'gcl', '100');
		await shard.scratch.sadd('user/100/controlledRooms', [ 'W7N3' ]);

		await player('100', Game => {
			assert.strictEqual(
				Game.creeps.claimer.claimController(Game.rooms.W8N4.controller!),
				C.ERR_GCL_NOT_ENOUGH,
			);
		});
	}));

	test('failed claim resets controller owner to null', () => claimRoom(async({ shard, player, tick, peekRoom }) => {
		// GCL 1000000 → level 2, capacity 2. Player owns W7N3 (count = 1).
		// Client-side check passes: capacity (2) > count (1)
    // This test covers a previous failure mode that would leave a controller assigned to a user after a failed claim.
		await shard.db.data.hset('user/100', 'gcl', `${C.GCL_MULTIPLY}`);
		await shard.scratch.sadd('user/100/controlledRooms', [ 'W7N3' ]);

		await player('100', Game => {
			assert.strictEqual(Game.creeps.claimer.claimController(Game.rooms.W8N4.controller!), C.OK);
		});

		// Inject a 2nd room into controlled rooms AFTER client check but BEFORE processor runs.
		// Now count=2, capacity=2, so 2 > 2 is false → claim fails in processor.
		await shard.scratch.sadd('user/100/controlledRooms', [ 'W5N5' ]);

		await tick();

		// The bugfix: controller should be reset to null, not left with stale '#user'
		await peekRoom('W8N4', room => {
			assert.strictEqual(room.controller!['#user'], null, 'Controller owner should be null after failed claim');
			assert.strictEqual(room.controller!.level, 0, 'Controller level should remain 0');
		});
	}));
});
