// Package treasury computes deterministic candidate datasets. It does not attest
// Transfer-history completeness, authorize publication, or submit transactions.
package treasury

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/sha3"
)

const Duration uint64 = 60 * 60
const Schema = "TICKERGARDEN_V1_TREASURY_ROOT_V1"
const zero = "0x0000000000000000000000000000000000000000"

var addressRE = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
var hashRE = regexp.MustCompile(`^0x[0-9a-fA-F]{64}$`)
var decimalRE = regexp.MustCompile(`^(0|[1-9][0-9]*)$`)
var leafDomain = hash([]byte("TICKERGARDEN_V1_TREASURY_CLAIM_V1"))
var twabSchema = hash([]byte("TRANSFER_LOG_TWAB_1H_R6_TEST_ONLY"))
var emptyRoot = hash([]byte("TICKERGARDEN_V1_TREASURY_EMPTY_EPOCH_V1"))

// Strings preserve integer values across JSON runtimes. Field order also defines
// the canonical dataset JSON commitment shared with the TypeScript generator.
type Context struct {
	ChainID               string `json:"chainId"`
	Distributor           string `json:"distributor"`
	MarketID              string `json:"marketId"`
	EpochID               uint32 `json:"epochId"`
	MemeToken             string `json:"memeToken"`
	QuoteToken            string `json:"quoteToken"`
	EligibilityPolicyHash string `json:"eligibilityPolicyHash"`
	WindowStart           string `json:"windowStart"`
	WindowEnd             string `json:"windowEnd"`
	SourceBlockNumber     string `json:"sourceBlockNumber"`
	SourceBlockHash       string `json:"sourceBlockHash"`
}
type Transfer struct {
	BlockNumber      string `json:"blockNumber"`
	TransactionIndex uint64 `json:"transactionIndex"`
	LogIndex         uint64 `json:"logIndex"`
	Timestamp        string `json:"timestamp"`
	From             string `json:"from"`
	To               string `json:"to"`
	Value            string `json:"value"`
}
type Input struct {
	Context
	EmptyEpochPolicy     string     `json:"emptyEpochPolicy,omitempty"`
	ExcludedAccounts     []string   `json:"excludedAccounts"`
	SourceBlockTimestamp string     `json:"sourceBlockTimestamp"`
	QuoteAmount          string     `json:"quoteAmount"`
	Transfers            []Transfer `json:"transfers"`
}
type Allocation struct {
	Index   uint32 `json:"index"`
	Account string `json:"account"`
	Twab    string `json:"twab"`
	Amount  string `json:"amount"`
	Leaf    string `json:"leaf"`
}
type Leaf struct {
	Allocation
	Proof []string `json:"proof"`
}
type Output struct {
	Schema               string  `json:"schema"`
	Context              Context `json:"context"`
	SourceBlockTimestamp string  `json:"sourceBlockTimestamp"`
	MerkleRoot           string  `json:"merkleRoot"`
	DatasetHash          string  `json:"datasetHash"`
	LeafCount            uint32  `json:"leafCount"`
	TotalTwab            string  `json:"totalTwab"`
	TotalAllocated       string  `json:"totalAllocated"`
	Leaves               []Leaf  `json:"leaves"`
}

