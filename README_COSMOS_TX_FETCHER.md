# Cosmos SDK Transaction Fetcher

A comprehensive JavaScript/ESM library for fetching complete transaction history from Cosmos SDK-based blockchains (Tendermint/CometBFT) using RPC and REST APIs.

## Overview

This library solves a common challenge when working with Cosmos SDK chains: fetching ALL transactions where a wallet address is involved, whether as sender or receiver, across different message types (bank sends, IBC transfers, staking, governance, etc.).

### Key Features

- **Universal Cosmos SDK Support**: Works with any Cosmos SDK-based blockchain
- **Response Format Handling**: Automatically handles different response formats (standard `.result` wrapper vs direct responses)
- **Complete Transaction Discovery**: Finds all transactions where an address is involved in any capacity
- **Robust Parsing**: Handles various message and event formats across different SDK versions

### Key Challenge Solved

The Tendermint RPC `tx_search` endpoint doesn't support OR operators, meaning you cannot query for transactions where an address is EITHER the sender OR receiver in a single query. This library implements a comprehensive workaround by:

1. Executing multiple targeted queries for different event types
2. Deduplicating results by transaction hash
3. Providing a unified transaction history
4. Handling chain-specific response format variations

## Core Concepts

### Tendermint/CometBFT Architecture

Cosmos SDK chains use Tendermint (now CometBFT) as their consensus engine, which provides:

- **Event-based indexing**: Every transaction emits events that can be queried
- **RPC endpoints**: Direct access to blockchain data via JSON-RPC
- **REST API**: Higher-level HTTP/REST interface via gRPC gateway

### Event System

Transactions in Cosmos SDK emit events with attributes that can be queried:

```
Event Type: transfer
Attributes:
  - sender: cosmos1abc...
  - recipient: cosmos1xyz...
  - amount: 1000uatom
```

### Query Limitations

- **No OR operator**: Cannot query `sender='address' OR recipient='address'`
- **AND only**: Can only combine conditions with AND
- **Event-specific**: Must know exact event attribute names
- **Pagination required**: Results are paginated (default 30, max ~100)

## Features

- Fetches transactions from multiple event types automatically
- Handles pagination and rate limiting
- Deduplicates transactions by hash
- Parses and extracts transfer details
- Generates comprehensive transaction summaries
- Supports both RPC and REST API endpoints
- Implements retry logic for reliability
- Full TypeScript/ESM module support

## Installation

```bash
# Install dependencies
yarn add node-fetch dotenv

# Or with npm
npm install node-fetch dotenv
```

## Usage

### Basic Example

```javascript
import { TransactionFetcher } from './fetchAllTransactions.js';

const fetcher = new TransactionFetcher();
const address = 'cosmos1abc...'; // Your wallet address

// Fetch all transactions
const transactions = await fetcher.fetchAllTransactions(address);

// Generate summary
const summary = fetcher.generateSummary(transactions, address);
console.log(summary);
```

### Configuration

```javascript
// Custom endpoints for specific chains
const fetcher = new TransactionFetcher(
  'http://localhost:26657',  // RPC endpoint (Tendermint/CometBFT)
  'http://localhost:1317'     // REST endpoint (Cosmos SDK API)
);

// Environment variables (.env file)
RPC_ENDPOINT=http://localhost:26657
REST_ENDPOINT=http://localhost:1317
```

### Chain-Specific Configuration Examples

```bash
# Cosmos Hub
RPC_ENDPOINT=https://rpc.cosmos.network:26657
REST_ENDPOINT=https://api.cosmos.network

# Osmosis
RPC_ENDPOINT=https://rpc.osmosis.zone:26657
REST_ENDPOINT=https://api.osmosis.zone

# Juno
RPC_ENDPOINT=https://rpc.juno.network:26657
REST_ENDPOINT=https://api.juno.network

# Sei (handles non-standard response format)
RPC_ENDPOINT=http://tasty.seipex.fi:26657
REST_ENDPOINT=https://rest.sei-apis.com
```

### Advanced Usage

```javascript
// Query specific event types
const queries = [
  `message.sender='${address}'`,
  `transfer.recipient='${address}'`,
  `delegate.delegator='${address}'`
];

for (const query of queries) {
  const txs = await fetcher.queryTxsByEvent(query);
  console.log(`Found ${txs.length} transactions for query: ${query}`);
}

// Extract transfer details
const transfers = transactions.map(tx => 
  fetcher.extractTransfers(tx, address)
).flat();

// Parse transaction data
const parsed = fetcher.parseTransaction(transaction);
console.log(parsed.messages, parsed.events, parsed.fee);
```

## API Reference

### TransactionFetcher Class

#### Constructor
```javascript
new TransactionFetcher(rpcEndpoint?, restEndpoint?)
```

#### Methods

##### fetchAllTransactions(address)
Fetches complete transaction history for an address.

##### queryTxsByEvent(query, orderBy?)
Queries transactions by specific event attributes.

##### parseTransaction(tx)
Parses raw transaction data into structured format.

