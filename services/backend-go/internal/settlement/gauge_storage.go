package settlement

import (
	"bytes"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"math/big"
	"reflect"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"
	"tickergarden/backend/internal/chainrpc"
)

//go:embed gauge_storage.json
var gaugeStorageJSON []byte

type gaugeStorageLayout struct {
	Cohort        string `json:"cohort"`
	Precision     string `json:"precision"`
	DeferredQuote string `json:"deferredQuote"`
	DeferredMeme  string `json:"deferredMeme"`
	ActiveTotal   string `json:"activeTotal"`
	PendingTotal  string `json:"pendingTotal"`
	Runtime       string `json:"runtime"`
	Positions     string `json:"positions"`
	Snapshots     string `json:"snapshots"`
	Wheel         string `json:"wheel"`
	Rewards       string `json:"rewards"`
}
type GaugeStorageItem struct {
	User         string             `json:"user"`
	Before       gaugePositionState `json:"before"`
	After        gaugePositionState `json:"after"`
	PulledMeme   string             `json:"pulledMeme"`
	Materialized bool               `json:"materialized"`
}
type GaugeStorageAccounting struct {
	Items                       []GaugeStorageItem `json:"items"`
	Implementation              string             `json:"implementation,omitempty"`
	PositionsMatched            bool               `json:"positionsMatched"`
	ParticipantSnapshotsMatched bool               `json:"participantSnapshotsMatched"`
}

func verifyGaugeStorageCode(p ConversionPreview, state chainrpc.TransactionStateTrace) (gaugeStorageLayout, string, error) {
	fail := func() (gaugeStorageLayout, string, error) { return gaugeStorageLayout{}, "", ErrIntent }
	var layout gaugeStorageLayout
	if json.Unmarshal(gaugeStorageJSON, &layout) != nil {
		return fail()
	}
	account, ok := state.Prestate[p.Candidate.State.Gauge]
	if !ok || account.Code == nil {
		return fail()
	}
	code, e := hex.DecodeString(strings.TrimPrefix(*account.Code, "0x"))
	if e != nil || len(code) != 269 || crypto.Keccak256Hash(code).Hex() != p.Candidate.State.GaugeRuntimeCodeHash {
		return fail()
	}
	if hex.EncodeToString(code[:10]) != "363d3d373d3d3d363d73" || hex.EncodeToString(code[30:45]) != "5af43d82803e903d91602b57fd5bf3" {
		return fail()
	}
	for _, f := range []struct {
		word int
		want string
	}{{0, p.Candidate.State.MarketID}, {4, p.Candidate.State.FeeVault}, {5, p.Candidate.State.QuoteAsset}, {6, p.Candidate.State.MemeToken}} {
		want, e := hex.DecodeString(strings.TrimPrefix(f.want, "0x"))
		if e != nil || (len(want) != 20 && len(want) != 32) {
			return fail()
		}
		if len(want) == 20 {
			want = append(make([]byte, 12), want...)
		}
		if !bytes.Equal(want, code[45+32*f.word:45+32*(f.word+1)]) {
			return fail()
		}
	}
	implementation := "0x" + hex.EncodeToString(code[10:30])
	if !validAddress(implementation) {
		return fail()
	}
	impl, ok := state.Prestate[implementation]
	if !ok || impl.Code == nil || *impl.Code != layout.Runtime {
		return fail()
	}
	// The implementation may have no touched storage, so verify code changes
	// explicitly rather than relying on a StorageTransition for that account.
	for _, address := range []string{p.Candidate.State.Gauge, implementation} {
		full := state.Prestate[address]
		pre, preOK := state.Diff.Pre[address]
		post, postOK := state.Diff.Post[address]
		if preOK != postOK {
			return fail()
		}
		raw, e := hex.DecodeString(strings.TrimPrefix(*full.Code, "0x"))
		if e != nil {
			return fail()
		}
		hash := crypto.Keccak256Hash(raw).Hex()
		for _, a := range []chainrpc.TraceAccount{full, pre, post} {
			if a.Code != nil && *a.Code != *full.Code || a.CodeHash != nil && *a.CodeHash != hash {
				return fail()
			}
		}
	}
	return layout, implementation, nil
}

