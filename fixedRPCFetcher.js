import fetch from 'node-fetch';
import { setTimeout } from 'timers/promises';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const RPC_ENDPOINT = process.env.RPC_ENDPOINT || 'https://rpc.juno.basementnodes.ca';
const REST_ENDPOINT = process.env.REST_ENDPOINT || 'https://api.juno.basementnodes.ca';

/**
 * Fixed RPC Transaction Fetcher with proper query syntax
 * Based on Cosmos SDK and CometBFT/Tendermint documentation
 */
class FixedRPCTransactionFetcher {
    constructor(rpcEndpoint = RPC_ENDPOINT) {
        this.rpcEndpoint = rpcEndpoint.replace(/\/$/, '');
        this.txCache = new Map();
    }

    /**
     * Check if the node has transaction indexing enabled
     */
    async checkIndexingStatus() {
        console.log('Checking node indexing status...');
        
        try {
            // First check node status
            const statusUrl = `${this.rpcEndpoint}/status`;
            const statusResponse = await fetch(statusUrl);
            const statusData = await statusResponse.json();
            
            console.log(`✅ Node is running: ${statusData.result.node_info.network}`);
            console.log(`   Latest block: ${statusData.result.sync_info.latest_block_height}`);
            
            // Try a simple query to test if indexing is enabled
            // Query for the most recent block's transactions
            const height = statusData.result.sync_info.latest_block_height;
            const testQuery = `tx.height=${height}`;
            
            const testUrl = `${this.rpcEndpoint}/tx_search?query="${testQuery}"&prove=false&page=1&per_page=1`;
            const testResponse = await fetch(testUrl);
            const testData = await testResponse.json();
            
            if (testData.error) {
                if (testData.error.message && testData.error.message.includes('not available')) {
                    console.log('❌ Transaction indexing is DISABLED on this node');
                    console.log('   The node operator needs to enable indexing in config.toml');
                    return false;
                } else {
                    console.log('⚠️  Indexing status uncertain:', testData.error.message);
                }
            } else if (testData.result) {
                console.log('✅ Transaction indexing is ENABLED');
                return true;
            }
            
        } catch (error) {
            console.log('❌ Error checking indexing status:', error.message);
        }
        
        return null;
    }

    /**
     * Build proper query string with correct escaping
     * CometBFT/Tendermint requires specific query format
     */
    buildQuery(conditions) {
        // Join conditions with AND (OR is not supported)
        return conditions.join(' AND ');
    }

