package analytics

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/events"
)

// DecodeHolderTransfers checks both directions between complete journal receipts
// and filtered token logs. The caller must independently authenticate receipt
// completeness, canonical block coverage, and token deployment identity.
func DecodeHolderTransfers(chain uint64, token string, receipts []chainrpc.Receipt, journal []chainrpc.Log) ([]HolderTransfer, error) {
	fail := func() ([]HolderTransfer, error) { return nil, ErrHolders }
	if chain == 0 || !addressRE.MatchString(token) || token == "0x"+strings.Repeat("0", 40) || len(receipts) > 100000 || len(journal) > 100000 {
		return fail()
	}
	topic := crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)")).Hex()
	logs := map[string]chainrpc.Log{}
	txs := map[string]bool{}
	indices := map[string]uint64{}
	heights := map[string]string{}
	blockNumbers := map[string]string{}
	nextLog := map[string]uint64{}
	budget := 0
	quantity := func(s string) (uint64, bool) {
		n, e := chainrpc.Quantity(s)
		return n, e == nil && s == fmt.Sprintf("0x%x", n)
	}
	for _, r := range receipts {
		data, e := json.Marshal(r)
		budget += len(data)
		if e != nil || budget > 64<<20 {
			return fail()
		}
		_, bn := quantity(r.BlockNumber)
		index, ti := quantity(r.TransactionIndex)
		if !bn || !ti || !hashRE.MatchString(r.BlockHash) || !hashRE.MatchString(r.TransactionHash) || txs[r.TransactionHash] || index != indices[r.BlockHash] || r.Logs == nil || (r.Status != "0x0" && r.Status != "0x1") || (r.Status == "0x0" && len(r.Logs) != 0) {
			return fail()
		}
		if old, ok := heights[r.BlockNumber]; ok && old != r.BlockHash {
			return fail()
		}
		heights[r.BlockNumber] = r.BlockHash
		if old, ok := blockNumbers[r.BlockHash]; ok && old != r.BlockNumber {
			return fail()
		}
		blockNumbers[r.BlockHash] = r.BlockNumber
		indices[r.BlockHash]++
		txs[r.TransactionHash] = true
		for _, l := range r.Logs {
			li, ok := quantity(l.LogIndex)
			if !ok || l.Removed || l.BlockHash != r.BlockHash || l.BlockNumber != r.BlockNumber || l.TransactionHash != r.TransactionHash || l.TransactionIndex != r.TransactionIndex || !addressRE.MatchString(l.Address) || li != nextLog[r.BlockHash] {
				return fail()
			}
			nextLog[r.BlockHash]++
			if l.Address != token || len(l.Topics) == 0 || l.Topics[0] != topic {
				continue
			}
			key := l.BlockHash + ":" + l.LogIndex
			if _, ok := logs[key]; ok {
				return fail()
			}
			logs[key] = l
			if len(logs) > 100000 {
				return fail()
			}
		}
	}
	out := []HolderTransfer{}
	for _, l := range journal {
		data, e := json.Marshal(l)
		budget += len(data)
		if e != nil || budget > 64<<20 || l.Address != token {
			return fail()
		}
		if len(l.Topics) == 0 || l.Topics[0] != topic {
			continue
		}
		key := l.BlockHash + ":" + l.LogIndex
		expected, ok := logs[key]
		if !ok || !reflect.DeepEqual(l, expected) {
			return fail()
		}
		delete(logs, key)
		decoded, e := events.Decode("TickerMemeTokenV1", l)
		if e != nil || decoded.Signature != "Transfer(address,address,uint256)" {
			return fail()
		}
		from, a := decoded.Args["from"].(string)
		to, b := decoded.Args["to"].(string)
		value, c := decoded.Args["value"].(string)
		if !a || !b || !c {
			return fail()
		}
		block, _ := quantity(l.BlockNumber)
		tx, _ := quantity(l.TransactionIndex)
		li, _ := quantity(l.LogIndex)
		out = append(out, HolderTransfer{Source: CurveSource{ChainID: chain, BlockNumber: strconv.FormatUint(block, 10), BlockHash: l.BlockHash, TransactionHash: l.TransactionHash, TransactionIndex: tx, LogIndex: li, Emitter: token, EventKey: fmt.Sprintf("%d:%s:%d", chain, l.TransactionHash, li)}, From: from, To: to, Value: value})
	}
	if len(logs) != 0 {
		return fail()
	}
	return out, nil
}
