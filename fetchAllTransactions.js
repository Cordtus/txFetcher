import fetch from 'node-fetch';
import { setTimeout } from 'timers/promises';
import dotenv from 'dotenv';

dotenv.config();

// Configuration - Generic Cosmos SDK defaults
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'http://localhost:26657';
const REST_ENDPOINT = process.env.REST_ENDPOINT || 'http://localhost:1317';
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;
const PAGE_SIZE = 100;
const RATE_LIMIT_DELAY = 200;

/**
 * Comprehensive transaction fetcher for Cosmos SDK chains
 * Fetches all transactions where an address is involved as sender or receiver
 */
class TransactionFetcher {
	constructor(rpcEndpoint = RPC_ENDPOINT, restEndpoint = REST_ENDPOINT) {
		this.rpcEndpoint = rpcEndpoint.replace(/\/$/, '');
		this.restEndpoint = restEndpoint.replace(/\/$/, '');
		this.txCache = new Map();
	}

	/**
	 * Fetch with retry logic and error handling
	 */
	async fetchWithRetry(url, retries = MAX_RETRIES) {
		for (let attempt = 1; attempt <= retries; attempt++) {
			try {
				const response = await fetch(url, { 
					timeout: 10000,
					headers: {
						'Accept': 'application/json',
						'Content-Type': 'application/json'
					}
				});
				
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}: ${response.statusText}`);
				}
				
				return await response.json();
			} catch (error) {
				console.error(`Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
				
				if (attempt === retries) {
					throw error;
				}
				
				await setTimeout(RETRY_DELAY * attempt);
			}
		}
	}

	/**
	 * Query transactions using Tendermint RPC tx_search
	 * Uses correct query syntax with double quotes around query and single quotes for values
	 */
	async queryTxsByEvent(query, orderBy = 'desc') {
		const transactions = [];
		let page = 1;
		let hasMore = true;
		
		console.log(`Querying: ${query}`);
		
		while (hasMore) {
			// CRITICAL: Query must be wrapped in double quotes in the URL
			// String values within the query use single quotes
			const url = `${this.rpcEndpoint}/tx_search?query="${encodeURIComponent(query)}"&prove=false&page=${page}&per_page=${PAGE_SIZE}&order_by="${orderBy}"`;
			
			try {
				const response = await this.fetchWithRetry(url);
				
				// Check for errors first
				if (response.error) {
					console.error(`  Query error: ${response.error.message}`);
					if (response.error.data) {
						console.error(`  Details: ${response.error.data}`);
					}
					return transactions; // Return what we have so far
				}
				
				// Handle different response formats
				let txs = [];
				let totalCount = '0';
				
				if (response.result) {
					// Standard Cosmos SDK format
					txs = response.result.txs || [];
					totalCount = response.result.total_count || '0';
				} else if (response.txs) {
					// Direct format (some chains remove .result wrapper)
					txs = response.txs || [];
					totalCount = response.total_count || '0';
				} else {
					console.warn('Unexpected response format:', Object.keys(response));
				}
				
				if (txs.length === 0) {
					hasMore = false;
				} else {
					transactions.push(...txs);
					console.log(`  Page ${page}: Found ${txs.length} transactions (Total: ${totalCount})`);
					
					hasMore = txs.length === PAGE_SIZE;
					page++;
					
					if (hasMore) {
						await setTimeout(RATE_LIMIT_DELAY);
					}
				}
			} catch (error) {
				console.error(`Failed to fetch page ${page}: ${error.message}`);
				hasMore = false;
			}
		}
		
		return transactions;
	}

	/**
	 * Get all queries needed to find transactions for an address
	 * Note: Some event types may not be indexed on all nodes
	 */
	getAddressQueries(address) {
		return [
			// Core queries - most likely to be indexed
			`message.sender='${address}'`,
			`transfer.recipient='${address}'`,
			`coin_received.receiver='${address}'`,
			
			// Additional queries - may not be indexed on all nodes
			// Uncomment as needed based on node capabilities
			// `fungible_token_packet.sender='${address}'`,
			// `fungible_token_packet.receiver='${address}'`,
			// `delegate.validator='${address}'`,
			// `message.delegator_address='${address}'`,
			// `withdraw_rewards.validator='${address}'`,
			// `withdraw_rewards.delegator='${address}'`,
			// `proposal_vote.voter='${address}'`,
			// `proposal_deposit.depositor='${address}'`
		];
	}

	/**
	 * Fetch all transactions for a wallet address
	 */
	async fetchAllTransactions(address) {
		console.log(`\nFetching all transactions for ${address}\n`);
		
		const allTransactions = [];
		const queries = this.getAddressQueries(address);
		
		// Execute all queries
		for (const query of queries) {
			try {
				const txs = await this.queryTxsByEvent(query);
				allTransactions.push(...txs);
			} catch (error) {
				console.error(`Failed query: ${query}`, error.message);
			}
		}
		
		// Deduplicate by tx hash
		const uniqueTxs = this.deduplicateTransactions(allTransactions);
		
		// Sort by height (newest first)
		uniqueTxs.sort((a, b) => parseInt(b.height) - parseInt(a.height));
		
		console.log(`\nTotal unique transactions found: ${uniqueTxs.length}`);
		
		return uniqueTxs;
	}

	/**
	 * Deduplicate transactions by hash
	 */
	deduplicateTransactions(transactions) {
		const txMap = new Map();
		
		for (const tx of transactions) {
			const hash = tx.hash || tx.txhash;
			if (hash && !txMap.has(hash)) {
				txMap.set(hash, tx);
			}
		}
		
		return Array.from(txMap.values());
	}

	/**
	 * Parse and extract relevant transaction data
	 * Handles various Cosmos SDK response formats
	 */
	parseTransaction(tx) {
		const parsed = {
			hash: tx.hash || tx.txhash,
			height: tx.height,
			timestamp: null,
			messages: [],
			events: [],
			fee: null,
			memo: null,
			success: true,
			code: 0
		};
		
		// Decode transaction body if needed
		if (tx.tx) {
			try {
				// Handle base64 encoded transaction data
				let txData;
				if (typeof tx.tx === 'string') {
					const decoded = Buffer.from(tx.tx, 'base64').toString();
					// Try to parse as JSON, fallback to raw if fails
					try {
						txData = JSON.parse(decoded);
					} catch {
						// Some chains encode differently, try direct parsing
						txData = tx.tx;
					}
				} else {
					txData = tx.tx;
				}
				
				// Extract messages, memo, and fee
				parsed.messages = txData.body?.messages || txData.msg || [];
				parsed.memo = txData.body?.memo || txData.memo || '';
				parsed.fee = txData.auth_info?.fee || txData.fee || null;
			} catch (error) {
				console.error('Failed to parse tx data:', error.message);
			}
		}
		
		// Extract events and result
		// Handle different result field names across chains
		const result = tx.tx_result || tx.result || tx.TxResult || {};
		
		parsed.events = result.events || [];
		parsed.code = result.code || 0;
		parsed.success = parsed.code === 0;
		
		// Decode base64 encoded event attributes if needed
		parsed.events = parsed.events.map(event => {
			if (event.attributes && Array.isArray(event.attributes)) {
				event.attributes = event.attributes.map(attr => {
					// Check if attributes are base64 encoded
					if (attr.key && typeof attr.key === 'string' && !attr.key.includes(' ')) {
						try {
							const decodedKey = Buffer.from(attr.key, 'base64').toString();
							const decodedValue = attr.value ? Buffer.from(attr.value, 'base64').toString() : '';
							// If decoding produced valid strings, use them
							if (decodedKey && decodedKey.match(/^[\x20-\x7E]+$/)) {
								return {
									key: decodedKey,
									value: decodedValue,
									index: attr.index
								};
							}
						} catch {
							// If base64 decode fails, keep original
						}
					}
					return attr;
				});
			}
			return event;
		});
		
		// Extract timestamp from events if available
		for (const event of parsed.events) {
			if (event.type === 'tx' && event.attributes) {
				const timestampAttr = event.attributes.find(
					attr => attr.key === 'timestamp'
				);
				if (timestampAttr) {
					parsed.timestamp = timestampAttr.value;
				}
			}
		}
		
		return parsed;
	}

	/**
	 * Extract transfer details from transaction
	 * Handles multiple message formats across different Cosmos SDK versions
	 */
	extractTransfers(tx, targetAddress) {
		const transfers = [];
		const parsed = this.parseTransaction(tx);
		
		// Check messages for transfer info
		for (const msg of parsed.messages) {
			const msgType = msg['@type'] || msg.type || '';
			
			// Bank send messages
			if (msgType.includes('MsgSend') || msgType.includes('bank')) {
				const from = msg.from_address || msg.sender || msg.from;
				const to = msg.to_address || msg.receiver || msg.to;
				const amount = msg.amount || msg.value || [];
				
				if (from && to) {
					transfers.push({
						type: 'bank_send',
						from,
						to,
						amount,
						direction: from === targetAddress ? 'sent' : 
								  to === targetAddress ? 'received' : 'related'
					});
				}
			}
			
			// IBC transfers
			else if (msgType.includes('MsgTransfer') || msgType.includes('ibc')) {
				const sender = msg.sender || msg.from_address;
				const receiver = msg.receiver || msg.to_address;
				const token = msg.token || { denom: msg.denom, amount: msg.amount };
				
				if (sender) {
					transfers.push({
						type: 'ibc_transfer',
						from: sender,
						to: receiver || 'ibc-destination',
						amount: [token],
						source_channel: msg.source_channel || msg.sourceChannel,
						direction: sender === targetAddress ? 'sent' : 
								  receiver === targetAddress ? 'received' : 'related'
					});
				}
			}
			
			// Multi-send messages
			else if (msgType.includes('MsgMultiSend')) {
				// Handle inputs and outputs
				const inputs = msg.inputs || [];
				const outputs = msg.outputs || [];
				
				for (const input of inputs) {
					if (input.address === targetAddress) {
						transfers.push({
							type: 'multisend_input',
							from: input.address,
							to: 'multiple',
							amount: input.coins || input.amount,
							direction: 'sent'
						});
					}
				}
				
				for (const output of outputs) {
					if (output.address === targetAddress) {
						transfers.push({
							type: 'multisend_output',
							from: 'multiple',
							to: output.address,
							amount: output.coins || output.amount,
							direction: 'received'
						});
					}
				}
			}
		}
		
		// Check events for transfer info
		for (const event of parsed.events) {
			if (event.type === 'transfer' || event.type === 'coin_spent' || event.type === 'coin_received') {
				const getAttrValue = (key) => {
					const attr = event.attributes.find(a => a.key === key);
					return attr ? attr.value : null;
				};
				
				if (event.type === 'transfer') {
					const sender = getAttrValue('sender');
					const recipient = getAttrValue('recipient');
					const amount = getAttrValue('amount');
					
					if (sender && recipient && amount) {
						// Avoid duplicates from message parsing
						const isDuplicate = transfers.some(t => 
							t.from === sender && t.to === recipient && 
							JSON.stringify(t.amount) === JSON.stringify(amount)
						);
						
						if (!isDuplicate) {
							transfers.push({
								type: 'transfer_event',
								from: sender,
								to: recipient,
								amount: this.parseAmount(amount),
								direction: sender === targetAddress ? 'sent' : 
										  recipient === targetAddress ? 'received' : 'related'
							});
						}
					}
				} else if (event.type === 'coin_spent') {
					const spender = getAttrValue('spender');
					const amount = getAttrValue('amount');
					if (spender === targetAddress && amount) {
						transfers.push({
							type: 'coin_spent',
							from: spender,
							to: 'unknown',
							amount: this.parseAmount(amount),
							direction: 'sent'
						});
					}
				} else if (event.type === 'coin_received') {
					const receiver = getAttrValue('receiver');
					const amount = getAttrValue('amount');
					if (receiver === targetAddress && amount) {
						transfers.push({
							type: 'coin_received',
							from: 'unknown',
							to: receiver,
							amount: this.parseAmount(amount),
							direction: 'received'
						});
					}
				}
			}
		}
		
		return transfers;
	}
	
	/**
	 * Parse amount string to array format
	 * Handles formats like "1000uatom" or "1000uatom,2000uosmo"
	 */
	parseAmount(amountStr) {
		if (!amountStr) return [];
		if (Array.isArray(amountStr)) return amountStr;
		
		// Split by comma for multiple denominations
		const amounts = amountStr.split(',').map(a => a.trim());
		
		return amounts.map(amount => {
			// Extract number and denom from strings like "1000uatom"
			const match = amount.match(/^(\d+)(.+)$/);
			if (match) {
				return {
					amount: match[1],
					denom: match[2]
				};
			}
			return amount;
		});
	}

	/**
	 * Generate transaction summary
	 */
	generateSummary(transactions, address) {
		const summary = {
			address,
			totalTransactions: transactions.length,
			successfulTxs: 0,
			failedTxs: 0,
			sentTransfers: 0,
			receivedTransfers: 0,
			messageTypes: new Map(),
			eventTypes: new Map(),
			firstTx: null,
			lastTx: null
		};
		
		for (const tx of transactions) {
			const parsed = this.parseTransaction(tx);
			
			// Count success/failure
			if (parsed.success) {
				summary.successfulTxs++;
			} else {
				summary.failedTxs++;
			}
			
			// Track message types
			for (const msg of parsed.messages) {
				const msgType = msg['@type'] || msg.type || 'unknown';
				summary.messageTypes.set(msgType, (summary.messageTypes.get(msgType) || 0) + 1);
			}
			
			// Track event types
			for (const event of parsed.events) {
				summary.eventTypes.set(event.type, (summary.eventTypes.get(event.type) || 0) + 1);
			}
			
			// Count transfers
			const transfers = this.extractTransfers(tx, address);
			for (const transfer of transfers) {
				if (transfer.direction === 'sent') {
					summary.sentTransfers++;
				} else if (transfer.direction === 'received') {
					summary.receivedTransfers++;
				}
			}
			
			// Track first and last transactions
			const height = parseInt(parsed.height);
			if (!summary.firstTx || height < parseInt(summary.firstTx.height)) {
				summary.firstTx = { hash: parsed.hash, height: parsed.height };
			}
			if (!summary.lastTx || height > parseInt(summary.lastTx.height)) {
				summary.lastTx = { hash: parsed.hash, height: parsed.height };
			}
		}
		
		// Convert Maps to objects for display
		summary.messageTypes = Object.fromEntries(summary.messageTypes);
		summary.eventTypes = Object.fromEntries(summary.eventTypes);
		
		return summary;
	}

	/**
	 * Fetch using REST API (alternative method)
	 */
	async fetchViaRestAPI(address, messageType = null) {
		const events = [`message.sender='${address}'`];
		if (messageType) {
			events.push(`message.action='${messageType}'`);
		}
		
		const transactions = [];
		let nextKey = null;
		
		do {
			const params = new URLSearchParams({
				'events': events.join(' AND '),
				'pagination.limit': PAGE_SIZE.toString(),
				'order_by': 'ORDER_BY_DESC'
			});
			
			if (nextKey) {
				params.append('pagination.key', nextKey);
			}
			
			const url = `${this.restEndpoint}/cosmos/tx/v1beta1/txs?${params}`;
			
			try {
				const response = await this.fetchWithRetry(url);
				
				if (response.tx_responses) {
					transactions.push(...response.tx_responses);
				}
				
				nextKey = response.pagination?.next_key || null;
				
				if (nextKey) {
					await setTimeout(RATE_LIMIT_DELAY);
				}
			} catch (error) {
				console.error('REST API error:', error.message);
				break;
			}
		} while (nextKey);
		
		return transactions;
	}
}

