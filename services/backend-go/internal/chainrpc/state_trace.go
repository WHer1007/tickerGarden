package chainrpc

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

type TraceAccount struct {
	Balance  *string           `json:"balance,omitempty"`
	Nonce    *uint64           `json:"nonce,omitempty"`
	Code     *string           `json:"code,omitempty"`
	CodeHash *string           `json:"codeHash,omitempty"`
	Storage  map[string]string `json:"storage,omitempty"`
}
type TraceState map[string]TraceAccount
type StateDiff struct {
	Pre  TraceState `json:"pre"`
	Post TraceState `json:"post"`
}
type TransactionStateTrace struct {
	Prestate TraceState `json:"prestate"`
	Diff     StateDiff  `json:"diff"`
}

// TransactionState reads accessed transaction-start state and a separate state
// diff. Neither is a state-root proof. Missing accessed slots remain unknown.
func (c *Client) TransactionState(ctx context.Context, hash string) (TransactionStateTrace, error) {
	if !hashPattern.MatchString(hash) {
		return TransactionStateTrace{}, ErrTraceUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	fetch := func(diff bool) (json.RawMessage, error) {
		var body json.RawMessage
		err := c.call(ctx, "debug_traceTransaction", []any{hash, map[string]any{"tracer": "prestateTracer", "timeout": "15s", "tracerConfig": map[string]any{"diffMode": diff, "disableCode": false, "disableStorage": false}}}, &body)
		if err != nil || len(body) > 2<<20 {
			return nil, ErrTraceUnavailable
		}
		return body, nil
	}
	full, err := fetch(false)
	if err != nil {
		return TransactionStateTrace{}, err
	}
	var result TransactionStateTrace
	if decodeTraceState(full, &result.Prestate) != nil {
		return TransactionStateTrace{}, ErrTraceUnavailable
	}
	diff, err := fetch(true)
	if err != nil {
		return TransactionStateTrace{}, err
	}
	var parts struct {
		Pre  json.RawMessage
		Post json.RawMessage
	}
	if json.Unmarshal(diff, &parts) != nil || decodeTraceState(parts.Pre, &result.Diff.Pre) != nil || decodeTraceState(parts.Post, &result.Diff.Post) != nil {
		return TransactionStateTrace{}, ErrTraceUnavailable
	}
	// Every nonzero pre-diff slot must agree with the separately read accessed
	// prestate. A provider truncation or mixed result is not a zero value.
	for address, account := range result.Diff.Pre {
		for slot, value := range account.Storage {
			original, ok := result.Prestate[address].Storage[slot]
			if !ok || original != value {
				return TransactionStateTrace{}, ErrTraceUnavailable
			}
		}
	}
	return result, nil
}
func validTraceState(state TraceState) bool {
	if state == nil || len(state) > 4096 {
		return false
	}
	slots := 0
	for address, a := range state {
		if !addressPattern.MatchString(address) || address != strings.ToLower(address) {
			return false
		}
		if a.Balance != nil {
			if _, e := parseTraceValue(*a.Balance); e != nil {
				return false
			}
		}
		if a.Code != nil && (!dataPattern.MatchString(*a.Code) || len(*a.Code)%2 != 0 || len(*a.Code) > 131074) {
			return false
		}
		if a.CodeHash != nil && !hashPattern.MatchString(*a.CodeHash) {
			return false
		}
		if a.Code != nil && a.CodeHash != nil {
			bytes, e := hex.DecodeString((*a.Code)[2:])
			if e != nil || crypto.Keccak256Hash(bytes).Hex() != *a.CodeHash {
				return false
			}
		}
		slots += len(a.Storage)
		if slots > 8192 {
			return false
		}
		for key, value := range a.Storage {
			if !hashPattern.MatchString(key) || !hashPattern.MatchString(value) || key != strings.ToLower(key) || value != strings.ToLower(value) {
				return false
			}
		}
	}
	return true
}

// StorageTransition requires an explicitly observed prestate slot and intact
// contract code. Diff omission is interpreted only using prestateTracer's
// documented zero/unchanged semantics; account creation/deletion is rejected.
func (t TransactionStateTrace) StorageTransition(address, slot string) (string, string, error) {
	fail := func() (string, string, error) { return "", "", ErrTraceUnavailable }
	if !addressPattern.MatchString(address) || !hashPattern.MatchString(slot) {
		return fail()
	}
	full, ok := t.Prestate[address]
	if !ok || full.Code == nil || *full.Code == "0x" {
		return fail()
	}
	before, ok := full.Storage[slot]
	if !ok || !hashPattern.MatchString(before) {
		return fail()
	}
	pre, preExists := t.Diff.Pre[address]
	post, postExists := t.Diff.Post[address]
	if preExists != postExists {
		return fail()
	}
	if !preExists {
		return before, before, nil
	}
	if (pre.Code != nil && *pre.Code != *full.Code) || (post.Code != nil && *post.Code != *full.Code) {
		return fail()
	}
	codeBytes, err := hex.DecodeString(strings.TrimPrefix(*full.Code, "0x"))
	if err != nil {
		return fail()
	}
	expectedCodeHash := crypto.Keccak256Hash(codeBytes).Hex()
	for _, hash := range []*string{full.CodeHash, pre.CodeHash, post.CodeHash} {
		if hash != nil && *hash != expectedCodeHash {
			return fail()
		}
	}
	old, oldExists := pre.Storage[slot]
	after, afterExists := post.Storage[slot]
	zero := "0x" + strings.Repeat("0", 64)
	if oldExists && old != before {
		return fail()
	}
	if !oldExists && !afterExists {
		return before, before, nil
	}
	if !oldExists && before != zero {
		return fail()
	}
	if !afterExists {
		after = zero
	}
	if !hashPattern.MatchString(after) {
		return fail()
	}
	return before, after, nil
}

func decodeTraceState(raw json.RawMessage, out *TraceState) error {
	var objects map[string]json.RawMessage
	if json.Unmarshal(raw, &objects) != nil || objects == nil {
		return ErrTraceUnavailable
	}
	for _, account := range objects {
		body := bytes.TrimSpace(account)
		if len(body) == 0 || body[0] != '{' {
			return ErrTraceUnavailable
		}
	}
	if json.Unmarshal(raw, out) != nil || !validTraceState(*out) {
		return ErrTraceUnavailable
	}
	return nil
}

// ContractBalanceTransition interprets native balances separately from storage:
// an omitted post balance means unchanged, while an explicit 0x0 means zero.
// Account creation/deletion and code changes are unsupported, never inferred.
func (t TransactionStateTrace) ContractBalanceTransition(address string) (string, string, error) {
	fail := func() (string, string, error) { return "", "", ErrTraceUnavailable }
	full, ok := t.Prestate[address]
	if !addressPattern.MatchString(address) || !ok || full.Code == nil || !strings.HasPrefix(*full.Code, "0x") || *full.Code == "0x" || full.Balance == nil {
		return fail()
	}
	before, e := parseTraceValue(*full.Balance)
	if e != nil {
		return fail()
	}
	code, e := hex.DecodeString(strings.TrimPrefix(*full.Code, "0x"))
	if e != nil || len(code) == 0 {
		return fail()
	}
	pre, preOK := t.Diff.Pre[address]
	post, postOK := t.Diff.Post[address]
	if preOK != postOK {
		return fail()
	}
	hash := crypto.Keccak256Hash(code).Hex()
	for _, account := range []TraceAccount{full, pre, post} {
		if account.Code != nil && *account.Code != *full.Code || account.CodeHash != nil && *account.CodeHash != hash {
			return fail()
		}
	}
	if pre.Balance != nil {
		old, e := parseTraceValue(*pre.Balance)
		if e != nil || old.Cmp(before) != 0 {
			return fail()
		}
	}
	after := before
	if post.Balance != nil {
		after, e = parseTraceValue(*post.Balance)
		if e != nil {
			return fail()
		}
	}
	return before.String(), after.String(), nil
}

// ValidateTransactionStateTrace permits historical replay without trusting a
// stored success flag. This validates shape/consistency, not a state-root proof.
func ValidateTransactionStateTrace(t TransactionStateTrace) error {
	if !validTraceState(t.Prestate) || !validTraceState(t.Diff.Pre) || !validTraceState(t.Diff.Post) {
		return ErrTraceUnavailable
	}
	for address, account := range t.Diff.Pre {
		for slot, value := range account.Storage {
			original, ok := t.Prestate[address].Storage[slot]
			if !ok || original != value {
				return ErrTraceUnavailable
			}
		}
	}
	full, e := json.Marshal(t.Prestate)
	if e != nil || len(full) > 2<<20 {
		return ErrTraceUnavailable
	}
	diff, e := json.Marshal(t.Diff)
	if e != nil || len(diff) > 2<<20 {
		return ErrTraceUnavailable
	}
	return nil
}