    /**
     * Execute tx_search query with proper formatting
     */
    async txSearch(query, page = 1, perPage = 30, orderBy = 'desc') {
        try {
            // The query should be double-quote wrapped in the URL
            // Individual string values in the query use single quotes
            const url = `${this.rpcEndpoint}/tx_search?query="${encodeURIComponent(query)}"&prove=false&page=${page}&per_page=${perPage}&order_by="${orderBy}"`;
            
            console.log(`Executing query: ${query}`);
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.error) {
                console.error(`Query error: ${data.error.message}`);
                if (data.error.data) {
                    console.error(`Details: ${data.error.data}`);
                }
                return null;
            }
            
            if (data.result) {
                const txCount = data.result.txs ? data.result.txs.length : 0;
                const totalCount = data.result.total_count || '0';
                console.log(`  Found ${txCount} transactions (Total: ${totalCount})`);
                return data.result;
            }
            
            return null;
        } catch (error) {
            console.error(`Network error: ${error.message}`);
            return null;
        }
    }

    /**
     * Test various query types to understand what the node supports
     */
    async testQueryTypes(address) {
        console.log('\n🔍 Testing various query types...\n');
        
        const testQueries = [
            {
                name: 'Transaction by height (always indexed)',
                query: 'tx.height=29228343',
                description: 'Should always work if indexing is enabled'
            },
            {
                name: 'Message sender (standard event)',
                query: `message.sender='${address}'`,
                description: 'Standard message attribute, usually indexed'
            },
            {
                name: 'Transfer recipient',
                query: `transfer.recipient='${address}'`,
                description: 'Bank module transfer event'
            },
            {
                name: 'Message action type',
                query: "message.action='/cosmos.bank.v1beta1.MsgSend'",
                description: 'Filter by message type'
            },
            {
                name: 'Message module',
                query: "message.module='bank'",
                description: 'Filter by module'
            },
            {
                name: 'Combined query',
                query: `message.sender='${address}' AND message.module='bank'`,
                description: 'Multiple conditions with AND'
            },
            {
                name: 'Height range',
                query: 'tx.height>=29228340 AND tx.height<=29228350',
                description: 'Query a range of blocks'
            }
        ];
        
        const results = {};
        
        for (const test of testQueries) {
            console.log(`Testing: ${test.name}`);
            console.log(`  Query: ${test.query}`);
            console.log(`  ${test.description}`);
            
            const result = await this.txSearch(test.query, 1, 1);
            
            if (result) {
                results[test.name] = {
                    success: true,
                    totalCount: result.total_count,
                    query: test.query
                };
                console.log(`  ✅ Success! Found ${result.total_count} transactions\n`);
            } else {
                results[test.name] = {
                    success: false,
                    query: test.query
                };
                console.log(`  ❌ Failed\n`);
            }
            
            await setTimeout(500); // Rate limiting
        }
        
        return results;
    }

    /**
     * Fetch all transactions for a wallet with working queries
     */
    async fetchWalletTransactions(address) {
        console.log('\n📊 Fetching wallet transactions...\n');
        
        const transactions = [];
        const queries = [
            `message.sender='${address}'`,
            `transfer.recipient='${address}'`,
            `coin_received.receiver='${address}'`
        ];
        
        for (const query of queries) {
            console.log(`\nQuery: ${query}`);
            
            let page = 1;
            let hasMore = true;
            
            while (hasMore) {
                const result = await this.txSearch(query, page, 100);
                
                if (result && result.txs && result.txs.length > 0) {
                    transactions.push(...result.txs);
                    
                    const totalPages = Math.ceil(parseInt(result.total_count) / 100);
                    console.log(`  Page ${page}/${totalPages}: Retrieved ${result.txs.length} transactions`);
                    
                    hasMore = result.txs.length === 100 && page < totalPages;
                    page++;
                    
                    if (hasMore) {
                        await setTimeout(200); // Rate limiting
                    }
                } else {
                    hasMore = false;
                }
            }
        }
        
        // Deduplicate by hash
        const uniqueTxs = this.deduplicateTransactions(transactions);
        console.log(`\n✅ Total unique transactions found: ${uniqueTxs.length}`);
        
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
     * Parse transaction details
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
        
        // Parse tx data
        if (tx.tx) {
            try {
                let txData;
                if (typeof tx.tx === 'string') {
                    // Base64 encoded
                    const decoded = Buffer.from(tx.tx, 'base64').toString();
                    try {
                        txData = JSON.parse(decoded);
                    } catch {
                        // Some formats may differ
                        txData = tx.tx;
                    }
                } else {
                    txData = tx.tx;
                }
                
                if (txData.body) {
                    parsed.messages = txData.body.messages || [];
                    parsed.memo = txData.body.memo || '';
                }
                
                if (txData.auth_info?.fee) {
                    parsed.fee = txData.auth_info.fee;
                }
            } catch (error) {
                console.error('Error parsing tx data:', error.message);
            }
        }
        
        // Parse result
        const result = tx.tx_result || tx.result || {};
        parsed.events = result.events || [];
        parsed.code = result.code || 0;
        parsed.success = parsed.code === 0;
        
        // Decode base64 event attributes if needed
        parsed.events = parsed.events.map(event => {
            if (event.attributes && Array.isArray(event.attributes)) {
                event.attributes = event.attributes.map(attr => {
                    if (attr.key && typeof attr.key === 'string' && !attr.key.includes(' ')) {
                        try {
                            const decodedKey = Buffer.from(attr.key, 'base64').toString();
                            const decodedValue = attr.value ? Buffer.from(attr.value, 'base64').toString() : '';
                            
                            // Check if decoding produced valid strings
                            if (decodedKey && decodedKey.match(/^[\x20-\x7E]+$/)) {
                                return {
                                    key: decodedKey,
                                    value: decodedValue,
                                    index: attr.index
                                };
                            }
                        } catch {
                            // Keep original if decoding fails
                        }
                    }
                    return attr;
                });
            }
            return event;
        });
        
        return parsed;
    }
}

