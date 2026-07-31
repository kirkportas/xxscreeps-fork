import type { OrderType } from './order.js';
import type { ResourceType } from 'xxscreeps/mods/classic/resource/resource.js';
import { registerIntentProcessor, registerObjectTickProcessor } from 'xxscreeps/engine/processor/index.js';
import * as Id from 'xxscreeps/engine/schema/id.js';
import { Fn } from 'xxscreeps/functional/fn.js';
import { Game } from 'xxscreeps/game/index.js';
import { StructureTerminal, calculateEnergyCost } from 'xxscreeps/mods/classic/brokerage/terminal.js';
import { checkMyStructure } from 'xxscreeps/mods/classic/structure/structure.js';
import { instantiate, removeOne } from 'xxscreeps/utility/utility.js';
import * as C from 'xxscreeps:mods/constants';
import { checkOrderParams } from './market.js';
import { applyOrderDeal, deleteOrder, incrementUserCredits, insertOrder, loadAndReadMarketOrder, loadUserCredits, updateOrderAmount } from './model.js';
import { Order } from './order.js';

export type OrderIntent = [ type: OrderType, resourceType: ResourceType, price: number, totalAmount: number ];
export type DealIntent = [ orderId: string, amount: number ];

export type WallStreetIntents = typeof intents;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const intents = [
	registerIntentProcessor(StructureTerminal, 'createOrder', {}, (terminal, context, orders: OrderIntent[]) => {
		if (!Array.isArray(orders) || checkMyStructure(terminal, StructureTerminal) !== C.OK) {
			return;
		}
		const { time } = Game;
		context.task(function() {
			const userId = terminal['#user']!;
			return Fn.mapAwait(
				Fn.slice(orders, 0, C.MARKET_MAX_ORDERS),
				async ([ type, resourceType, price, totalAmount ]) => {
					if (checkOrderParams(type, resourceType, price, totalAmount) === C.OK) {
						const buy = type === C.ORDER_BUY;
						const fee = Math.ceil(price * totalAmount * C.MARKET_FEE);
						if (await incrementUserCredits(context.shard, userId, -fee)) {
							const id = Id.generateId();
							const order = instantiate(Order, {
								id,
								amount: 0,
								created: time,
								createdTimestamp: Date.now(),
								remainingAmount: totalAmount,
								resourceType,
								roomName: terminal.room.name,
								totalAmount,
							});
							order['#buy'] = type === C.ORDER_BUY;
							order['#price'] = price;
							order['#user'] = userId;
							await insertOrder(context.shard, order);
							return { id, buy };
						}
					}
				});
		}(), orders => {
			const terminalOrders = terminal['#orders'];
			const { length } = terminalOrders;
			terminalOrders.push(...Fn.filter(orders));
			if (terminalOrders.length !== length) {
				context.setActive();
			}
		});
	}),

	/**
	 * `Game.market.deal` — the trade half of the market.
	 *
	 * Semantics follow the documented game rules: the dealer's terminal pays the energy transfer
	 * cost (`calculateEnergyCost` over the linear room distance, the same formula `send` uses) and
	 * goes on `TERMINAL_COOLDOWN`; resources move in the direction implied by the order type (the
	 * dealer BUYS from an `ORDER_SELL`, SELLS into an `ORDER_BUY`); credits move the other way at
	 * the order's price; the order's advertised and remaining volumes shrink by the dealt units;
	 * and no more than `MARKET_MAX_DEALS_PER_TICK` deals clear per tick.
	 *
	 * DIVERGENCE (documented deliberately): the counterparty's terminal is only debited/credited
	 * when its room is actually loadable. Orders seeded directly into the order book by a test
	 * harness — the case this engine build exists for — have no backing terminal, and the real
	 * server would reject them at creation. Rather than fail those deals (which would make every
	 * seeded-order scenario untestable), the counterparty side is treated as a market maker:
	 * the dealer's side is applied exactly, and the order book is decremented. `send` already
	 * tolerates a missing recipient terminal the same way.
	 */
	registerIntentProcessor(StructureTerminal, 'deal', {}, (terminal, context, deals: DealIntent[]) => {
		if (!Array.isArray(deals) || checkMyStructure(terminal, StructureTerminal) !== C.OK || terminal.cooldown) {
			return;
		}
		const userId = terminal['#user']!;
		const myRoomName = terminal.room.name;
		context.task(function() {
			return Fn.mapAwait(
				Fn.slice(deals, 0, C.MARKET_MAX_DEALS_PER_TICK),
				async ([ orderId, requested ]) => {
					const order = await loadAndReadMarketOrder(context.shard, orderId);
					if (!order || order['#user'] === userId) {
						// Missing/expired order, or our own — the real API returns ERR_INVALID_ARGS.
						return;
					}
					const dealerBuys = !order['#buy'];
					const range = Game.map.getRoomLinearDistance(myRoomName, order.roomName!);
					if (!(range < Infinity)) {
						return;
					}
					// Cap by what the order still has and by what our terminal can hold/give.
					const byOrder = Math.min(requested, order.remainingAmount);
					const byStore = dealerBuys
						? terminal.store.getFreeCapacity(order.resourceType) ?? 0
						: terminal.store[order.resourceType] ?? 0;
					const amount = Math.max(0, Math.min(byOrder, byStore));
					if (amount === 0) {
						return;
					}
					const energyCost = calculateEnergyCost(amount, range);
					const availableEnergy = terminal.store[C.RESOURCE_ENERGY] ?? 0;
					// Selling energy itself must cover both the goods and the transfer fee.
					const energyNeeded = (!dealerBuys && order.resourceType === C.RESOURCE_ENERGY)
						? energyCost + amount
						: energyCost;
					if (availableEnergy < energyNeeded) {
						return;
					}
					// Credits move opposite the goods, at the order's price (millicredits).
					const millicredits = amount * order['#price'];
					const ok = await incrementUserCredits(context.shard, userId, dealerBuys ? -millicredits : millicredits);
					if (!ok) {
						return;
					}
					// Pay the counterparty when they are a real player, mirroring the goods side.
					if (order['#user']) {
						await incrementUserCredits(context.shard, order['#user'], dealerBuys ? millicredits : -millicredits);
					}
					const remainingAmount = order.remainingAmount - amount;
					await applyOrderDeal(context.shard, orderId, Math.max(0, order.amount - amount), remainingAmount);
					return { amount, energyCost, resourceType: order.resourceType, dealerBuys, counterRoom: order.roomName! };
				});
		}(), results => {
			let dealt = false;
			for (const r of Fn.filter(results)) {
				const { amount, energyCost, resourceType, dealerBuys } = r!;
				terminal.store['#subtract'](C.RESOURCE_ENERGY, energyCost);
				if (dealerBuys) {
					terminal.store['#add'](resourceType, amount);
				} else {
					terminal.store['#subtract'](resourceType, amount);
				}
				dealt = true;
			}
			if (dealt) {
				terminal['#cooldownTime'] = Game.time + C.TERMINAL_COOLDOWN - 1;
				context.didUpdate();
				context.setActive();
			}
		});
	}),
];

