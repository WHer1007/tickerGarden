-- Run in Dune only after selecting the actual schema from Data Explorer.
-- `robinhood` below is the announced network slug, NOT proof of chain 46630.
-- Compare a RECENT known testnet block number + hash and transaction hash
-- against the testnet RPC/explorer. Numbers alone can overlap across networks.
-- Replace all placeholders; an empty result means unverified coverage.
SELECT number, hash, time
FROM robinhood.blocks
WHERE number = CAST('{{known_testnet_block_number}}' AS bigint)
  AND hash = from_hex(replace('{{known_testnet_block_hash}}', '0x', ''));

-- Run separately:
-- SELECT block_number, block_hash, tx_hash, contract_address, topic0, data
-- FROM robinhood.logs
-- WHERE tx_hash = from_hex(replace('{{known_testnet_transaction_hash}}','0x',''));
-- If not matched, ask Dune to identify the testnet schema or use uploaded data.
-- Do not change the application chainId to make an unrelated result pass.
