-- +goose Up
ALTER TABLE tickergarden.maintenance_scan_queue ADD COLUMN user_address text NOT NULL DEFAULT '';
ALTER TABLE tickergarden.maintenance_scan_queue DROP CONSTRAINT maintenance_scan_queue_operation_check;
ALTER TABLE tickergarden.maintenance_scan_queue ADD CONSTRAINT maintenance_scan_queue_operation_check CHECK(operation IN ('sweep','checkpoint','flush-forfeiture','treasury-activate','settle-rage-quit'));
ALTER TABLE tickergarden.maintenance_scan_queue ADD CONSTRAINT maintenance_scan_user_check CHECK(
 (operation='settle-rage-quit' AND user_address ~ '^0x[0-9a-f]{40}$' AND user_address<>'0x0000000000000000000000000000000000000000') OR
 (operation<>'settle-rage-quit' AND user_address=''));
ALTER TABLE tickergarden.maintenance_scan_queue DROP CONSTRAINT maintenance_scan_queue_pkey;
ALTER TABLE tickergarden.maintenance_scan_queue ADD PRIMARY KEY(chain_id,genesis_hash,sender,market_id,operation,user_address);
-- +goose Down
DELETE FROM tickergarden.maintenance_scan_queue WHERE operation='settle-rage-quit';
ALTER TABLE tickergarden.maintenance_scan_queue DROP CONSTRAINT maintenance_scan_queue_pkey;
ALTER TABLE tickergarden.maintenance_scan_queue DROP CONSTRAINT maintenance_scan_user_check;
ALTER TABLE tickergarden.maintenance_scan_queue DROP COLUMN user_address;
ALTER TABLE tickergarden.maintenance_scan_queue DROP CONSTRAINT maintenance_scan_queue_operation_check;
ALTER TABLE tickergarden.maintenance_scan_queue ADD CONSTRAINT maintenance_scan_queue_operation_check CHECK(operation IN ('sweep','checkpoint','flush-forfeiture','treasury-activate'));
ALTER TABLE tickergarden.maintenance_scan_queue ADD PRIMARY KEY(chain_id,genesis_hash,sender,market_id,operation);
