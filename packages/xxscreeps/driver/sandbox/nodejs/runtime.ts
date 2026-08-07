import type { TickCompletion } from '../index.js';
import type { Compiler, Evaluate } from 'xxscreeps/driver/runtime/index.js';
import type { InitializationPayload, TickPayload } from 'xxscreeps/engine/runner/index.js';
import type { CPU } from 'xxscreeps/game/game.js';
import * as assert from 'node:assert/strict';
import * as process from 'node:process';
import { initialize as runtimeInitialize, tick as runtimeTick } from 'xxscreeps/driver/runtime/index.js';
import { hooks } from 'xxscreeps/game/index.js';

const kPleaseHalt = 'Please halt this sandbox.';

declare module 'xxscreeps/engine/runner/index.js' {
	interface TickResult {
		unsafeSandboxDidHalt?: boolean;
	}
}

/**
 * `Game.cpu.getUsed()` must report the script's own PROCESSOR time, not elapsed wall time.
 * The MMO server bills a per-isolate CPU clock, and bots self-regulate against it (bucket
 * staircases, per-subsystem budgets, throttle latches). A wall clock makes that reading depend on
 * whatever else the host is doing: run several sandboxes (or an unrelated build) at once and every
 * bot sees its own cost inflate, throttles, and behaves differently — which is both unfaithful and
 * non-reproducible for tests.
 *
 * The player's loop runs synchronously on this thread inside `node:vm`, so the thread's
 * (user + system) CPU time across the tick window IS the script's cost. `process.threadCpuUsage()`
 * (node >= 22.15) measures exactly that thread and is the closest analogue to isolated-vm's
 * `isolate.cpuTime`; `process.cpuUsage()` is the process-wide fallback, which additionally bills
 * V8 helper threads (concurrent GC) and anything the libuv thread pool happens to run during the
 * window. Wall clock remains available for comparison.
 *
 * Override with `XX_CPU_CLOCK=thread|process|wall`.
 */
const readCpuMicros = function(): () => number {
	const requested = process.env.XX_CPU_CLOCK;
	const hasThreadClock = typeof process.threadCpuUsage === 'function';
	const clock = requested === 'wall' || requested === 'process' ? requested :
		hasThreadClock ? 'thread' : 'process';
	switch (clock) {
		case 'wall': return () => Number(process.hrtime.bigint()) / 1e3;
		case 'process': return () => {
			const usage = process.cpuUsage();
			return usage.user + usage.system;
		};
		default: return () => {
			const usage = process.threadCpuUsage();
			return usage.user + usage.system;
		};
	}
}();

class NodejsCPU implements CPU {
	bucket;
	limit;
	tickLimit;
	readonly #startTime;

	constructor(data: TickPayload) {
		this.bucket = data.cpu.bucket;
		this.limit = data.cpu.limit;
		this.tickLimit = data.cpu.tickLimit;
		this.#startTime = readCpuMicros();
	}

	getHeapStatistics = () => ({} as never);

	getUsed = () => (readCpuMicros() - this.#startTime) / 1e3;

	halt = (): never => {
		throw new Error(kPleaseHalt);
	};
}

hooks.register('gameInitializer', (game, data) => {
	game.cpu = new NodejsCPU(data!);
});

// @ts-expect-error
globalThis.__assert = assert;

export function initialize<Module extends object>(require: NodeJS.Require, compiler: Compiler<Module>, evaluate: Evaluate, data: InitializationPayload) {
	runtimeInitialize(compiler, evaluate, data);
}

export function tick(data: TickPayload): TickCompletion {
	let didHalt = false as boolean;
	const completion = runtimeTick(data, fn => {
		try {
			fn();
		} catch (error) {
			if (error instanceof Error && error.message === kPleaseHalt) {
				didHalt = true;
			} else {
				throw error;
			}
		}
	});
	if (completion.result === 'success') {
		completion.payload.unsafeSandboxDidHalt = didHalt;
	}
	return completion;
}
