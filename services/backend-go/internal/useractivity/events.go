// Package useractivity derives address-referenced activity from protocol events.
// Callers must authenticate emitter/module bindings and canonical receipt history;
// event roles do not prove a wallet signed or initiated the transaction.
package useractivity

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
)

var ErrEvidence = errors.New("invalid user activity evidence")

// Record identifies one address's roles in one event, not one transaction or
// one economic execution. Related events must not be summed as trading volume.
type Record struct {
	ID               string         `json:"id"`
	ChainID          uint64         `json:"chainId"`
	Account          string         `json:"account"`
	Roles            []string       `json:"roles"`
	IdentityBasis    string         `json:"identityBasis"`
	Module           string         `json:"module"`
	Signature        string         `json:"signature"`
	Emitter          string         `json:"emitter"`
	BlockNumber      string         `json:"blockNumber"`
	BlockHash        string         `json:"blockHash"`
	TransactionHash  string         `json:"transactionHash"`
	TransactionIndex string         `json:"transactionIndex"`
	LogIndex         string         `json:"logIndex"`
	Arguments        map[string]any `json:"arguments"`
}

// Explicit event roles exclude token/module addresses and configuration updates.
// No sender is elevated to an ultimate wallet, even when it happens to be an EOA.
var participantFields = map[string][]string{
	"AllocationLocked": {"user"}, "AllocationReleased": {"user"},
	"AllocationRageQuit": {"user"}, "AllocationRageQuitExecuted": {"user"},
	"Approval": {"owner", "spender"}, "Transfer": {"from", "to"},
	"CurveBuy": {"buyer", "recipient"}, "CurveSell": {"seller", "recipient"},
	"CurveBuyRefunded": {"buyer"}, "Swap": {"sender"}, "Donate": {"sender"},
	"FeeClaimed": {"beneficiary"}, "ForfeitureRecordDeferred": {"user"},
	"ForfeitureReserved": {"user"}, "GaugeRageQuit": {"user"},
	"MemeTreasuryBurned": {"funder"}, "QuoteTreasuryFunded": {"funder"},
	"PendingMaterialized": {"user"}, "PendingRescheduled": {"user"}, "PendingScheduled": {"user"},
	"RageQuitRewardSettlementCompleted": {"user"}, "RageQuitRewardSettlementDeferred": {"user"},
	"RageQuitRewardSettlementFinalized": {"user"}, "RageQuitRewardSettlementQueued": {"user"},
	"RawRewardExitCancelled": {"user"}, "RawRewardExitRequested": {"user"}, "RewardConverted": {"user"},
	"RootRequestExpired": {"requester"}, "RootRequested": {"requester"},
	"ServiceCreditWithdrawn": {"beneficiary"}, "StockDeposited": {"user"},
	"StockWithdrawn": {"user"}, "TreasuryClaimed": {"account"},
}

// FromEvent requires the exact persisted log to occur in a successful receipt.
// The module binding must already be authenticated through deployment/discovery.
// It makes no claims about current canonicality/finality or history completeness.
func FromEvent(chain uint64, module string, log chainrpc.Log, receipt *chainrpc.Receipt) ([]Record, error) {
	if chain != 4663 && chain != 46630 && chain != 421614 {
		return nil, ErrEvidence
	}
	if receipt == nil || len(receipt.Logs) > 16384 || chainrpc.ValidateTransactionReceipt(log.TransactionHash, receipt) != nil || receipt.Status != "0x1" {
		return nil, ErrEvidence
	}
	found := false
	for _, candidate := range receipt.Logs {
		if reflect.DeepEqual(candidate, log) {
			found = true
			break
		}
	}
	if !found {
		return nil, ErrEvidence
	}
	decoded, err := events.Decode(module, log)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrEvidence, err)
	}
	return recordsFromDecoded(chain, log, decoded)
}

func recordsFromDecoded(chain uint64, log chainrpc.Log, decoded events.Decoded) ([]Record, error) {
	fields := participantFields[strings.SplitN(decoded.Signature, "(", 2)[0]]
	byAccount := map[string][]string{}
	for _, field := range fields {
		account, ok := decoded.Args[field].(string)
		if !ok || len(account) != 42 || !strings.HasPrefix(account, "0x") {
			return nil, ErrEvidence
		}
		if account == "0x"+strings.Repeat("0", 40) {
			continue
		} // mint/burn sentinel, not a user
		byAccount[account] = append(byAccount[account], field)
	}
	accounts := make([]string, 0, len(byAccount))
	for account := range byAccount {
		accounts = append(accounts, account)
	}
	sort.Strings(accounts)
	block, _ := chainrpc.Quantity(log.BlockNumber)
	index, _ := chainrpc.Quantity(log.TransactionIndex)
	li, _ := chainrpc.Quantity(log.LogIndex)
	records := make([]Record, 0, len(accounts))
	for _, account := range accounts {
		roles := byAccount[account]
		sort.Strings(roles)
		args := make(map[string]any, len(decoded.Args))
		for key, value := range decoded.Args {
			args[key] = value
		}
		records = append(records, Record{
			ID:      fmt.Sprintf("%d:%s:%s:%d:%s", chain, strings.ToLower(log.BlockHash), strings.ToLower(log.TransactionHash), li, account),
			ChainID: chain, Account: account, Roles: roles, IdentityBasis: "event_address_reference_not_verified_initiator",
			Module: decoded.Module, Signature: decoded.Signature, Emitter: decoded.Emitter,
			BlockNumber: strconv.FormatUint(block, 10), BlockHash: strings.ToLower(log.BlockHash),
			TransactionHash: strings.ToLower(log.TransactionHash), TransactionIndex: strconv.FormatUint(index, 10),
			LogIndex: strconv.FormatUint(li, 10), Arguments: args,
		})
	}
	return records, nil
}

// FromVerifiedReceipt is the production extraction entry point. The deployment
// verifier binds emitters to runtime code and this exact chain/block. One receipt
// is checked once, so extraction is linear in its log count. Finalized canonical
// membership and complete-history coverage still belong to the index reader.
func FromVerifiedReceipt(ctx context.Context, chain uint64, verified deployment.Verified, receipt *chainrpc.Receipt) ([]Record, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if chain != 4663 && chain != 46630 && chain != 421614 {
		return nil, ErrEvidence
	}
	if receipt == nil || len(receipt.Logs) > 16384 || chainrpc.ValidateTransactionReceipt(receipt.TransactionHash, receipt) != nil {
		return nil, ErrEvidence
	}
	if verified.CheckScope(chain, receipt.BlockHash) != nil {
		return nil, ErrEvidence
	}
	result := []Record{}
	for _, log := range receipt.Logs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		decoded, err := verified.Decode(chain, log)
		if errors.Is(err, events.ErrUnknown) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrEvidence, err)
		}
		records, err := recordsFromDecoded(chain, log, decoded)
		if err != nil {
			return nil, err
		}
		result = append(result, records...)
	}
	return result, nil
}
