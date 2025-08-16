# Cosmos Transaction Fetcher

A comprehensive JavaScript/ESM library for fetching complete transaction history from Cosmos SDK-based blockchains (Tendermint/CometBFT) using RPC and REST APIs.

## Overview

This library solves the challenge of fetching ALL transactions where a wallet address is involved (as sender or receiver) across different message types. Since Tendermint RPC `tx_search` doesn't support OR operators, this implementation uses multiple queries and deduplication to provide complete transaction history.

### Key Challenge Solved

The Tendermint RPC `tx_search` endpoint doesn't support OR operators, meaning you cannot query for transactions where an address is EITHER the sender OR receiver in a single query. This library implements a comprehensive workaround by:

1. Executing multiple targeted queries for different event types
2. Deduplicating results by transaction hash
3. Providing a unified transaction history
4. Handling chain-specific response format variations

## Features

- 🔍 **Complete Transaction Discovery**: Finds all transactions where an address is involved
- 🌐 **Universal Cosmos SDK Support**: Works with any Cosmos SDK-based blockchain
- ⚡ **Fixed RPC Implementation**: Properly formatted tx_search queries with correct syntax
- 📚 **Multiple Query Methods**: Both RPC and REST API implementations
- 🔄 **Automatic Deduplication**: Removes duplicate transactions by hash
- 📊 **Transaction Parsing**: Extracts transfer details, events, and message types
- 🔁 **Retry Logic**: Automatic retries with exponential backoff
- 📝 **Response Format Handling**: Supports both standard and chain-specific formats

## Installation

```bash
npm install node-fetch dotenv
```

## Configuration

Create a `.env` file with your chain's endpoints:

```env
# Example for Juno
RPC_ENDPOINT=https://rpc.juno.basementnodes.ca
REST_ENDPOINT=https://api.juno.basementnodes.ca

# Example for Cosmos Hub
# RPC_ENDPOINT=https://rpc.cosmos.network:26657
# REST_ENDPOINT=https://api.cosmos.network

# Example for Osmosis
# RPC_ENDPOINT=https://rpc.osmosis.zone:26657
# REST_ENDPOINT=https://api.osmosis.zone

# Example for Sei (handles non-standard response format)
# RPC_ENDPOINT=http://tasty.seipex.fi:26657
# REST_ENDPOINT=https://rest.sei-apis.com
```

## Quick Start

```bash
# Fetch all transactions for a wallet
node fetchAllTransactions.js juno1wev8ptzj27aueu04wgvvl4gvurax6rj5la09yj

# Test RPC implementation with detailed diagnostics
node fixedRPCFetcher.js

# Use REST API implementation
node fetchWithREST.js
```

## Usage Examples

### Basic Transaction Fetching

```javascript
import { TransactionFetcher } from './fetchAllTransactions.js';

const fetcher = new TransactionFetcher();
const address = 'cosmos1abc...';

// Fetch all transactions
const transactions = await fetcher.fetchAllTransactions(address);

// Generate summary
const summary = fetcher.generateSummary(transactions, address);
console.log(summary);
```

### Custom RPC Queries

```javascript
// Query with proper syntax - CRITICAL: Double quotes around query, single quotes for values
const query = "message.sender='cosmos1abc...'";
const url = `${rpcEndpoint}/tx_search?query="${encodeURIComponent(query)}"&prove=false`;

// Fetch specific event types
const txs = await fetcher.queryTxsByEvent("transfer.recipient='cosmos1abc...'");
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

## RPC Query Syntax Guide

### Critical Rules

1. **Double quotes wrap the entire query in the URL**
2. **Single quotes for string values within the query**
3. **Only AND operator supported (no OR)**
4. **Always URL encode the query**

### Correct Examples

```javascript
// ✅ CORRECT
const url = `${rpc}/tx_search?query="${encodeURIComponent("message.sender='cosmos1...'")}"&prove=false`;

// ❌ WRONG - Will cause HTTP 500 errors
const url = `${rpc}/tx_search?query=${encodeURIComponent("message.sender='cosmos1...'")}&prove=false`;
```

### Supported Query Types

```bash
# Transaction by height
curl "${RPC}/tx_search?query=\"tx.height=12345\"&prove=false"

# By sender
curl "${RPC}/tx_search?query=\"message.sender='cosmos1...'\"&prove=false"

# By recipient
curl "${RPC}/tx_search?query=\"transfer.recipient='cosmos1...'\"&prove=false"

# Combined conditions
curl "${RPC}/tx_search?query=\"message.sender='cosmos1...' AND message.module='bank'\"&prove=false"

# Height range
curl "${RPC}/tx_search?query=\"tx.height>=100 AND tx.height<=200\"&prove=false"
```

## Standard Event Types

### Always Indexed
- `tx.height` - Block height
- `tx.hash` - Transaction hash

### Message Attributes
- `message.sender` - First signer of the message
- `message.action` - Full message type path (e.g., `/cosmos.bank.v1beta1.MsgSend`)
- `message.module` - Module handling the message (e.g., `bank`, `staking`)

### Common Events
- `transfer.recipient` - Bank transfer recipient
- `transfer.sender` - Bank transfer sender
- `coin_received.receiver` - Coin receiver
- `coin_spent.spender` - Coin spender

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

## File Descriptions

- **`fetchAllTransactions.js`** - Main implementation with fixed RPC queries
- **`fixedRPCFetcher.js`** - Advanced RPC fetcher with query testing and diagnostics
- **`fetchWithREST.js`** - REST API implementation for transaction fetching
- **`.env.example`** - Example configuration for various chains

## API Reference

### TransactionFetcher Class

```javascript
new TransactionFetcher(rpcEndpoint?, restEndpoint?)
```

#### Methods

- `fetchAllTransactions(address)` - Fetches complete transaction history
- `queryTxsByEvent(query, orderBy?)` - Queries transactions by specific events
- `parseTransaction(tx)` - Parses raw transaction data
- `extractTransfers(tx, targetAddress)` - Extracts transfer details
- `generateSummary(transactions, address)` - Generates statistical summary
- `fetchViaRestAPI(address, messageType?)` - Alternative fetching using Cosmos SDK REST API

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

## Complete Transaction History

Since OR operator is not supported, fetch complete history with multiple queries:

```javascript
const queries = [
    `message.sender='${address}'`,           // Sent transactions
    `transfer.recipient='${address}'`,       // Received transfers
    `coin_received.receiver='${address}'`,   // Received coins
];

// Execute all queries and deduplicate
const allTxs = [];
for (const query of queries) {
    const txs = await fetcher.queryTxsByEvent(query);
    allTxs.push(...txs);
}

// Remove duplicates by hash
const unique = fetcher.deduplicateTransactions(allTxs);
```

