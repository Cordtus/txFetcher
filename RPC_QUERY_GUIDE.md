# Cosmos SDK RPC tx_search Query Guide

## Overview

The `tx_search` RPC endpoint allows querying transactions on Cosmos SDK chains using CometBFT/Tendermint event indexing. This guide explains the correct query syntax and common pitfalls.

## Query Syntax

### Basic Format
```
/tx_search?query="<conditions>"&prove=false&page=1&per_page=30&order_by="desc"
```

### Key Rules
1. **The entire query must be wrapped in double quotes in the URL**
2. **String values within the query must use single quotes**
3. **Only AND operator is supported (no OR)**
4. **Operators: `=`, `<`, `<=`, `>`, `>=`, `CONTAINS`, `EXISTS`**

### Correct URL Encoding
```javascript
// ✅ CORRECT - Double quotes around query, single quotes for values
const url = `${rpcEndpoint}/tx_search?query="${encodeURIComponent(query)}"&prove=false`;

// ❌ WRONG - Will cause HTTP 500 errors
const url = `${rpcEndpoint}/tx_search?query=${encodeURIComponent(query)}&prove=false`;
```

## Standard Event Types

### Always Indexed
- `tx.height` - Block height
- `tx.hash` - Transaction hash

### Message Attributes (Standard)
- `message.sender` - First signer of the message
- `message.action` - Full message type path
- `message.module` - Module handling the message

### Common Event Types
- `transfer.recipient` - Bank transfer recipient
- `transfer.sender` - Bank transfer sender  
- `transfer.amount` - Transfer amount
- `coin_received.receiver` - Coin receiver
- `coin_spent.spender` - Coin spender

## Query Examples

### 1. Query by Transaction Hash
```bash
curl "${RPC}/tx_search?query=\"tx.hash='ABC123'\"&prove=false"
```

### 2. Query by Block Height
```bash
# Single height
curl "${RPC}/tx_search?query=\"tx.height=12345\"&prove=false"

# Height range
curl "${RPC}/tx_search?query=\"tx.height>=100 AND tx.height<=200\"&prove=false"
```

### 3. Query by Wallet Address
```bash
# As sender
curl "${RPC}/tx_search?query=\"message.sender='cosmos1abc...'\"&prove=false"

# As recipient
curl "${RPC}/tx_search?query=\"transfer.recipient='cosmos1abc...'\"&prove=false"

# Combined (sender AND specific module)
curl "${RPC}/tx_search?query=\"message.sender='cosmos1abc...' AND message.module='bank'\"&prove=false"
```

### 4. Query by Message Type
```bash
# Specific message type
curl "${RPC}/tx_search?query=\"message.action='/cosmos.bank.v1beta1.MsgSend'\"&prove=false"

# By module
curl "${RPC}/tx_search?query=\"message.module='staking'\"&prove=false"
```

### 5. IBC Queries
```bash
# IBC transfers
curl "${RPC}/tx_search?query=\"message.action='/ibc.applications.transfer.v1.MsgTransfer'\"&prove=false"

# Specific channel
curl "${RPC}/tx_search?query=\"send_packet.packet_src_channel='channel-0'\"&prove=false"
```

## JavaScript Implementation

### Correct Implementation
```javascript
async function txSearch(rpcEndpoint, query) {
    // Double quotes wrap the query in URL, single quotes for values in query
    const url = `${rpcEndpoint}/tx_search?query="${encodeURIComponent(query)}"&prove=false`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
        console.error('Query error:', data.error.message);
        return null;
    }
    
    return data.result;
}

// Usage examples
await txSearch(rpc, "tx.height=12345");
await txSearch(rpc, "message.sender='cosmos1abc...'");
await txSearch(rpc, "message.sender='cosmos1abc...' AND message.module='bank'");
```

## Common Errors and Solutions

### Error: HTTP 500 "Internal Server Error"
**Cause**: Incorrect query syntax
**Solution**: Ensure double quotes around query in URL, single quotes for string values

### Error: "Invalid params"
**Cause**: Missing quotes or invalid characters
**Solution**: Check quote formatting and escape special characters

### Error: "Index not available"
**Cause**: Transaction indexing disabled on node
**Solution**: Use a different node with indexing enabled

### Error: No results when expected
**Possible Causes**:
1. Event not indexed by this node
2. Transaction pruned from node storage
3. Query syntax incorrect for this event type
4. Case sensitivity issues

## Testing Node Capabilities

### Check if Indexing is Enabled
```javascript
// Try a simple height query
const test = await txSearch(rpc, "tx.height=1");
if (test === null) {
    console.log("Indexing might be disabled");
}
```

### Discover Supported Events
Test various query types to see what's indexed:
```javascript
const testQueries = [
    "tx.height=12345",
    "message.sender='address'",
    "transfer.recipient='address'",
    "message.module='bank'",
    "message.action='/cosmos.bank.v1beta1.MsgSend'"
];

for (const query of testQueries) {
    const result = await txSearch(rpc, query);
    console.log(`${query}: ${result ? 'Supported' : 'Not supported'}`);
}
```

## Fetching Complete Transaction History

Since OR operator is not supported, fetch complete history with multiple queries:

```javascript
async function fetchAllTransactions(address) {
    const queries = [
        `message.sender='${address}'`,           // Sent transactions
        `transfer.recipient='${address}'`,       // Received transfers
        `coin_received.receiver='${address}'`,   // Received coins
        // Add more event types as needed
    ];
    
    const allTxs = [];
    for (const query of queries) {
        const result = await txSearch(rpc, query);
        if (result?.txs) {
            allTxs.push(...result.txs);
        }
    }
    
    // Deduplicate by hash
    const unique = [...new Map(allTxs.map(tx => [tx.hash, tx])).values()];
    return unique;
}
```

## Performance Tips

1. **Use specific queries**: More specific = faster
2. **Implement pagination**: Don't fetch all at once
3. **Add rate limiting**: Respect node limits
4. **Cache results**: Avoid repeated queries
5. **Use appropriate page size**: 30-100 per page

## Chain-Specific Notes

### Juno
- Standard Cosmos SDK events supported
- Message attributes properly indexed
- Height and hash always available

### Neutron
- Similar to Juno with standard indexing
- Supports CosmWasm contract events

### Osmosis
- Additional DEX-specific events
- Pool and swap events indexed

## Troubleshooting Checklist

1. ✅ Double quotes around entire query in URL?
2. ✅ Single quotes for string values in query?
3. ✅ URL encoding applied correctly?
4. ✅ Node has indexing enabled?
5. ✅ Event type exists on this chain?
6. ✅ Using AND operator (not OR)?
7. ✅ No invalid characters in query?

## References

- [CometBFT RPC Documentation](https://docs.cometbft.com/main/rpc/)
- [Cosmos SDK Events](https://docs.cosmos.network/main/core/events)
- [Tendermint Event Indexing](https://docs.tendermint.com/master/app-dev/indexing-transactions.html)