func hash(data []byte) string {
	h := sha3.NewLegacyKeccak256()
	h.Write(data)
	return "0x" + hex.EncodeToString(h.Sum(nil))
}
func decode(s string) []byte { b, _ := hex.DecodeString(strings.TrimPrefix(s, "0x")); return b }
func integer(s string, bits int) (*big.Int, error) {
	// Bound decimal parsing before big.Int allocation, including hostile JSON.
	if len(s) > bits*30103/100000+1 {
		return nil, errors.New("integer overflow")
	}
	if !decimalRE.MatchString(s) {
		return nil, errors.New("non-canonical integer")
	}
	n, ok := new(big.Int).SetString(s, 10)
	if !ok || n.BitLen() > bits {
		return nil, errors.New("integer overflow")
	}
	return n, nil
}
func word(n *big.Int) []byte   { return n.FillBytes(make([]byte, 32)) }
func uintWord(n uint64) []byte { return word(new(big.Int).SetUint64(n)) }
func hexWord(s string) []byte {
	b := decode(s)
	v := make([]byte, 32)
	copy(v[32-len(b):], b)
	return v
}
func normalizeAddresses(values []string) ([]string, error) {
	set := map[string]bool{}
	for _, v := range values {
		if !addressRE.MatchString(v) {
			return nil, errors.New("invalid exclusion address")
		}
		set[strings.ToLower(v)] = true
	}
	out := []string{}
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out, nil
}
func PolicyHash(chain, market string, excluded []string) (string, error) {
	n, e := integer(chain, 256)
	if e != nil || n.Sign() == 0 || !hashRE.MatchString(market) {
		return "", errors.New("invalid policy domain")
	}
	accounts, e := normalizeAddresses(excluded)
	if e != nil {
		return "", e
	}
	data := decode(hash([]byte("TICKERGARDEN_V1_TREASURY_ELIGIBILITY_POLICY_V1")))
	data = append(data, word(n)...)
	data = append(data, decode(market)...)
	data = append(data, uintWord(128)...)
	data = append(data, uintWord(uint64(len(accounts)))...)
	for _, a := range accounts {
		data = append(data, hexWord(a)...)
	}
	return hash(data), nil
}
func normalizedContext(c Context) Context {
	c.Distributor = strings.ToLower(c.Distributor)
	c.MarketID = strings.ToLower(c.MarketID)
	c.MemeToken = strings.ToLower(c.MemeToken)
	c.QuoteToken = strings.ToLower(c.QuoteToken)
	c.EligibilityPolicyHash = strings.ToLower(c.EligibilityPolicyHash)
	c.SourceBlockHash = strings.ToLower(c.SourceBlockHash)
	return c
}
func validateContext(c Context) error {
	n, e := integer(c.ChainID, 256)
	if e != nil || n.Sign() == 0 {
		return errors.New("invalid chain")
	}
	for _, a := range []string{c.Distributor, c.MemeToken, c.QuoteToken} {
		if !addressRE.MatchString(a) {
			return errors.New("invalid contract address")
		}
	}
	if c.Distributor == zero || c.MemeToken == zero || c.QuoteToken == c.MemeToken {
		return errors.New("invalid token or distributor identity")
	}
	for _, v := range []string{c.MarketID, c.EligibilityPolicyHash, c.SourceBlockHash} {
		if !hashRE.MatchString(v) || v == "0x"+strings.Repeat("0", 64) {
			return errors.New("invalid hash domain")
		}
	}
	if c.EpochID == 0 {
		return errors.New("invalid epoch")
	}
	start, e := integer(c.WindowStart, 64)
	if e != nil || start.Sign() == 0 {
		return errors.New("invalid window start")
	}
	end, e := integer(c.WindowEnd, 64)
	if e != nil || new(big.Int).Sub(end, start).Cmp(new(big.Int).SetUint64(Duration)) != 0 {
		return errors.New("TWAB window must be exactly 1 hour (R6 test profile)")
	}
	_, e = integer(c.SourceBlockNumber, 64)
	return e
}
func HashLeaf(c Context, index uint32, account, twab, amount string) (string, error) {
	c = normalizedContext(c)
	if e := validateContext(c); e != nil {
		return "", e
	}
	if !addressRE.MatchString(account) || strings.ToLower(account) == zero {
		return "", errors.New("invalid leaf account")
	}
	t, e := integer(twab, 256)
	if e != nil || t.Sign() == 0 {
		return "", errors.New("invalid leaf TWAB")
	}
	a, e := integer(amount, 256)
	if e != nil || a.Sign() == 0 {
		return "", errors.New("invalid leaf amount")
	}
	data := append(decode(leafDomain), decode(twabSchema)...)
	for _, v := range []string{c.ChainID, c.Distributor, c.MarketID, strconv.FormatUint(uint64(c.EpochID), 10), c.MemeToken, c.QuoteToken, c.EligibilityPolicyHash, c.WindowStart, c.WindowEnd, c.SourceBlockNumber, c.SourceBlockHash, strconv.FormatUint(uint64(index), 10), account, twab, amount} {
		if strings.HasPrefix(v, "0x") {
			data = append(data, hexWord(v)...)
		} else {
			n, _ := integer(v, 256)
			data = append(data, word(n)...)
		}
	}
	return hash(decode(hash(data))), nil
}
func pair(a, b string) string {
	if a > b {
		a, b = b, a
	}
	return hash(append(decode(a), decode(b)...))
}
func VerifyProof(leaf string, proof []string, root string) bool {
	if !hashRE.MatchString(leaf) || !hashRE.MatchString(root) || len(proof) > 32 {
		return false
	}
	v := strings.ToLower(leaf)
	for _, p := range proof {
		if !hashRE.MatchString(p) {
			return false
		}
		v = pair(v, strings.ToLower(p))
	}
	return v == strings.ToLower(root)
}
func tree(leaves []Leaf) (string, []Leaf) {
	levels := [][]string{{}}
	for _, l := range leaves {
		levels[0] = append(levels[0], l.Leaf)
	}
	for len(levels[len(levels)-1]) > 1 {
		prev := levels[len(levels)-1]
		next := []string{}
		for i := 0; i < len(prev); i += 2 {
			v := prev[i]
			if i+1 < len(prev) {
				v = pair(v, prev[i+1])
			}
			next = append(next, v)
		}
		levels = append(levels, next)
	}
	for i := range leaves {
		leaves[i].Proof = []string{}
		index := i
		for level := 0; level < len(levels)-1; level++ {
			sibling := index ^ 1
			if sibling < len(levels[level]) {
				leaves[i].Proof = append(leaves[i].Proof, levels[level][sibling])
			}
			index /= 2
		}
	}
	return levels[len(levels)-1][0], leaves
}