func gaugeSlot(base string, offset uint64) (string, error) {
	n, ok := new(big.Int).SetString(base, 0)
	if !ok || n.Sign() < 0 || n.BitLen() > 256 {
		return "", ErrIntent
	}
	n.Add(n, new(big.Int).SetUint64(offset))
	n.Mod(n, new(big.Int).Lsh(big.NewInt(1), 256))
	return "0x" + hex.EncodeToString(n.FillBytes(make([]byte, 32))), nil
}
func gaugeMappingSlot(root string, key *big.Int) (string, error) {
	n, e := amount(root)
	if e != nil || key == nil || key.Sign() < 0 || key.BitLen() > 256 {
		return "", ErrIntent
	}
	return crypto.Keccak256Hash(key.FillBytes(make([]byte, 32)), n.FillBytes(make([]byte, 32))).Hex(), nil
}
func gaugeStorageWords(state chainrpc.TransactionStateTrace, address, base string, count int, after bool) ([]*big.Int, error) {
	out := make([]*big.Int, count)
	for i := range out {
		slot, e := gaugeSlot(base, uint64(i))
		if e != nil {
			return nil, e
		}
		a, b, e := state.StorageTransition(address, slot)
		if e != nil {
			return nil, ErrIntent
		}
		if after {
			a = b
		}
		n, ok := new(big.Int).SetString(a[2:], 16)
		if !ok {
			return nil, ErrIntent
		}
		out[i] = n
	}
	return out, nil
}
func decodeGaugePosition(w []*big.Int) (gaugePositionState, error) {
	if len(w) != 9 || w[2].BitLen() > 128 {
		return gaugePositionState{}, ErrIntent
	}
	p := gaugePositionState{Active: w[0].String(), Pending: w[1].String(), Generation: w[2].Uint64(), UnlockAt: new(big.Int).Rsh(new(big.Int).Set(w[2]), 64).Uint64()}
	for i := 0; i < 2; i++ {
		p.Rewards[i] = gaugeUserReward{Paid: w[3+i*3].String(), Pending: w[4+i*3].String(), Remainder: w[5+i*3].String()}
	}
	return p, nil
}
func decodeGaugeSnapshot(w []*big.Int) (gaugeSnapshotState, error) {
	if len(w) != 4 || w[3].Cmp(big.NewInt(1)) > 0 {
		return gaugeSnapshotState{}, ErrIntent
	}
	return gaugeSnapshotState{Accumulators: [2]string{w[0].String(), w[1].String()}, Refs: w[2].String(), Processed: w[3].Sign() != 0}, nil
}

