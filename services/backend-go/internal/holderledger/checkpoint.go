package holderledger

import (
	"bytes"
	"encoding/json"
	"io"
	"math/big"
)

const MaxCheckpointBytes = 4 << 20

// Checkpoints are trusted-store recovery data, not proof of initial state or
// chain history. Unlike View they preserve all stream and accounting fields.
func EncodeCheckpoint(l *Ledger) ([]byte, error) {
	if !checkpointValid(l) {
		return nil, ErrInput
	}
	b, e := json.Marshal(l)
	if e != nil || len(b) > MaxCheckpointBytes {
		return nil, ErrInput
	}
	return b, nil
}
func DecodeCheckpoint(raw []byte) (*Ledger, error) {
	if len(raw) == 0 || len(raw) > MaxCheckpointBytes {
		return nil, ErrInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	var l Ledger
	if d.Decode(&l) != nil || d.Decode(new(any)) != io.EOF {
		return nil, ErrInput
	}
	canonical, e := EncodeCheckpoint(&l)
	// Require canonical bytes: duplicate keys, omitted fields and alternative
	// numeric spellings cannot produce a different representation of a state.
	if e != nil || !bytes.Equal(raw, canonical) {
		return nil, ErrInput
	}
	return &l, nil
}
func checkpointValid(l *Ledger) bool {
	if l == nil {
		return false
	}
	interval := l.FundingInterval
	if interval == 0 {
		interval = FundingInterval
	}
	if !hash.MatchString(l.MarketID) || l.MarketID == "0x"+string(bytes.Repeat([]byte("0"), 64)) || !address.MatchString(l.Token) || l.Token == zero || (l.ConfigurableInterval && (!l.Batched || interval < MinFundingInterval || interval > MaxFundingInterval)) || (!l.ConfigurableInterval && interval != FundingInterval) || int(l.Head) >= l.maxStreams() || len(l.Streams) > l.maxStreams() || l.Streams == nil || l.Accounts == nil || len(l.Accounts) > 10000 || len(l.Excluded) > 9 || !l.Excluded[zero] || !l.Excluded[l.Token] || l.UpdatedAt > ^uint64(0)-Duration || l.LastFundingAt > l.UpdatedAt || l.LastStreamStartedAt > l.UpdatedAt || (!l.Batched && l.LastStreamStartedAt != 0) {
		return false
	}
	validInt := func(n *big.Int) bool { return n != nil && n.Sign() >= 0 && n.BitLen() <= 256 }
	for _, n := range []*big.Int{l.Supply, l.Index, l.IndexRemainder, l.Rate, l.Idle, l.Funded, l.Paid} {
		if !validInt(n) {
			return false
		}
	}
	if l.Funded.BitLen() > 128 || l.Paid.Cmp(l.Funded) > 0 {
		return false
	}
	for a, v := range l.Excluded {
		if !address.MatchString(a) || !v {
			return false
		}
	}
	supply, rate := z(), z()
	for a, v := range l.Accounts {
		if !address.MatchString(a) || v == nil || !validInt(v.Balance) || !validInt(v.Index) || !validInt(v.Earned) || v.Index.Cmp(l.Index) > 0 {
			return false
		}
		if l.Excluded[a] {
			if v.Index.Sign() != 0 || v.Earned.Sign() != 0 {
				return false
			}
		} else {
			supply.Add(supply, v.Balance)
		}
	}
	end := l.UpdatedAt
	for _, s := range l.Streams {
		if s.End <= end || s.End > l.UpdatedAt+Duration || !validInt(s.Rate) || !validInt(s.Remainder) {
			return false
		}
		end = s.End
		rate.Add(rate, s.Rate)
	}
	return supply.Cmp(l.Supply) == 0 && rate.Cmp(l.Rate) == 0
}