##### extractTransfers(tx, targetAddress)
Extracts transfer details from a transaction.

##### generateSummary(transactions, address)
Generates statistical summary of transactions.

##### fetchViaRestAPI(address, messageType?)
Alternative fetching using Cosmos SDK REST API.

## Event Queries

### Comprehensive Query List

The library queries these event types by default:

```javascript
// Sender events
message.sender='address'

// Receiver events
transfer.recipient='address'
coin_received.receiver='address'

// IBC transfers
fungible_token_packet.sender='address'
fungible_token_packet.receiver='address'

// Staking
delegate.validator='address'
message.delegator_address='address'

// Distribution
withdraw_rewards.validator='address'
withdraw_rewards.delegator='address'

// Governance
proposal_vote.voter='address'
proposal_deposit.depositor='address'
```

### Custom Queries

Add your own event queries:

```javascript
const customQueries = [
  `wasm.contract_address='${contractAddr}'`,
  `execute._contract_address='${contractAddr}'`,
  `instantiate._contract_address='${contractAddr}'`
];
```

## Transaction Structure

### Parsed Transaction Format

```javascript
{
  hash: "ABC123...",
  height: "1234567",
  timestamp: "2024-01-01T00:00:00Z",
  messages: [
    {
      "@type": "/cosmos.bank.v1beta1.MsgSend",
      from_address: "cosmos1...",
      to_address: "cosmos1...",
      amount: [{ denom: "uatom", amount: "1000" }]
    }
  ],
  events: [...],
  fee: {
    amount: [{ denom: "uatom", amount: "500" }],
    gas_limit: "200000"
  },
  memo: "Payment for services",
  success: true
}
```

### Transfer Details

```javascript
{
  type: "bank_send",
  from: "cosmos1abc...",
  to: "cosmos1xyz...",
  amount: [{ denom: "uatom", amount: "1000" }],
  direction: "sent" // or "received"
}
```

## Performance Considerations

### Rate Limiting
- Default delay: 200ms between pages
- Configurable via `RATE_LIMIT_DELAY`

### Pagination
- Default page size: 100 transactions
- Maximum recommended: 100 per page

### Caching
- Transactions deduplicated by hash
- Consider implementing persistent cache for large histories

### Optimization Tips

1. **Use specific queries**: More specific = faster
2. **Implement caching**: Store processed transactions
3. **Batch processing**: Process results as they arrive
4. **Height ranges**: Query specific block ranges when possible

## Error Handling

The library implements:
- Automatic retry with exponential backoff
- Graceful degradation on query failures
- Detailed error logging
- Timeout protection (10s default)

## Response Format Compatibility

The library automatically handles different response formats:

### Standard Cosmos SDK Format
```javascript
// Most chains use this format
{
  "jsonrpc": "2.0",
  "id": 0,
  "result": {
    "txs": [...],
    "total_count": "100"
  }
}
```

### Direct Format (Some Chains)
```javascript
// Some chains (like Sei) remove the .result wrapper
{
  "jsonrpc": "2.0",
  "id": 0,
  "txs": [...],
  "total_count": "100"
}
```

The library automatically detects and handles both formats transparently.

## Common Use Cases

### 1. Complete Transaction History
```javascript
const allTxs = await fetcher.fetchAllTransactions(address);
```

### 2. Sent Transactions Only
```javascript
const sentTxs = await fetcher.queryTxsByEvent(
  `message.sender='${address}'`
);
```

### 3. IBC Transfers
```javascript
const ibcTxs = await fetcher.queryTxsByEvent(
  `message.action='/ibc.applications.transfer.v1.MsgTransfer' AND message.sender='${address}'`
);
```

### 4. Failed Transactions
```javascript
const allTxs = await fetcher.fetchAllTransactions(address);
const failed = allTxs.filter(tx => {
  const parsed = fetcher.parseTransaction(tx);
  return !parsed.success;
});
```

## Testing

```bash
# Test with a specific address
node fetchAllTransactions.js cosmos1abc...

# With environment variables
RPC_ENDPOINT=https://rpc.cosmos.network:26657 \
REST_ENDPOINT=https://api.cosmos.network \
node fetchAllTransactions.js cosmos1abc...

# Output saved to transaction_history.json
```

## Limitations

1. **No OR operator**: Must run multiple queries
2. **Event indexing**: Node must have transaction indexing enabled
3. **Historical data**: Depends on node's pruning settings
4. **Rate limits**: Public endpoints may have rate limits
5. **Query complexity**: Complex queries may timeout

## Contributing

Improvements welcome! Key areas:
- Additional event types
- Better error handling
- Performance optimizations
- Support for more chains
- WebSocket subscriptions

## License

MIT

## Resources

- [Tendermint RPC Documentation](https://docs.tendermint.com/master/rpc/)
- [Cosmos SDK Documentation](https://docs.cosmos.network/)
- [CometBFT Documentation](https://docs.cometbft.com/)
- [Sei Network](https://www.sei.io/)