// matchGaugeStorage verifies participant positions and their snapshots only.
// Global activation/cohort/forfeiture bookkeeping remains a separate check.
func matchGaugeStorage(p ConversionPreview, event ReceiptEventMatch, calls TraceAccounting, state chainrpc.TransactionStateTrace, timestamp uint64) (GaugeStorageAccounting, error) {
	fail := func() (GaugeStorageAccounting, error) { return GaugeStorageAccounting{}, ErrIntent }
	out := GaugeStorageAccounting{Items: []GaugeStorageItem{}}
	if len(calls.GaugeItems) == 0 {
		return out, nil
	}
	if p.Candidate.State.MarketID != event.MarketID {
		return fail()
	}
	layout, implementation, e := verifyGaugeStorageCode(p, state)
	if e != nil {
		return fail()
	}
	out.Implementation = implementation
	gauge := p.Candidate.State.Gauge
	var current [2]string
	for i := 0; i < 2; i++ {
		slot, e := gaugeSlot(layout.Rewards, uint64(i*2))
		if e != nil {
			return fail()
		}
		words, e := gaugeStorageWords(state, gauge, slot, 1, false)
		if e != nil {
			return fail()
		}
		current[i] = words[0].String()
	}
	snapshots := map[uint64]gaugeSnapshotState{}
	seen := map[string]bool{}
	index := 0
	for _, item := range event.Items {
		if item.CreatorEpoch != 0 {
			continue
		}
		if index >= len(calls.GaugeItems) || seen[item.User] || !validAddress(item.User) {
			return fail()
		}
		seen[item.User] = true
		call := calls.GaugeItems[index]
		index++
		if call.User != item.User || call.MemeSpent != item.MemeSpent || call.QuoteReceived != item.QuoteReceived {
			return fail()
		}
		key, ok := new(big.Int).SetString(item.User[2:], 16)
		if !ok {
			return fail()
		}
		base, e := gaugeMappingSlot(layout.Positions, key)
		if e != nil {
			return fail()
		}
		words, e := gaugeStorageWords(state, gauge, base, 9, false)
		if e != nil {
			return fail()
		}
		before, e := decodeGaugePosition(words)
		if e != nil {
			return fail()
		}
		snapshot := gaugeSnapshotState{Accumulators: [2]string{"0", "0"}, Refs: "0"}
		bucket := gaugeActivationBucket{Amount: "0", Refs: "0"}
		if before.Pending != "0" {
			var exists bool
			snapshot, exists = snapshots[before.Generation]
			if !exists {
				base, e := gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(before.Generation))
				if e != nil {
					return fail()
				}
				w, e := gaugeStorageWords(state, gauge, base, 4, false)
				if e != nil {
					return fail()
				}
				snapshot, e = decodeGaugeSnapshot(w)
				if e != nil {
					return fail()
				}
			}
			if !snapshot.Processed && before.Generation <= timestamp {
				base, e := gaugeSlot(layout.Wheel, (before.Generation%32)*3)
				if e != nil {
					return fail()
				}
				w, e := gaugeStorageWords(state, gauge, base, 3, false)
				if e != nil || w[0].BitLen() > 64 {
					return fail()
				}
				bucket = gaugeActivationBucket{Generation: w[0].Uint64(), Amount: w[1].String(), Refs: w[2].String()}
				after, e := gaugeStorageWords(state, gauge, base, 3, true)
				if e != nil {
					return fail()
				}
				for _, n := range after {
					if n.Sign() != 0 {
						return fail()
					}
				}
			}
		}
		replay, e := replayGaugePosition(before, snapshot, bucket, current, timestamp, item.MaximumMeme, call.MemeRefund, call.QuoteReceived)
		if e != nil || replay.Pulled != call.PulledMeme {
			return fail()
		}
		w, e := gaugeStorageWords(state, gauge, base, 9, true)
		if e != nil {
			return fail()
		}
		after, e := decodeGaugePosition(w)
		if e != nil || !reflect.DeepEqual(after, replay.Position) {
			return fail()
		}
		if before.Pending != "0" {
			snapshots[before.Generation] = replay.Snapshot
		}
		out.Items = append(out.Items, GaugeStorageItem{User: item.User, Before: before, After: after, PulledMeme: replay.Pulled, Materialized: replay.Materialized})
	}
	if index != len(calls.GaugeItems) {
		return fail()
	}
	for generation, want := range snapshots {
		base, e := gaugeMappingSlot(layout.Snapshots, new(big.Int).SetUint64(generation))
		if e != nil {
			return fail()
		}
		w, e := gaugeStorageWords(state, gauge, base, 4, true)
		if e != nil {
			return fail()
		}
		got, e := decodeGaugeSnapshot(w)
		if e != nil || !reflect.DeepEqual(got, want) {
			return fail()
		}
	}
	out.PositionsMatched = true
	out.ParticipantSnapshotsMatched = true
	return out, nil
}