type observation struct {
	Transfer
	block, time uint64
	amount      *big.Int
}
type accumulator struct {
	balance, weighted *big.Int
	last              uint64
}
type draft struct {
	account                 string
	twab, amount, remainder *big.Int
}

func Generate(in Input) (Output, error) {
	fail := func(e error) (Output, error) { return Output{}, e }
	c := normalizedContext(in.Context)
	if e := validateContext(c); e != nil {
		return fail(e)
	}
	if in.EmptyEpochPolicy != "" && in.EmptyEpochPolicy != "reviewed-rollover" {
		return fail(errors.New("invalid empty epoch policy"))
	}
	source, e := integer(in.SourceBlockTimestamp, 64)
	if e != nil {
		return fail(e)
	}
	start, _ := strconv.ParseUint(c.WindowStart, 10, 64)
	end, _ := strconv.ParseUint(c.WindowEnd, 10, 64)
	sourceBlock, _ := strconv.ParseUint(c.SourceBlockNumber, 10, 64)
	if source.Uint64() < end {
		return fail(errors.New("source block precedes window end"))
	}
	quote, e := integer(in.QuoteAmount, 256)
	if e != nil || quote.Sign() == 0 {
		return fail(errors.New("invalid quote amount"))
	}
	policy, e := PolicyHash(c.ChainID, c.MarketID, in.ExcludedAccounts)
	if e != nil {
		return fail(e)
	}
	if policy != c.EligibilityPolicyHash {
		return fail(errors.New("eligibility policy hash mismatch"))
	}
	addresses, _ := normalizeAddresses(in.ExcludedAccounts)
	excluded := map[string]bool{}
	for _, a := range addresses {
		excluded[a] = true
	}
	observations := make([]observation, 0, len(in.Transfers))
	for _, v := range in.Transfers {
		if !addressRE.MatchString(v.From) || !addressRE.MatchString(v.To) || v.TransactionIndex > 1<<53-1 || v.LogIndex > 1<<53-1 {
			return fail(errors.New("invalid Transfer provenance"))
		}
		b, e := integer(v.BlockNumber, 64)
		if e != nil {
			return fail(e)
		}
		t, e := integer(v.Timestamp, 64)
		if e != nil {
			return fail(e)
		}
		amount, e := integer(v.Value, 256)
		if e != nil {
			return fail(e)
		}
		if b.Uint64() > sourceBlock || t.Cmp(source) > 0 {
			return fail(errors.New("Transfer beyond committed source"))
		}
		v.From = strings.ToLower(v.From)
		v.To = strings.ToLower(v.To)
		observations = append(observations, observation{v, b.Uint64(), t.Uint64(), amount})
	}
	sort.Slice(observations, func(i, j int) bool {
		a, b := observations[i], observations[j]
		if a.block != b.block {
			return a.block < b.block
		}
		if a.TransactionIndex != b.TransactionIndex {
			return a.TransactionIndex < b.TransactionIndex
		}
		return a.LogIndex < b.LogIndex
	})
	for i := 1; i < len(observations); i++ {
		a, b := observations[i-1], observations[i]
		if b.time < a.time {
			return fail(errors.New("non-monotonic Transfer timestamps"))
		}
		if a.block == b.block && (a.time != b.time || a.LogIndex >= b.LogIndex) {
			return fail(errors.New("inconsistent or duplicate block log provenance"))
		}
	}
	balances := map[string]*big.Int{}
	acc := map[string]*accumulator{}
	balance := func(a string) *big.Int {
		if balances[a] == nil {
			balances[a] = new(big.Int)
		}
		return balances[a]
	}
	checkpoint := func(a string, t uint64) error {
		v := acc[a]
		if v == nil {
			v = &accumulator{new(big.Int).Set(balance(a)), new(big.Int), start}
			acc[a] = v
		}
		if t < v.last {
			return errors.New("non-monotonic account timestamp")
		}
		v.weighted.Add(v.weighted, new(big.Int).Mul(v.balance, new(big.Int).SetUint64(t-v.last)))
		if v.weighted.BitLen() > 256 {
			return errors.New("TWAB exceeds uint256")
		}
		v.last = t
		return nil
	}
	for _, v := range observations {
		if v.time >= end {
			continue
		}
		if v.time >= start {
			if v.From != zero {
				if e := checkpoint(v.From, v.time); e != nil {
					return fail(e)
				}
			}
			if v.To != zero && v.To != v.From {
				if e := checkpoint(v.To, v.time); e != nil {
					return fail(e)
				}
			}
		}
		if v.From != zero {
			b := balance(v.From)
			if b.Cmp(v.amount) < 0 {
				return fail(errors.New("incomplete Transfer history: negative balance"))
			}
			b.Sub(b, v.amount)
			if a := acc[v.From]; a != nil {
				a.balance.Set(b)
			}
		}
		if v.To != zero {
			b := balance(v.To)
			b.Add(b, v.amount)
			if b.BitLen() > 256 {
				return fail(errors.New("balance exceeds uint256"))
			}
			if a := acc[v.To]; a != nil {
				a.balance.Set(b)
			}
		}
	}
	for a, b := range balances {
		if b.Sign() != 0 || acc[a] != nil {
			if e := checkpoint(a, end); e != nil {
				return fail(e)
			}
		}
	}
	drafts := []draft{}
	total := new(big.Int)
	for a, v := range acc {
		if v.weighted.Sign() > 0 && !excluded[a] {
			drafts = append(drafts, draft{account: a, twab: new(big.Int).Set(v.weighted)})
			total.Add(total, v.weighted)
		}
	}
	if total.BitLen() > 256 {
		return fail(errors.New("total TWAB exceeds uint256"))
	}
	sort.Slice(drafts, func(i, j int) bool { return drafts[i].account < drafts[j].account })
	out := Output{Schema: Schema, Context: c, SourceBlockTimestamp: in.SourceBlockTimestamp, TotalTwab: total.String(), TotalAllocated: "0", Leaves: []Leaf{}}
	if len(drafts) == 0 {
		if in.EmptyEpochPolicy != "reviewed-rollover" {
			return fail(errors.New("no eligible holders; reviewed empty epoch policy required"))
		}
		out.MerkleRoot = emptyRoot
	} else {
		base := new(big.Int)
		for i := range drafts {
			d := &drafts[i]
			product := new(big.Int).Mul(quote, d.twab)
			d.amount = new(big.Int)
			d.remainder = new(big.Int)
			d.amount.QuoRem(product, total, d.remainder)
			base.Add(base, d.amount)
		}
		units := new(big.Int).Sub(quote, base)
		if !units.IsUint64() || units.Uint64() > uint64(len(drafts)) {
			return fail(errors.New("rounding invariant"))
		}
		order := make([]int, len(drafts))
		for i := range order {
			order[i] = i
		}
		sort.Slice(order, func(i, j int) bool {
			a, b := drafts[order[i]], drafts[order[j]]
			cmp := a.remainder.Cmp(b.remainder)
			if cmp == 0 {
				return a.account < b.account
			}
			return cmp > 0
		})
		for _, i := range order[:int(units.Uint64())] {
			drafts[i].amount.Add(drafts[i].amount, big.NewInt(1))
		}
		allocated := new(big.Int)
		for _, d := range drafts {
			if d.amount.Sign() == 0 {
				continue
			}
			if uint64(len(out.Leaves)) >= 1<<32-1 {
				return fail(errors.New("leaf count exceeds uint32"))
			}
			index := uint32(len(out.Leaves))
			leaf, e := HashLeaf(c, index, d.account, d.twab.String(), d.amount.String())
			if e != nil {
				return fail(e)
			}
			out.Leaves = append(out.Leaves, Leaf{Allocation: Allocation{index, d.account, d.twab.String(), d.amount.String(), leaf}})
			allocated.Add(allocated, d.amount)
		}
		if allocated.Cmp(quote) != 0 {
			return fail(errors.New("allocation invariant"))
		}
		out.MerkleRoot, out.Leaves = tree(out.Leaves)
		out.LeafCount = uint32(len(out.Leaves))
		out.TotalAllocated = allocated.String()
	}
	allocations := make([]Allocation, 0, len(out.Leaves))
	for _, l := range out.Leaves {
		allocations = append(allocations, l.Allocation)
	}
	data, e := json.Marshal(struct {
		Schema               string       `json:"schema"`
		Context              Context      `json:"context"`
		SourceBlockTimestamp string       `json:"sourceBlockTimestamp"`
		QuoteAmount          string       `json:"quoteAmount"`
		TotalTwab            string       `json:"totalTwab"`
		Allocations          []Allocation `json:"allocations"`
	}{"TICKERGARDEN_V1_TREASURY_DATASET_V1", c, in.SourceBlockTimestamp, in.QuoteAmount, out.TotalTwab, allocations})
	if e != nil {
		return fail(e)
	}
	out.DatasetHash = hash(data)
	return out, nil
}