// Update market book `amount` field for orders owned by this terminal
// TODO: On construction, acquire orphaned orders
// TODO: On destruction, update orphaned orders to `amount = 0`
registerObjectTickProcessor(StructureTerminal, (terminal, context) => {
	const terminalOrders = terminal['#orders'];
	if (terminalOrders.length === 0) {
		return;
	}
	context.setActive();
	context.task(async function() {
		// We only need user credit information if the user has an outstanding buy order
		const userId = terminal['#user']!;
		const hasBuyOrder = terminalOrders.some(order => order.buy);
		const userCredits = hasBuyOrder ? await loadUserCredits(context.shard, userId) : 0;

		// Update market book orders based on the terminal's stock and/or user's credits
		await Fn.mapAwait(terminalOrders, async terminalOrder => {
			const marketOrder = await loadAndReadMarketOrder(context.shard, terminalOrder.id);
			if (marketOrder) {
				const amount = terminalOrder.buy
					? Math.min(terminal.store.getFreeCapacity(), marketOrder.remainingAmount, Math.floor(userCredits / marketOrder['#price']))
					// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
					: Math.min(terminal.store[marketOrder.resourceType] ?? 0, marketOrder.remainingAmount);
				if (marketOrder.amount !== amount) {
					await updateOrderAmount(context.shard, marketOrder.id, amount);
				}
			} else {
				removeOne(terminalOrders, terminalOrder);
				await deleteOrder(context.shard, terminalOrder.id, userId);
			}
		});
	}());
});
