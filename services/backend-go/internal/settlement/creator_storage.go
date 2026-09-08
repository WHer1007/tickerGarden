package settlement

import (
	"bytes"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

//go:embed feevault_storage.json
var feeVaultStorageJSON []byte

type feeVaultLayout struct {
	CreatorSlot string `json:"creatorSlot"`
	BucketSlot  string `json:"bucketSlot"`
	TotalSlot   string `json:"totalSlot"`
	Runtime     string `json:"runtime"`
	Immutables  []struct {
		Start  int `json:"start"`
		Length int `json:"length"`
	} `json:"immutables"`
}

// The template identifies the compiler layout, while expectedHash separately
// authenticates ALL deployed bytes, including constructor-patched immutables.
func verifiedFeeVaultLayout(code, expectedHash string) (feeVaultLayout, error) {
	var layout feeVaultLayout
	fail := func() (feeVaultLayout, error) { return feeVaultLayout{}, ErrIntent }
	if json.Unmarshal(feeVaultStorageJSON, &layout) != nil || !strings.HasPrefix(code, "0x") {
		return fail()
	}
	actual, err := hex.DecodeString(code[2:])
	if err != nil || len(actual) == 0 || crypto.Keccak256Hash(actual).Hex() != expectedHash {
		return fail()
	}
	template, err := hex.DecodeString(strings.TrimPrefix(layout.Runtime, "0x"))
	if err != nil || len(template) != len(actual) {
		return fail()
	}
	end := 0
	for _, r := range layout.Immutables {
		if r.Start < end || r.Length != 32 || r.Start+r.Length > len(actual) {
			return fail()
		}
		for i := r.Start; i < r.Start+r.Length; i++ {
			if template[i] != 0 {
				return fail()
			}
			actual[i] = 0
		}
		end = r.Start + r.Length
	}
	if !bytes.Equal(actual, template) {
		return fail()
	}
	if _, err := amount(layout.CreatorSlot); err != nil {
		return fail()
	}
	return layout, nil
}

func creatorLiabilitySlot(layout feeVaultLayout, market string, epoch uint32, asset string) (string, error) {
	if len(market) != 66 || !strings.HasPrefix(market, "0x") || !addressPattern.MatchString(asset) || epoch == 0 {
		return "", ErrIntent
	}
	marketBytes, err := hex.DecodeString(market[2:])
	if err != nil {
		return "", ErrIntent
	}
	slot, err := amount(layout.CreatorSlot)
	if err != nil {
		return "", ErrIntent
	}
	base := crypto.Keccak256(marketBytes, slot.FillBytes(make([]byte, 32)))
	base = crypto.Keccak256(new(big.Int).SetUint64(uint64(epoch)).FillBytes(make([]byte, 32)), base)
	addr, err := hex.DecodeString(asset[2:])
	if err != nil {
		return "", ErrIntent
	}
	return crypto.Keccak256Hash(append(make([]byte, 12), addr...), base).Hex(), nil
}

type CreatorStorageItem struct {
	User          string `json:"user"`
	CreatorEpoch  uint32 `json:"creatorEpoch"`
	PulledMeme    string `json:"pulledMeme"`
	MemeSpent     string `json:"memeSpent"`
	MemeRefund    string `json:"memeRefund"`
	QuoteReceived string `json:"quoteReceived"`
	MemeBefore    string `json:"memeBefore"`
	MemeAfter     string `json:"memeAfter"`
	QuoteBefore   string `json:"quoteBefore,omitempty"`
	QuoteAfter    string `json:"quoteAfter,omitempty"`
}
type CreatorStorageAccounting struct {
	Items                     []CreatorStorageItem `json:"items"`
	AllInputsObserved         bool                 `json:"allInputsObserved"`
	AllocationFormulaMatched  bool                 `json:"allocationFormulaMatched"`
	CreatorLiabilitiesMatched bool                 `json:"creatorLiabilitiesMatched"`
}

func matchCreatorStorage(p ConversionPreview, event ReceiptEventMatch, calls TraceAccounting, state chainrpc.TransactionStateTrace) (CreatorStorageAccounting, error) {
	fail := func() (CreatorStorageAccounting, error) { return CreatorStorageAccounting{}, ErrIntent }
	if len(event.Items) == 0 || p.Candidate.State.FeeVault != p.To || p.Candidate.State.MemeToken == p.Candidate.State.QuoteAsset {
		return fail()
	}
	account, ok := state.Prestate[p.To]
	if !ok || account.Code == nil {
		return fail()
	}
	layout, err := verifiedFeeVaultLayout(*account.Code, p.Candidate.State.FeeVaultRuntimeCodeHash)
	if err != nil {
		return fail()
	}
	out := CreatorStorageAccounting{Items: []CreatorStorageItem{}}
	pulls := make([]*big.Int, 0, len(event.Items))
	staker := 0
	epochs := map[uint32]bool{}
	total := new(big.Int)
	for _, item := range event.Items {
		if item.CreatorEpoch == 0 {
			if staker >= len(calls.GaugeItems) || calls.GaugeItems[staker].User != item.User {
				return fail()
			}
			n, e := amount(calls.GaugeItems[staker].PulledMeme)
			if e != nil {
				return fail()
			}
			staker++
			pulls = append(pulls, n)
			total.Add(total, n)
			continue
		}
		if epochs[item.CreatorEpoch] {
			return fail()
		}
		epochs[item.CreatorEpoch] = true
		transition := func(asset string) (*big.Int, *big.Int, error) {
			slot, e := creatorLiabilitySlot(layout, event.MarketID, item.CreatorEpoch, asset)
			if e != nil {
				return nil, nil, e
			}
			a, b, e := state.StorageTransition(p.To, slot)
			if e != nil {
				return nil, nil, e
			}
			before, ok := new(big.Int).SetString(a[2:], 16)
			if !ok {
				return nil, nil, ErrIntent
			}
			after, ok := new(big.Int).SetString(b[2:], 16)
			if !ok {
				return nil, nil, ErrIntent
			}
			return before, after, nil
		}
		before, after, e := transition(p.Candidate.State.MemeToken)
		if e != nil {
			return fail()
		}
		max, me := amount(item.MaximumMeme)
		spent, se := amount(item.MemeSpent)
		quote, qe := amount(item.QuoteReceived)
		if me != nil || se != nil || qe != nil {
			return fail()
		}
		pull := new(big.Int).Set(before)
		if pull.Cmp(max) > 0 {
			pull.Set(max)
		}
		if pull.Sign() == 0 || pull.Cmp(spent) < 0 || new(big.Int).Sub(before, spent).Cmp(after) != 0 {
			return fail()
		}
		result := CreatorStorageItem{User: item.User, CreatorEpoch: item.CreatorEpoch, PulledMeme: pull.String(), MemeSpent: spent.String(), MemeRefund: new(big.Int).Sub(pull, spent).String(), QuoteReceived: quote.String(), MemeBefore: before.String(), MemeAfter: after.String()}
		if quote.Sign() > 0 {
			qb, qa, e := transition(p.Candidate.State.QuoteAsset)
			if e != nil || new(big.Int).Add(qb, quote).Cmp(qa) != 0 {
				return fail()
			}
			result.QuoteBefore = qb.String()
			result.QuoteAfter = qa.String()
		} else {
			// A zero-output item need not access its Quote slot at all. Do not
			// fabricate a zero balance, but reject any reported change to it.
			qslot, e := creatorLiabilitySlot(layout, event.MarketID, item.CreatorEpoch, p.Candidate.State.QuoteAsset)
			if e != nil {
				return fail()
			}
			_, preSeen := state.Diff.Pre[p.To].Storage[qslot]
			_, postSeen := state.Diff.Post[p.To].Storage[qslot]
			if preSeen || postSeen {
				qb, qa, e := transition(p.Candidate.State.QuoteAsset)
				if e != nil || qb.Cmp(qa) != 0 {
					return fail()
				}
			}
		}
		out.Items = append(out.Items, result)
		pulls = append(pulls, pull)
		total.Add(total, pull)
	}
	if staker != len(calls.GaugeItems) || total.String() != calls.HookRequestedMeme || total.Sign() == 0 {
		return fail()
	}
	spent, e := amount(event.MemeSpent)
	quote, qe := amount(event.QuoteReceived)
	if e != nil || qe != nil || spent.Sign() == 0 || spent.Cmp(total) > 0 {
		return fail()
	}
	cumulative, previousSpent, previousQuote := new(big.Int), new(big.Int), new(big.Int)
	for i, pull := range pulls {
		cumulative.Add(cumulative, pull)
		used := new(big.Int).Div(new(big.Int).Mul(cumulative, spent), total)
		received := new(big.Int).Div(new(big.Int).Mul(used, quote), spent)
		if new(big.Int).Sub(used, previousSpent).String() != event.Items[i].MemeSpent || new(big.Int).Sub(received, previousQuote).String() != event.Items[i].QuoteReceived {
			return fail()
		}
		previousSpent, previousQuote = used, received
	}
	out.AllInputsObserved = true
	out.AllocationFormulaMatched = true
	out.CreatorLiabilitiesMatched = len(out.Items) > 0
	return out, nil
}
