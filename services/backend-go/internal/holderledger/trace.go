package holderledger

import (
	"math/big"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
)

type Binding struct {
	Distributor string `json:"distributor"`
	Vault       string `json:"vault"`
}

func selector(s string) string { return deployment.Hash([]byte(s))[:10] }
func word(input string, i int) (string, error) {
	start := 10 + i*64
	if len(input) < start+64 {
		return "", ErrInput
	}
	return input[start : start+64], nil
}
func decimal(w string) (string, error) {
	n, ok := new(big.Int).SetString(w, 16)
	if !ok || len(w) != 64 {
		return "", ErrInput
	}
	return n.String(), nil
}
func addr(w string) (string, error) {
	if len(w) != 64 || w[:24] != strings.Repeat("0", 24) {
		return "", ErrInput
	}
	a := "0x" + w[24:]
	if !address.MatchString(a) {
		return "", ErrInput
	}
	return a, nil
}

// ApplyTrace handles successful distributor calls in execution order, including
// silent checkpoint and zero-claim calls. It ignores reverted subtrees atomically.
// Caller MUST authenticate code/bindings, initial state, each transaction root,
// canonical receipt and complete transaction coverage. A callTracer response is
// provider evidence, not a consensus proof or a completeness certificate.
func (l *Ledger) ApplyTrace(ts uint64, b Binding, t chainrpc.CallTrace) (int, error) {
	if l == nil || !address.MatchString(b.Distributor) || b.Distributor == zero || !address.MatchString(b.Vault) || b.Vault == zero || b.Distributor == b.Vault || chainrpc.ValidateCallTrace(t) != nil {
		return 0, ErrInput
	}
	c := l.clone()
	count := 0
	var walk func(chainrpc.CallTrace) error
	walk = func(n chainrpc.CallTrace) error {
		if n.Error != "" {
			return nil
		}
		if n.To == b.Distributor && len(n.Input) >= 10 && len(n.Input) < 74 {
			switch n.Input[:10] {
			case selector("fundCreatorFees(bytes32,uint32,uint256)"), selector("checkpointTransfer(bytes32,address,address,uint256)"), selector("checkpoint(bytes32)"), selector("claim(bytes32)"):
				return ErrInput
			}
		}
		if n.To == b.Distributor && len(n.Input) >= 74 {
			sel := n.Input[:10]
			id := "0x" + n.Input[10:74]
			if id == c.MarketID {
				action := Action{Timestamp: ts}
				words := 0
				switch sel {
				case selector("fundCreatorFees(bytes32,uint32,uint256)"):
					if n.From != b.Vault {
						return ErrInput
					}
					bucket, _ := word(n.Input, 1)
					v, e := decimal(bucket)
					if e != nil || v != "1" {
						return ErrInput
					}
					w, _ := word(n.Input, 2)
					amount, e := decimal(w)
					if e != nil {
						return e
					}
					action.Kind = "fund"
					action.Amount = amount
					words = 3
				case selector("checkpointTransfer(bytes32,address,address,uint256)"):
					if n.From != c.Token {
						return ErrInput
					}
					f, _ := word(n.Input, 1)
					to, _ := word(n.Input, 2)
					v, _ := word(n.Input, 3)
					var e error
					action.From, e = addr(f)
					if e != nil {
						return e
					}
					action.To, e = addr(to)
					if e != nil {
						return e
					}
					action.Amount, e = decimal(v)
					if e != nil {
						return e
					}
					action.Kind = "transfer"
					words = 4
				case selector("checkpoint(bytes32)"):
					action.Kind = "checkpoint"
					words = 1
				case selector("claim(bytes32)"):
					if len(n.Output) != 66 || !strings.HasPrefix(n.Output, "0x") {
						return ErrInput
					}
					v, e := decimal(n.Output[2:])
					if e != nil {
						return e
					}
					action.Kind = "claim"
					action.Account = n.From
					action.Amount = v
					words = 1
				}
				if words > 0 {
					if n.Type != "CALL" || len(n.Input) != 10+64*words {
						return ErrInput
					}
					if e := c.Apply(action); e != nil {
						return e
					}
					count++
				}
			}
		}
		for _, child := range n.Calls {
			if e := walk(child); e != nil {
				return e
			}
		}
		return nil
	}
	if e := walk(t); e != nil {
		return 0, e
	}
	*l = *c
	return count, nil
}
