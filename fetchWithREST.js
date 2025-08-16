import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const REST_ENDPOINT = process.env.REST_ENDPOINT || 'https://api.juno.basementnodes.ca';

/**
 * Fetcher that uses REST API instead of RPC
 */
class RESTTransactionFetcher {
    constructor(restEndpoint = REST_ENDPOINT) {
        this.restEndpoint = restEndpoint.replace(/\/$/, '');
    }
    
    /**
     * Fetch transaction by hash using REST API
     */
    async fetchTransactionByHash(txHash) {
        const url = `${this.restEndpoint}/cosmos/tx/v1beta1/txs/${txHash}`;
        console.log(`Fetching transaction: ${txHash}`);
        
        try {
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.tx_response) {
                return data.tx_response;
            } else if (data.tx) {
                return data.tx;
            }
            
            console.log('Transaction not found or unexpected format');
            return null;
        } catch (error) {
            console.error('Error fetching transaction:', error.message);
            return null;
        }
    }
    
    /**
     * Parse transaction to extract relevant details
     */
    parseTransaction(tx) {
        const result = {
            hash: tx.txhash || tx.hash,
            height: tx.height,
            timestamp: tx.timestamp,
            code: tx.code || 0,
            success: (tx.code || 0) === 0,
            gas_used: tx.gas_used,
            gas_wanted: tx.gas_wanted,
            fee: null,
            memo: '',
            messages: [],
            events: tx.events || [],
            logs: tx.logs || []
        };
        
        // Extract transaction body details
        if (tx.tx && tx.tx.body) {
            result.messages = tx.tx.body.messages || [];
            result.memo = tx.tx.body.memo || '';
        }
        
        // Extract fee
        if (tx.tx && tx.tx.auth_info && tx.tx.auth_info.fee) {
            result.fee = tx.tx.auth_info.fee;
        }
        
        return result;
    }
    
    /**
     * Analyze transaction to find wallet involvement
     */
    analyzeWalletInvolvement(tx, walletAddress) {
        const parsed = this.parseTransaction(tx);
        const involvement = {
            isInvolved: false,
            roles: [],
            transfers: []
        };
        
        // Check messages
        for (const msg of parsed.messages) {
            const msgType = msg['@type'] || msg.type || '';
            
            // IBC Transfer
            if (msgType.includes('MsgTransfer')) {
                if (msg.sender === walletAddress) {
                    involvement.isInvolved = true;
                    involvement.roles.push('ibc_sender');
                    involvement.transfers.push({
                        type: 'ibc_send',
                        from: msg.sender,
                        to: msg.receiver || 'ibc_destination',
                        amount: msg.token,
                        channel: msg.source_channel
                    });
                }
                if (msg.receiver === walletAddress) {
                    involvement.isInvolved = true;
                    involvement.roles.push('ibc_receiver');
                }
            }
            
            // Bank Send
            if (msgType.includes('MsgSend')) {
                if (msg.from_address === walletAddress) {
                    involvement.isInvolved = true;
                    involvement.roles.push('sender');
                    involvement.transfers.push({
                        type: 'send',
                        from: msg.from_address,
                        to: msg.to_address,
                        amount: msg.amount
                    });
                }
                if (msg.to_address === walletAddress) {
                    involvement.isInvolved = true;
                    involvement.roles.push('receiver');
                    involvement.transfers.push({
                        type: 'receive',
                        from: msg.from_address,
                        to: msg.to_address,
                        amount: msg.amount
                    });
                }
            }
            
            // Staking
            if (msgType.includes('MsgDelegate')) {
                if (msg.delegator_address === walletAddress) {
                    involvement.isInvolved = true;
                    involvement.roles.push('delegator');
                }
            }
        }
        
        // Check events
        for (const event of parsed.events) {
            if (event.type === 'transfer' && event.attributes) {
                for (const attr of event.attributes) {
                    if (attr.key === 'sender' && attr.value === walletAddress) {
                        involvement.isInvolved = true;
                        if (!involvement.roles.includes('event_sender')) {
                            involvement.roles.push('event_sender');
                        }
                    }
                    if (attr.key === 'recipient' && attr.value === walletAddress) {
                        involvement.isInvolved = true;
                        if (!involvement.roles.includes('event_recipient')) {
                            involvement.roles.push('event_recipient');
                        }
                    }
                }
            }
        }
        
        return involvement;
    }
    
    /**
     * Generate a summary report
     */
    generateReport(transactions, walletAddress) {
        const report = {
            wallet: walletAddress,
            transactions_analyzed: transactions.length,
            involved_transactions: [],
            summary: {
                total_involved: 0,
                as_sender: 0,
                as_receiver: 0,
                ibc_transfers: 0,
                delegations: 0
            }
        };
        
        for (const tx of transactions) {
            const involvement = this.analyzeWalletInvolvement(tx, walletAddress);
            
            if (involvement.isInvolved) {
                report.summary.total_involved++;
                
                if (involvement.roles.includes('sender') || involvement.roles.includes('ibc_sender')) {
                    report.summary.as_sender++;
                }
                if (involvement.roles.includes('receiver') || involvement.roles.includes('ibc_receiver')) {
                    report.summary.as_receiver++;
                }
                if (involvement.roles.includes('ibc_sender') || involvement.roles.includes('ibc_receiver')) {
                    report.summary.ibc_transfers++;
                }
                if (involvement.roles.includes('delegator')) {
                    report.summary.delegations++;
                }
                
                const parsed = this.parseTransaction(tx);
                report.involved_transactions.push({
                    hash: parsed.hash,
                    height: parsed.height,
                    timestamp: parsed.timestamp,
                    success: parsed.success,
                    roles: involvement.roles,
                    transfers: involvement.transfers,
                    message_types: parsed.messages.map(m => m['@type'] || m.type),
                    memo: parsed.memo
                });
            }
        }
        
        return report;
    }
}