// Main execution
async function main() {
    const fetcher = new FixedRPCTransactionFetcher();
    const walletAddress = 'juno1wev8ptzj27aueu04wgvvl4gvurax6rj5la09yj';
    
    console.log('=================================');
    console.log('Fixed RPC Transaction Fetcher');
    console.log('=================================');
    console.log(`RPC Endpoint: ${fetcher.rpcEndpoint}`);
    console.log(`Wallet: ${walletAddress}\n`);
    
    // Step 1: Check indexing status
    const indexingEnabled = await fetcher.checkIndexingStatus();
    
    if (indexingEnabled === false) {
        console.log('\n⚠️  Cannot proceed: Transaction indexing is disabled on this node.');
        console.log('Please use a different node with indexing enabled.');
        return;
    }
    
    // Step 2: Test various query types
    const testResults = await fetcher.testQueryTypes(walletAddress);
    
    // Step 3: Generate summary
    const workingQueries = Object.entries(testResults)
        .filter(([_, result]) => result.success)
        .map(([name, _]) => name);
    
    console.log('\n📋 Query Support Summary:');
    console.log(`  Working queries: ${workingQueries.length}/${Object.keys(testResults).length}`);
    
    if (workingQueries.length > 0) {
        console.log('\n  ✅ Supported query types:');
        workingQueries.forEach(name => console.log(`     - ${name}`));
    }
    
    const failedQueries = Object.entries(testResults)
        .filter(([_, result]) => !result.success)
        .map(([name, _]) => name);
    
    if (failedQueries.length > 0) {
        console.log('\n  ❌ Unsupported/Failed queries:');
        failedQueries.forEach(name => console.log(`     - ${name}`));
    }
    
    // Step 4: Fetch wallet transactions if possible
    if (workingQueries.length > 0) {
        const transactions = await fetcher.fetchWalletTransactions(walletAddress);
        
        if (transactions.length > 0) {
            // Parse and save results
            const parsedTxs = transactions.map(tx => fetcher.parseTransaction(tx));
            
            const output = {
                fetcher: 'Fixed RPC Implementation',
                endpoint: fetcher.rpcEndpoint,
                wallet: walletAddress,
                timestamp: new Date().toISOString(),
                query_test_results: testResults,
                transaction_count: transactions.length,
                transactions: parsedTxs.slice(0, 10) // Save first 10 for review
            };
            
            fs.writeFileSync(
                'rpc_fetch_results.json',
                JSON.stringify(output, null, 2)
            );
            
            console.log('\n✅ Results saved to rpc_fetch_results.json');
        }
    }
    
    // Step 5: Provide usage examples
    console.log('\n📚 Usage Examples for this node:');
    console.log('\n// Example 1: Query by transaction height');
    console.log(`curl "${fetcher.rpcEndpoint}/tx_search?query=\\"tx.height=29228343\\"&prove=false"`);
    
    if (testResults['Message sender']?.success) {
        console.log('\n// Example 2: Query by message sender');
        console.log(`curl "${fetcher.rpcEndpoint}/tx_search?query=\\"message.sender='${walletAddress}'\\"&prove=false"`);
    }
    
    console.log('\n// Example 3: Query with Node.js/fetch');
    console.log(`const query = "tx.height=29228343";`);
    console.log(`const url = \`\${rpcEndpoint}/tx_search?query="\${encodeURIComponent(query)}"&prove=false\`;`);
    console.log(`const response = await fetch(url);`);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { FixedRPCTransactionFetcher };