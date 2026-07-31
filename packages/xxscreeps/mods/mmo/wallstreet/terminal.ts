import type { OrderType } from './order.js';
import type { DealIntent, OrderIntent } from './processor.js';
import type { Market } from 'xxscreeps/mods/classic/brokerage/market.js';
import type { ResourceType } from 'xxscreeps/mods/classic/resource/resource.js';
import { chainIntentChecks } from 'xxscreeps/game/checks.js';
import { intents } from 'xxscreeps/game/index.js';
import { StructureTerminal } from 'xxscreeps/mods/classic/brokerage/terminal.js';
import { checkIsActive, checkMyStructure } from 'xxscreeps/mods/classic/structure/structure.js';
import { checkOrderFee, checkOrderLimit, checkOrderParams } from './market.js';
import * as C from 'xxscreeps:mods/constants';

declare module 'xxscreeps/mods/classic/brokerage/terminal.js' {
	interface StructureTerminal {
		'#orderIntents'?: OrderIntent[];
		'#dealIntents'?: DealIntent[];

		/** Internal intent invoked by `market.createOrder` */
		'#createOrder': (market: Market, type: OrderType, resourceType: ResourceType, price: number, totalAmount: number) => ReturnType<typeof checkCreateOrder>;

		/** Internal intent invoked by `market.deal` */
		'#deal': (orderId: string, amount: number) => ReturnType<typeof checkDeal>;
	}
}

StructureTerminal.prototype['#createOrder'] =
	function(this: StructureTerminal, market: Market, type: OrderType, resourceType: ResourceType, price: number, totalAmount: number) {
		const millicredits = Math.round(price * 1000);
		const amount = Math.trunc(totalAmount);
		return chainIntentChecks(
			() => checkCreateOrder(this, market.credits * 1000, type, resourceType, millicredits, amount),
			() => {
				// The intent slot is unique per (object, action), so same-tick orders accumulate into a batch.
				const orderIntents = this['#orderIntents'] ??= [];
				orderIntents.push([ type, resourceType, millicredits, amount ]);
				return intents.save(this, 'createOrder', orderIntents);
			});
	};

StructureTerminal.prototype['#deal'] =
	function(this: StructureTerminal, orderId: string, amount: number) {
		const units = Math.trunc(amount);
		return chainIntentChecks(
			() => checkDeal(this, orderId, units),
			() => {
				// Same batching idiom as '#createOrder': one intent slot per (object, action), so
				// multiple same-tick deals accumulate rather than overwriting each other. The
				// MARKET_MAX_DEALS_PER_TICK cap is enforced processor-side, where the order book is
				// readable — the runtime cannot know which of these will actually clear.
				const dealIntents = this['#dealIntents'] ??= [];
				dealIntents.push([ orderId, units ]);
				return intents.save(this, 'deal', dealIntents);
			});
	};

/**
 * Runtime-side validation for `Game.market.deal`. Deliberately partial: order existence, the
 * counterparty's stock/credits and the price are only knowable from the order book, which lives in
 * the shard store — the processor re-checks everything there and drops a deal that cannot clear.
 * What we CAN check here is the caller's own terminal, mirroring `checkSend`.
 */
export function checkDeal(terminal: StructureTerminal, orderId: string, amount: number) {
	return chainIntentChecks(
		() => checkMyStructure(terminal, StructureTerminal),
		() => checkIsActive(terminal),
		() => (typeof orderId === 'string' && orderId.length > 0 && amount > 0 && Number.isInteger(amount))
			? C.OK : C.ERR_INVALID_ARGS,
		() => terminal.cooldown ? C.ERR_TIRED : C.OK,
	);
}

export function checkCreateOrder(terminal: StructureTerminal, credits: number, type: OrderType, resourceType: ResourceType, price: number, totalAmount: number) {
	return chainIntentChecks(
		() => checkOrderParams(type, resourceType, price, totalAmount),
		() => checkOrderFee(credits, totalAmount, price),
		() => checkMyStructure(terminal, StructureTerminal),
		() => checkOrderLimit(),
	);
}
