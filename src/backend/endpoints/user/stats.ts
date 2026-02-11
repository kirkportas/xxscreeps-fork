import * as User from 'xxscreeps/engine/db/user/index.js';
import { hooks } from 'xxscreeps/backend/index.js';
import { GCL_MULTIPLY, GCL_POW } from 'xxscreeps/mods/controller/constants.js';
import { POWER_LEVEL_MULTIPLY, POWER_LEVEL_POW } from 'xxscreeps/game/constants/creep.js';
import { controlledRoomKey } from 'xxscreeps/mods/controller/processor.js';

hooks.register('route', {
	path: '/api/user/stats',

	async execute(context) {
		const { userId } = context.state;
		if (!userId) {
			return { ok: 1, stats: {} };
		}

		const statFields = [
			'energyControl',
			'energyHarvested',
			'energyConstruction',
			'energyCreeps',
			'creepsProduced',
			'creepsLost',
			'powerProcessed',
		];

		const [ values, rawGcl, rooms ] = await Promise.all([
			context.db.data.hmget(User.infoKey(userId), statFields),
			context.db.data.hget(User.infoKey(userId), 'gcl'),
			context.shard.scratch.scard(controlledRoomKey(userId)),
		]);

		const stats: Record<string, number> = {};
		for (let i = 0; i < statFields.length; i++) {
			stats[statFields[i]] = Number(values[statFields[i]]) || 0;
		}

		// GCL (matches official engine: game.js lines 130-162)
		const gclValue = Number(rawGcl) || 0;
		const gclLevel = Math.floor((gclValue / GCL_MULTIPLY) ** (1 / GCL_POW)) + 1;
		const gclBaseProgress = (gclLevel - 1) ** GCL_POW * GCL_MULTIPLY;

		// GPL (matches official engine: game.js lines 133-167)
		const powerProcessed = stats.powerProcessed;
		const gplLevel = Math.floor((powerProcessed / POWER_LEVEL_MULTIPLY) ** (1 / POWER_LEVEL_POW));
		const gplBaseProgress = gplLevel ** POWER_LEVEL_POW * POWER_LEVEL_MULTIPLY;

		return {
			ok: 1,
			stats,
			gcl: {
				level: gclLevel,
				progress: gclValue - gclBaseProgress,
				progressTotal: gclLevel ** GCL_POW * GCL_MULTIPLY - gclBaseProgress,
				rooms,
				cpu: 100,
			},
			gpl: {
				level: gplLevel,
				progress: powerProcessed - gplBaseProgress,
				progressTotal: (gplLevel + 1) ** POWER_LEVEL_POW * POWER_LEVEL_MULTIPLY - gplBaseProgress,
			},
		};
	},
});
