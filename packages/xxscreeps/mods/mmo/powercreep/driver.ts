import { hooks } from 'xxscreeps/engine/runner/index.js';
import * as User from 'xxscreeps/engine/db/user/index.js';
import { create, getPowerCreepChannel, loadPowerCreepsBlob, upgrade } from './model.js';

declare module 'xxscreeps/engine/runner/index.js' {
	interface InitializationPayload {
		powerCreepsBlob: Readonly<Uint8Array> | null;
	}
	interface TickPayload {
		powerCreepsBlob?: Readonly<Uint8Array> | null;
		/** Account power (raw, for Game.gpl) — re-read each tick; harness setAccount writes it. */
		gplPower?: number;
	}
}

hooks.register('runnerConnector', async player => {
	const { userId } = player;
	const { db } = player.shard;
	let dirty = false;
	const channel = await getPowerCreepChannel(db, userId).subscribe();
	channel.listen(() => {
		dirty = true;
	});
	return [ () => channel.disconnect(), {
		async initialize(payload) {
			payload.powerCreepsBlob = await loadPowerCreepsBlob(db, userId);
		},

		async refresh(payload) {
			if (dirty) {
				dirty = false;
				payload.powerCreepsBlob = await loadPowerCreepsBlob(db, userId);
			}
			// Account power feeds Game.gpl (game.ts). Re-read each tick: it changes via paths that
			// don't fire the roster channel (backend upgrades, harness setAccount), and the read is
			// one hGet.
			try {
				payload.gplPower = Number(await db.data.hGet(User.infoKey(userId), 'power')) || 0;
			} catch { /* store mid-teardown */ }
		},

		async save(payload) {
			// Account-op intents from the runtime (PowerCreep.create / upgrade — harness patch):
			// same Model calls the HTTP backend routes make. Result codes are dropped (the runtime
			// already returned OK optimistically) — a rejection surfaces as the roster entry not
			// appearing/upgrading.
			const intents = payload.powerCreepAccountIntents ?? [];
			for (const intent of intents) {
				if (intent.type === 'create') {
					await create(db, userId, intent.name, intent.className);
				} else if (intent.type === 'upgrade') {
					await upgrade(db, userId, intent.id, intent.powers);
				}
			}
			// Each Model call publishes the roster channel, but that delivery is asynchronous and
			// lands AFTER the next tick's `refresh()` — the runtime would serve a stale
			// `Game.powerCreeps` for one extra tick, so the script sees no effect and re-issues every
			// create/upgrade. Our own writes are already committed by here, so flip `dirty` directly,
			// the same way `refresh()` re-reads `gplPower` rather than waiting on a channel. The
			// pubsub echo of these publishes still arrives later and costs one redundant reload.
			if (intents.length !== 0) {
				dirty = true;
			}
		},
	} ];
});
