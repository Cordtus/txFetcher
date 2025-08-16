# Cosmos Transaction Fetcher

A comprehensive JavaScript/ESM library for fetching complete transaction history from Cosmos SDK-based blockchains using RPC and REST APIs.

## Features

- 🔍 **Complete Transaction Discovery**: Fetches all transactions where an address is involved
- 🌐 **Universal Cosmos SDK Support**: Works with any Cosmos SDK-based blockchain
- ⚡ **Fixed RPC Implementation**: Properly formatted tx_search queries with correct syntax
- 📚 **Multiple Query Methods**: Both RPC and REST API implementations
- 🔄 **Automatic Deduplication**: Removes duplicate transactions by hash
- 📊 **Transaction Analysis**: Parses and extracts transfer details

## Quick Start

### Installation

```bash
npm install node-fetch dotenv
```

### Configuration

Create a `.env` file with your chain's endpoints:

```env
# Example for Juno
RPC_ENDPOINT=https://rpc.juno.basementnodes.ca
REST_ENDPOINT=https://api.juno.basementnodes.ca
```

### Usage

```bash
# Fetch all transactions for a wallet
node fetchAllTransactions.js juno1wev8ptzj27aueu04wgvvl4gvurax6rj5la09yj

# Test specific transaction
node fetchWithREST.js

# Test RPC queries
node fixedRPCFetcher.js
```

## Files

- `fetchAllTransactions.js` - Main fetcher with fixed RPC implementation
- `fixedRPCFetcher.js` - Advanced RPC fetcher with query testing
- `fetchWithREST.js` - REST API implementation
- `RPC_QUERY_GUIDE.md` - Comprehensive guide for RPC queries
- `README_COSMOS_TX_FETCHER.md` - Detailed technical documentation

## RPC Query Examples

The key to proper RPC queries is correct quote formatting:

```javascript
// ✅ CORRECT - Double quotes around query, single quotes for values
const url = `${rpc}/tx_search?query="${encodeURIComponent("message.sender='cosmos1...'")}"&prove=false`;

// ❌ WRONG - Missing quotes will cause HTTP 500 errors
const url = `${rpc}/tx_search?query=${encodeURIComponent("message.sender='cosmos1...'")}&prove=false`;
```

## Supported Queries

- `message.sender='address'` - Transactions sent by address
- `transfer.recipient='address'` - Transfers received by address
- `coin_received.receiver='address'` - Coins received by address
- `tx.height=12345` - Transaction at specific height
- `message.module='bank'` - Transactions by module
- `message.action='/cosmos.bank.v1beta1.MsgSend'` - Specific message types

## Requirements

- Node.js 14+
- RPC endpoint with transaction indexing enabled
- REST API endpoint (optional, for fallback)

## Known Issues

- Some RPC nodes may have indexing disabled
- Not all event types are indexed on all nodes
- OR operator is not supported (must use multiple queries)

## License

MIT