// Main execution
async function main() {
    const fetcher = new RESTTransactionFetcher();
    const walletAddress = 'juno1wev8ptzj27aueu04wgvvl4gvurax6rj5la09yj';
    const knownTxHash = '9198BDEA91313F47CDBC843A4BE9A4EEE93E413E902875AF5FC7B048B176E922';
    
    console.log('Cosmos Transaction Fetcher - REST API Version\n');
    console.log(`Wallet Address: ${walletAddress}`);
    console.log(`REST Endpoint: ${fetcher.restEndpoint}\n`);
    
    // Fetch the known transaction
    console.log('Fetching known transaction...');
    const tx = await fetcher.fetchTransactionByHash(knownTxHash);
    
    if (tx) {
        console.log('✅ Transaction fetched successfully!\n');
        
        // Parse and analyze
        const parsed = fetcher.parseTransaction(tx);
        console.log('Transaction Details:');
        console.log(`  Hash: ${parsed.hash}`);
        console.log(`  Height: ${parsed.height}`);
        console.log(`  Success: ${parsed.success}`);
        console.log(`  Gas: ${parsed.gas_used}/${parsed.gas_wanted}`);
        console.log(`  Messages: ${parsed.messages.length}`);
        console.log(`  Events: ${parsed.events.length}`);
        
        if (parsed.messages.length > 0) {
            console.log('\nMessage Types:');
            parsed.messages.forEach((msg, i) => {
                console.log(`  ${i + 1}. ${msg['@type'] || msg.type}`);
            });
        }
        
        // Check wallet involvement
        console.log('\nWallet Analysis:');
        const involvement = fetcher.analyzeWalletInvolvement(tx, walletAddress);
        console.log(`  Is wallet involved? ${involvement.isInvolved ? '✅ YES' : '❌ NO'}`);
        
        if (involvement.isInvolved) {
            console.log(`  Roles: ${involvement.roles.join(', ')}`);
            
            if (involvement.transfers.length > 0) {
                console.log('\n  Transfers:');
                involvement.transfers.forEach(transfer => {
                    console.log(`    - Type: ${transfer.type}`);
                    console.log(`      From: ${transfer.from}`);
                    console.log(`      To: ${transfer.to}`);
                    if (transfer.amount) {
                        console.log(`      Amount: ${JSON.stringify(transfer.amount)}`);
                    }
                    if (transfer.channel) {
                        console.log(`      Channel: ${transfer.channel}`);
                    }
                });
            }
        }
        
        // Generate report
        const report = fetcher.generateReport([tx], walletAddress);
        
        // Save to file
        const output = {
            fetcher_type: 'REST_API',
            endpoint: fetcher.restEndpoint,
            timestamp: new Date().toISOString(),
            report: report,
            raw_transaction: parsed
        };
        
        fs.writeFileSync(
            'transaction_analysis.json',
            JSON.stringify(output, null, 2)
        );
        
        console.log('\n✅ Analysis complete! Results saved to transaction_analysis.json');
        
    } else {
        console.log('❌ Failed to fetch transaction');
    }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export { RESTTransactionFetcher };