// Package holderledger independently models the continuous distributor's exact
// integer accounting. Inputs MUST include silent checkpoint/zero-claim calls and
// initial token balances, not just events. This kernel never proves coverage or
// grants publication eligibility; an authenticated call-history adapter must.
package holderledger

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"strings"
)

const Duration uint64 = 86400
const MaxStreams = 64

var ErrInput = errors.New("invalid or incomplete continuous holder action")
var precision = new(big.Int).Exp(big.NewInt(10), big.NewInt(27), nil)
var address = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var hash = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

const zero = "0x0000000000000000000000000000000000000000"

type Stream struct {
	End             uint64
	Rate, Remainder *big.Int
}
type Account struct{ Balance, Index, Earned *big.Int }
type Ledger struct {
	Head                                                    uint8
	LastFundingAt                                           uint64
	MarketID                                                string
	Token                                                   string
	Excluded                                                map[string]bool
	Accounts                                                map[string]*Account
	UpdatedAt                                               uint64
	Supply, Index, IndexRemainder, Rate, Idle, Funded, Paid *big.Int
	Streams                                                 []Stream
}

// Registration is state at enableContinuousRewards, before any subsequent
// transfer. It must enumerate all token balances including excluded addresses.
type Registration struct {
	MarketID, Token, TotalSupply string
	Timestamp                    uint64
	Excluded                     []string
	Balances                     map[string]string
}
type Action struct {
	Kind                      string
	Timestamp                 uint64
	From, To, Account, Amount string
}
type AccountView struct {
	Balance      string `json:"balance"`
	EarnedScaled string `json:"earnedScaled"`
	Index        string `json:"index"`
	Claimable    string `json:"claimable"`
}

// Snapshot combines persisted market/account storage with claimable evaluated at
// ClaimableAt, matching same-block Solidity getters. UpdatedAt is the last
// state-changing checkpoint, not the observation time.
type Snapshot struct {
	ClaimableAt         uint64                 `json:"claimableAt"`
	UpdatedAt           uint64                 `json:"updatedAt"`
	Supply              string                 `json:"supply"`
	Index               string                 `json:"index"`
	IndexRemainder      string                 `json:"indexRemainder"`
	Rate                string                 `json:"rate"`
	Idle                string                 `json:"idle"`
	Funded              string                 `json:"funded"`
	Paid                string                 `json:"paid"`
	Accounts            map[string]AccountView `json:"accounts"`
	PublicationEligible bool                   `json:"publicationEligible"`
}