// Example usage
async function main() {
	const fetcher = new TransactionFetcher();
	
	// Example wallet address (use generic cosmos address format)
	const walletAddress = process.argv[2];
	
	if (!walletAddress) {
		console.error('Usage: node fetchAllTransactions.js <wallet_address>');
		console.error('\nExamples:');
		console.error('  Cosmos Hub: cosmos1...');
		console.error('  Osmosis: osmo1...');
		console.error('  Juno: juno1...');
		console.error('  Sei: sei1...');
		console.error('\nEnvironment variables:');
		console.error('  RPC_ENDPOINT=http://localhost:26657');
		console.error('  REST_ENDPOINT=http://localhost:1317');
		console.error('\nNote: Make sure the RPC node has transaction indexing enabled!');
		process.exit(1);
	}
	
	try {
		// Test if indexing is enabled
		console.log('Testing node capabilities...');
		const testQuery = 'tx.height=1';
		const testResult = await fetcher.queryTxsByEvent(testQuery);
		
		if (testResult === null || (testResult.length === 0 && !testQuery.includes('height=1'))) {
			console.error('\n⚠️  Warning: Transaction indexing might be disabled on this node.');
			console.error('Please ensure the RPC endpoint has indexing enabled.');
		}
		
		// Fetch all transactions
		const transactions = await fetcher.fetchAllTransactions(walletAddress);
		
		// Generate summary
		const summary = fetcher.generateSummary(transactions, walletAddress);
		
		console.log('\n=== TRANSACTION SUMMARY ===');
		console.log(JSON.stringify(summary, null, 2));
		
		// Show sample transactions
		if (transactions.length > 0) {
			console.log('\n=== SAMPLE TRANSACTIONS (First 5) ===');
			
			for (let i = 0; i < Math.min(5, transactions.length); i++) {
				const tx = transactions[i];
				const parsed = fetcher.parseTransaction(tx);
				const transfers = fetcher.extractTransfers(tx, walletAddress);
				
				console.log(`\nTransaction ${i + 1}:`);
				console.log(`  Hash: ${parsed.hash}`);
				console.log(`  Height: ${parsed.height}`);
				console.log(`  Success: ${parsed.success}`);
				console.log(`  Messages: ${parsed.messages.length}`);
				console.log(`  Transfers: ${JSON.stringify(transfers, null, 2)}`);
			}
		}
		
		// Export to file
		const output = {
			summary,
			transactions: transactions.map(tx => fetcher.parseTransaction(tx))
		};
		
		const fs = await import('fs');
		fs.writeFileSync(
			'transaction_history.json',
			JSON.stringify(output, null, 2)
		);
		console.log('\nFull transaction history saved to transaction_history.json');
		
	} catch (error) {
		console.error('Error:', error.message);
		process.exit(1);
	}
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch(console.error);
}

export { TransactionFetcher };
