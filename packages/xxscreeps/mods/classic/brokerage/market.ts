import type { TickPayload } from 'xxscreeps/engine/runner/index.js';
import type { GameBase } from 'xxscreeps/game/game.js';
import { Transactions } from 'xxscreeps/mods/classic/brokerage/transaction.js';

// Retain previous `Transactions` to reuse blobs from previous payload
let previousTransactions: Transactions | undefined;

// Harness-seeded market history (see driver.ts): parsed once per change, retained across ticks the
// same way transactions are. `null`/absent key clears it.
let historyRows: any[] = [];
let historyRaw: string | null | undefined;

/**
 * A global object representing the in-game market. You can use this object to track resource
 * transactions to/from your terminals, and your buy/sell orders.
 *
 * Learn more about the market system from [this article](https://docs.screeps.com/market.html).
 * @public
 * @see https://docs.screeps.com/api/#Game-market
 */
export class Market {
	readonly #map;
	readonly #transactions;

	constructor(game: GameBase, data?: TickPayload) {
		this.#map = game.map;
		previousTransactions =
			this.#transactions =
				new Transactions(data?.transactions, previousTransactions);
		if (data && 'marketHistory' in data && data.marketHistory !== historyRaw) {
			historyRaw = data.marketHistory;
			try { historyRows = data.marketHistory ? JSON.parse(data.marketHistory) : []; } catch { historyRows = []; }
		}
		this['#initialize'](data);
	}

	/**
	 * An array of the last 100 incoming transactions to your terminals.
	 * @public
	 * @see https://docs.screeps.com/api/#Game.market.incomingTransactions
	 */
	get incomingTransactions() { return this.#transactions.incoming; }

	/**
	 * An array of the last 100 outgoing transactions from your terminals.
	 * @public
	 * @see https://docs.screeps.com/api/#Game.market.outgoingTransactions
	 */
	get outgoingTransactions() { return this.#transactions.outgoing; }

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	'#initialize'(data: TickPayload | undefined) {}

	/**
	 * Estimate the energy transaction cost of
	 * [`StructureTerminal.send`](https://docs.screeps.com/api/#StructureTerminal.send) and
	 * [`Game.market.deal`](https://docs.screeps.com/api/#Game.market.deal) methods. The formula
	 * follows:
	 * ```
	 * Math.ceil( amount * ( 1 - Math.exp(-distanceBetweenRooms/30) ) )
	 * ```
	 * @param amount Amount of resources to be sent.
	 * @param roomName1 The name of the first room.
	 * @param roomName2 The name of the second room.
	 * @returns The amount of energy required to perform the transaction.
	 * @public
	 * @see https://docs.screeps.com/api/#Game.market.calcTransactionCost
	 */
	calcTransactionCost(amount: number, roomName1: string, roomName2: string) {
		const distance = this.#map.getRoomLinearDistance(roomName1, roomName2, true);
		return Math.ceil(amount * (1 - Math.exp(-distance / 30)));
	}

	/**
	 * Get daily price history of the specified resource on the market for the last 14 days.
	 *
	 * Harness hook: real order-book/price aggregation is not implemented in this engine; a test
	 * harness may seed MMO-shaped history rows ({resourceType, date, transactions, volume,
	 * avgPrice, stddevPrice}) under the store key the driver forwards each tick (see driver.ts).
	 * With nothing seeded this returns `[]`, matching "no market data yet" — never NaN/undefined.
	 * @public
	 * @see https://docs.screeps.com/api/#Game.market.getHistory
	 */
	getHistory(resourceType?: string) {
		return resourceType === undefined ? historyRows : historyRows.filter(row => row.resourceType === resourceType);
	}
}