func integer(s string) (*big.Int, error) {
	if len(s) == 0 || len(s) > 78 {
		return nil, ErrInput
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.Sign() < 0 || n.BitLen() > 256 || n.String() != s {
		return nil, ErrInput
	}
	return n, nil
}
func z() *big.Int            { return new(big.Int) }
func cp(n *big.Int) *big.Int { return new(big.Int).Set(n) }
func New(r Registration) (*Ledger, error) {
	if !hash.MatchString(r.MarketID) || r.MarketID == "0x"+strings.Repeat("0", 64) || !address.MatchString(r.Token) || r.Token == zero || r.Timestamp > ^uint64(0)-Duration || len(r.Balances) > 100000 || len(r.Excluded) > 9 {
		return nil, ErrInput
	}
	supply, e := integer(r.TotalSupply)
	if e != nil {
		return nil, e
	}
	l := &Ledger{MarketID: r.MarketID, Token: r.Token, Excluded: map[string]bool{}, Accounts: map[string]*Account{}, UpdatedAt: r.Timestamp, Supply: cp(supply), Index: z(), IndexRemainder: z(), Rate: z(), Idle: z(), Funded: z(), Paid: z(), Streams: []Stream{}}
	for _, a := range r.Excluded {
		if !address.MatchString(a) || l.Excluded[a] {
			return nil, ErrInput
		}
		l.Excluded[a] = true
	}
	if !l.Excluded[zero] || !l.Excluded[r.Token] {
		return nil, ErrInput
	}
	sum := z()
	for a, v := range r.Balances {
		if !address.MatchString(a) {
			return nil, ErrInput
		}
		n, e := integer(v)
		if e != nil {
			return nil, e
		}
		l.Accounts[a] = &Account{n, z(), z()}
		sum.Add(sum, n)
		if l.Excluded[a] {
			l.Supply.Sub(l.Supply, n)
		}
	}
	if sum.Cmp(supply) != 0 || l.Supply.Sign() < 0 {
		return nil, ErrInput
	}
	return l, nil
}
func (l *Ledger) clone() *Ledger {
	c := *l
	c.Accounts = map[string]*Account{}
	for a, v := range l.Accounts {
		c.Accounts[a] = &Account{cp(v.Balance), cp(v.Index), cp(v.Earned)}
	}
	c.Supply = cp(l.Supply)
	c.Index = cp(l.Index)
	c.IndexRemainder = cp(l.IndexRemainder)
	c.Rate = cp(l.Rate)
	c.Idle = cp(l.Idle)
	c.Funded = cp(l.Funded)
	c.Paid = cp(l.Paid)
	c.Streams = make([]Stream, len(l.Streams))
	for i, s := range l.Streams {
		c.Streams[i] = Stream{s.End, cp(s.Rate), cp(s.Remainder)}
	}
	return &c
}
func (l *Ledger) account(a string) *Account {
	v := l.Accounts[a]
	if v == nil {
		v = &Account{z(), z(), z()}
		l.Accounts[a] = v
	}
	return v
}
func (l *Ledger) accrue(a string) {
	if l.Excluded[a] {
		return
	}
	v := l.account(a)
	v.Earned.Add(v.Earned, new(big.Int).Mul(v.Balance, new(big.Int).Sub(l.Index, v.Index)))
	v.Index.Set(l.Index)
}
func (l *Ledger) checkpoint(ts uint64) {
	released := z()
	for len(l.Streams) > 0 && l.Streams[0].End <= ts {
		s := l.Streams[0]
		released.Add(released, new(big.Int).Mul(l.Rate, new(big.Int).SetUint64(s.End-l.UpdatedAt)))
		released.Add(released, s.Remainder)
		l.UpdatedAt = s.End
		l.Rate.Sub(l.Rate, s.Rate)
		l.Streams = l.Streams[1:]
		l.Head = (l.Head + 1) % MaxStreams
	}
	released.Add(released, new(big.Int).Mul(l.Rate, new(big.Int).SetUint64(ts-l.UpdatedAt)))
	l.UpdatedAt = ts
	if l.Supply.Sign() == 0 {
		l.Idle.Add(l.Idle, released)
		return
	}
	released.Add(released, l.IndexRemainder)
	q, r := new(big.Int).QuoRem(released, l.Supply, z())
	l.Index.Add(l.Index, q)
	l.IndexRemainder.Set(r)
}
func (l *Ledger) appendStream(amount *big.Int, end uint64) error {
	rate, tail := new(big.Int).QuoRem(amount, new(big.Int).SetUint64(Duration), z())
	if n := len(l.Streams); n > 0 && l.Streams[n-1].End == end {
		s := &l.Streams[n-1]
		s.Rate.Add(s.Rate, rate)
		s.Remainder.Add(s.Remainder, tail)
	} else {
		if n == MaxStreams {
			return ErrInput
		}
		l.Streams = append(l.Streams, Stream{end, rate, tail})
	}
	l.Rate.Add(l.Rate, rate)
	return nil
}
func (l *Ledger) restart(ts uint64) error {
	if l.Idle.Sign() == 0 || l.Supply.Sign() == 0 || len(l.Streams) == MaxStreams {
		return nil
	}
	amount := cp(l.Idle)
	l.Idle.SetInt64(0)
	return l.appendStream(amount, ts+Duration)
}

// Apply is atomic. Claim Amount is the actual transfer amount, including "0"
// for a successful claim which emitted no event. Reverted calls are not inputs.
func (l *Ledger) Apply(a Action) error {
	if l == nil || a.Timestamp < l.UpdatedAt || a.Timestamp > ^uint64(0)-Duration {
		return ErrInput
	}
	c := l.clone()
	c.checkpoint(a.Timestamp)
	switch a.Kind {
	case "fund":
		n, e := integer(a.Amount)
		if e != nil || n.Sign() == 0 {
			return ErrInput
		}
		c.LastFundingAt = a.Timestamp
		c.Funded.Add(c.Funded, n)
		if c.Funded.BitLen() > 128 {
			return ErrInput
		}
		if e = c.appendStream(new(big.Int).Mul(n, precision), a.Timestamp+Duration); e != nil {
			return e
		}
	case "checkpoint":
		if e := c.restart(a.Timestamp); e != nil {
			return e
		}
	case "transfer":
		if !address.MatchString(a.From) || !address.MatchString(a.To) {
			return ErrInput
		}
		n, e := integer(a.Amount)
		if e != nil {
			return e
		}
		c.accrue(a.From)
		if a.To != a.From {
			c.accrue(a.To)
		}
		if a.From != a.To {
			if a.From != zero {
				f := c.account(a.From)
				if f.Balance.Cmp(n) < 0 {
					return ErrInput
				}
				f.Balance.Sub(f.Balance, n)
			}
			if a.To != zero {
				c.account(a.To).Balance.Add(c.account(a.To).Balance, n)
			}
			if !c.Excluded[a.From] {
				c.Supply.Sub(c.Supply, n)
			}
			if !c.Excluded[a.To] {
				c.Supply.Add(c.Supply, n)
			}
		} else if a.From != zero && c.account(a.From).Balance.Cmp(n) < 0 {
			return ErrInput
		}
		if e := c.restart(a.Timestamp); e != nil {
			return e
		}
	case "claim":
		if !address.MatchString(a.Account) || a.Account == zero {
			return ErrInput
		}
		n, e := integer(a.Amount)
		if e != nil {
			return e
		}
		c.accrue(a.Account)
		if e = c.restart(a.Timestamp); e != nil {
			return e
		}
		v := c.account(a.Account)
		actual := new(big.Int).Quo(v.Earned, precision)
		if actual.Cmp(n) != 0 {
			return ErrInput
		}
		v.Earned.Sub(v.Earned, new(big.Int).Mul(n, precision))
		c.Paid.Add(c.Paid, n)
	default:
		return ErrInput
	}
	if len(c.Accounts) > 100000 || !c.valid() {
		return ErrInput
	}
	*l = *c
	return nil
}
func (l *Ledger) valid() bool {
	for _, n := range []*big.Int{l.Supply, l.Index, l.IndexRemainder, l.Rate, l.Idle, l.Funded, l.Paid} {
		if n.Sign() < 0 || n.BitLen() > 256 {
			return false
		}
	}
	if l.Paid.Cmp(l.Funded) > 0 {
		return false
	}
	for _, v := range l.Accounts {
		for _, n := range []*big.Int{v.Balance, v.Index, v.Earned} {
			if n.Sign() < 0 || n.BitLen() > 256 {
				return false
			}
		}
	}
	return true
}

// View computes claimable at ts without persisting checkpoint rounding.
func (l *Ledger) View(ts uint64) (Snapshot, error) {
	if l == nil || ts < l.UpdatedAt || ts > ^uint64(0)-Duration {
		return Snapshot{}, ErrInput
	}
	c := l.clone()
	c.checkpoint(ts)
	if len(c.Accounts) > 100000 || !c.valid() {
		return Snapshot{}, ErrInput
	}
	s := Snapshot{ClaimableAt: ts, UpdatedAt: l.UpdatedAt, Supply: l.Supply.String(), Index: l.Index.String(), IndexRemainder: l.IndexRemainder.String(), Rate: l.Rate.String(), Idle: l.Idle.String(), Funded: l.Funded.String(), Paid: l.Paid.String(), Accounts: map[string]AccountView{}}
	for a, v := range l.Accounts {
		claim := z()
		if !l.Excluded[a] {
			claim.Add(v.Earned, new(big.Int).Mul(v.Balance, new(big.Int).Sub(c.Index, v.Index)))
			claim.Quo(claim, precision)
		}
		s.Accounts[a] = AccountView{v.Balance.String(), v.Earned.String(), v.Index.String(), claim.String()}
	}
	return s, nil
}

// Bytes is a deterministic view for audit comparisons, not a trusted restore format.
func (l *Ledger) Bytes(ts uint64) ([]byte, error) {
	s, e := l.View(ts)
	if e != nil {
		return nil, e
	}
	return json.Marshal(s)
}
