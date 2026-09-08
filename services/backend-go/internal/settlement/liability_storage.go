package settlement

import (
	"encoding/hex"
	"math/big"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

type LiabilityStorageDelta struct {
	Asset          string `json:"asset"`
	Role           string `json:"role"`
	Slot           string `json:"slot"`
	Delta          string `json:"delta"`
	Before         string `json:"before,omitempty"`
	After          string `json:"after,omitempty"`
	ValuesObserved bool   `json:"valuesObserved"`
}
type LiabilityStorageAccounting struct {
	Changes        []LiabilityStorageDelta `json:"changes"`
	BucketsMatched bool                    `json:"bucketsMatched"`
	TotalsMatched  bool                    `json:"totalsMatched"`
}

func liabilityStorageSlot(root, market, asset string, bucket *uint8) (string, error) {
	n, e := amount(root)
	if e != nil || !addressPattern.MatchString(asset) {
		return "", ErrIntent
	}
	base := n.FillBytes(make([]byte, 32))
	if bucket != nil {
		if *bucket > 3 || !hashPattern.MatchString(market) {
			return "", ErrIntent
		}
		key, e := hex.DecodeString(market[2:])
		if e != nil {
			return "", ErrIntent
		}
		base = crypto.Keccak256(key, base)
	}
	key, e := hex.DecodeString(asset[2:])
	if e != nil {
		return "", ErrIntent
	}
	base = crypto.Keccak256(append(make([]byte, 12), key...), base)
	if bucket != nil {
		slot := new(big.Int).SetBytes(base)
		slot.Add(slot, new(big.Int).SetUint64(uint64(*bucket)))
		slot.Mod(slot, new(big.Int).Lsh(big.NewInt(1), 256))
		base = slot.FillBytes(make([]byte, 32))
	}
	return "0x" + hex.EncodeToString(base), nil
}

// checkLiabilityDelta verifies a net change, not the absolute solvency of all
// markets. An untouched zero-delta slot may have no observed starting value.
func checkLiabilityDelta(state chainrpc.TransactionStateTrace, vault, slot string, delta *big.Int) (LiabilityStorageDelta, error) {
	fail := func() (LiabilityStorageDelta, error) { return LiabilityStorageDelta{}, ErrIntent }
	result := LiabilityStorageDelta{Slot: slot, Delta: delta.String()}
	_, observed := state.Prestate[vault].Storage[slot]
	if !observed && delta.Sign() == 0 {
		_, pre := state.Diff.Pre[vault].Storage[slot]
		_, post := state.Diff.Post[vault].Storage[slot]
		if pre || post {
			return fail()
		}
		return result, nil
	}
	a, b, e := state.StorageTransition(vault, slot)
	if e != nil {
		return fail()
	}
	before, ok := new(big.Int).SetString(a[2:], 16)
	if !ok {
		return fail()
	}
	after, ok := new(big.Int).SetString(b[2:], 16)
	if !ok {
		return fail()
	}
	expected := new(big.Int).Add(before, delta)
	if expected.Sign() < 0 || expected.BitLen() > 256 || expected.Cmp(after) != 0 {
		return fail()
	}
	result.Before = before.String()
	result.After = after.String()
	result.ValuesObserved = true
	return result, nil
}

func matchLiabilityStorage(p ConversionPreview, event ReceiptEventMatch, state chainrpc.TransactionStateTrace) (LiabilityStorageAccounting, error) {
	fail := func() (LiabilityStorageAccounting, error) { return LiabilityStorageAccounting{}, ErrIntent }
	if p.To != p.Candidate.State.FeeVault || p.Candidate.State.MemeToken == p.Candidate.State.QuoteAsset || len(event.Items) == 0 {
		return fail()
	}
	a, ok := state.Prestate[p.To]
	if !ok || a.Code == nil {
		return fail()
	}
	layout, e := verifiedFeeVaultLayout(*a.Code, p.Candidate.State.FeeVaultRuntimeCodeHash)
	if e != nil {
		return fail()
	}
	spent := [2]*big.Int{new(big.Int), new(big.Int)}
	received := [2]*big.Int{new(big.Int), new(big.Int)}
	for _, item := range event.Items {
		role := 0
		if item.CreatorEpoch == 0 {
			role = 1
		}
		s, se := amount(item.MemeSpent)
		q, qe := amount(item.QuoteReceived)
		if se != nil || qe != nil {
			return fail()
		}
		spent[role].Add(spent[role], s)
		received[role].Add(received[role], q)
	}
	totalSpent := new(big.Int).Add(spent[0], spent[1])
	totalQuote := new(big.Int).Add(received[0], received[1])
	if totalSpent.Sign() == 0 || totalQuote.Sign() == 0 || totalSpent.BitLen() > 256 || totalQuote.BitLen() > 256 || totalSpent.String() != event.MemeSpent || totalQuote.String() != event.QuoteReceived {
		return fail()
	}
	out := LiabilityStorageAccounting{Changes: []LiabilityStorageDelta{}}
	for i, asset := range []string{p.Candidate.State.MemeToken, p.Candidate.State.QuoteAsset} {
		amounts := spent
		total := new(big.Int).Neg(totalSpent)
		if i == 1 {
			amounts = received
			total = new(big.Int).Set(totalQuote)
		}
		slot, e := liabilityStorageSlot(layout.TotalSlot, "", asset, nil)
		if e != nil {
			return fail()
		}
		change, e := checkLiabilityDelta(state, p.To, slot, total)
		if e != nil {
			return fail()
		}
		change.Asset = asset
		change.Role = "all_markets_total"
		out.Changes = append(out.Changes, change)
		for bucket, role := range []string{"creator", "staker", "platform", "holder"} {
			n := new(big.Int)
			if bucket < 2 {
				n.Set(amounts[bucket])
			}
			if i == 0 {
				n.Neg(n)
			}
			b := uint8(bucket)
			slot, e := liabilityStorageSlot(layout.BucketSlot, event.MarketID, asset, &b)
			if e != nil {
				return fail()
			}
			change, e := checkLiabilityDelta(state, p.To, slot, n)
			if e != nil {
				return fail()
			}
			change.Asset = asset
			change.Role = role
			out.Changes = append(out.Changes, change)
		}
	}
	out.BucketsMatched = true
	out.TotalsMatched = true
	return out, nil
}
