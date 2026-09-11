package marketstats

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"tickergarden/backend/internal/readmodel"
	"time"
)

func (s *Service) advance(ctx context.Context, v State, h chainrpc.Header, head uint64) (State, error) {
	if v.Cursor == head && v.Hash == h.Hash {
		s.calculate(&v, time.Now())
		return v, nil
	}
	// Re-check the last range anchor, not every historical block. A replaced
	// display window is invalidated, never passed off as financially finalized.
	old, err := s.RPC.Header(ctx, fmt.Sprintf("0x%x", v.Cursor))
	if err != nil {
		return v, err
	}
	if old.Hash != v.Hash || head < v.Cursor {
		// Do not keep an orphaned buy or price. Reinitialize only the affected market.
		fresh, e := s.initialize(ctx, v.MarketID, h)
		if e != nil {
			return fresh, e
		}
		// Restore the newest retained buy still present on the canonical branch.
		for i := len(v.Buys) - 1; i >= 0; i-- {
			buy := v.Buys[i]
			n, _ := strconv.ParseUint(buy.Buy.BlockNumber, 10, 64)
			if n > head {
				continue
			}
			block, err := s.RPC.Header(ctx, fmt.Sprintf("0x%x", n))
			if err != nil {
				return fresh, err
			}
			if block.Hash == buy.Hash {
				copy := buy.Buy
				fresh.LastBuy = &copy
				fresh.Buys = append([]BuyHistory{}, v.Buys[:i+1]...)
				break
			}
		}
		from := uint64(0)
		if head > 128 {
			from = head - 128
		}
		anchor, e := s.RPC.Header(ctx, fmt.Sprintf("0x%x", from))
		if e != nil {
			return fresh, e
		}
		fresh.Cursor = from
		fresh.Hash = anchor.Hash
		return s.advance(ctx, fresh, h, head)
	}
	end := min(v.Cursor+512, head)
	target := h
	if end != head {
		target, err = s.RPC.Header(ctx, fmt.Sprintf("0x%x", end))
		if err != nil {
			return v, err
		}
	}
	topics := []string{deployment.Hash([]byte("CurveBuy(address,address,uint256,uint256,uint256,uint256)")), deployment.Hash([]byte("CurveSell(address,address,uint256,uint256,uint256,uint256)")), deployment.Hash([]byte("CurveCompleted(bytes32)")), deployment.Hash([]byte("Transfer(address,address,uint256)"))}
	logs := []chainrpc.Log{}
	if v.Phase != "1" {
		logs, err = s.RPC.ProjectLogs(ctx, []string{v.Curve}, topics[:3], v.Cursor+1, end)
		if err != nil {
			return v, err
		}
	}
	burns, e := s.RPC.BurnLogs(ctx, v.Token, deployment.Hash([]byte("Transfer(address,address,uint256)")), v.Cursor+1, end)
	if e != nil {
		return v, e
	}
	logs = append(logs, burns...)
	for _, l := range logs {
		if l.Address == v.Curve && len(l.Topics) > 0 && l.Topics[0] == deployment.Hash([]byte("CurveCompleted(bytes32)")) {
			m, e := deployment.ReadDisplayMarket(ctx, s.RPC, s.Registry, v.MarketID, target.Hash)
			if e != nil {
				return v, e
			}
			v.Pool = m["poolId"].(string)
			v.Phase = m["launchPhase"].(string)
			// Authenticate the newly activated pool with the scoped relay before
			// asking that shared PoolManager for its Swap logs.
			block, e := chainrpc.Quantity(l.BlockNumber)
			if e != nil {
				return v, e
			}
			bindings, e := s.RPC.ProjectLogs(ctx, []string{v.Hook}, []string{deployment.Hash([]byte("PoolBindingActivated(bytes32,bytes32,uint32)"))}, block, block)
			if e != nil {
				return v, e
			}
			bound := false
			for _, binding := range bindings {
				if len(binding.Topics) > 2 && binding.Topics[1] == v.MarketID && binding.Topics[2] == v.Pool {
					bound = true
				}
			}
			if !bound {
				return v, errors.New("graduation pool binding unavailable")
			}
			break
		}
	}
	if v.Phase == "1" {
		poolLogs, e := s.RPC.PoolLogs(ctx, v.Manager, []string{deployment.Hash([]byte(swap))}, []string{v.Pool}, v.Cursor+1, end)
		if e != nil {
			return v, e
		}
		logs = append(logs, poolLogs...)
	}
	sort.Slice(logs, func(i, j int) bool {
		a, _ := chainrpc.Quantity(logs[i].BlockNumber)
		b, _ := chainrpc.Quantity(logs[j].BlockNumber)
		if a != b {
			return a < b
		}
		a, _ = chainrpc.Quantity(logs[i].LogIndex)
		b, _ = chainrpc.Quantity(logs[j].LogIndex)
		return a < b
	})
	dirty := false
	// Resolve timestamps only for blocks containing buys, shared within this range.
	headers := map[string]chainrpc.Header{target.Number: target}
	for _, l := range logs {
		module := "TickerGardenCurve"
		if l.Address == v.Token {
			module = "TickerMemeTokenV1"
		}
		if l.Address == v.Manager {
			module = "UniswapV4PoolManager"
		}
		event, e := events.Decode(module, l)
		if e != nil {
			return v, e
		}
		buy := false
		switch event.Signature {
		case "CurveBuy(address,address,uint256,uint256,uint256,uint256)":
			dirty = true
			buy = true
		case "CurveSell(address,address,uint256,uint256,uint256,uint256)":
			dirty = true
		case "CurveCompleted(bytes32)":
			dirty = true
		case "Transfer(address,address,uint256)":
			if event.Args["from"] == zero || event.Args["to"] == zero {
				dirty = true
			}
		case swap:
			dirty = true
			// Internal reward conversions are sells. Explicitly reject Hook-originated
			// executions as well, rather than ranking protocol housekeeping as user buys.
			if event.Args["sender"] != v.Hook {
				field := "amount0"
				if v.Token > v.Quote {
					field = "amount1"
				}
				amount, ok := new(big.Int).SetString(event.Args[field].(string), 10)
				buy = ok && amount.Sign() > 0
			}
		}
		if buy {
			b, ok := headers[l.BlockNumber]
			if !ok {
				b, e = s.RPC.Header(ctx, l.BlockNumber)
				if e != nil {
					return v, e
				}
				headers[l.BlockNumber] = b
			}
			if b.Hash != l.BlockHash {
				return v, errors.New("buy block replaced")
			}
			n, _ := chainrpc.Quantity(l.BlockNumber)
			ti, _ := chainrpc.Quantity(l.TransactionIndex)
			li, _ := chainrpc.Quantity(l.LogIndex)
			ts, _ := b.Time()
			v.LastBuy = &readmodel.LastBuyReadModel{BlockNumber: strconv.FormatUint(n, 10), TransactionIndex: strconv.FormatUint(ti, 10), LogIndex: strconv.FormatUint(li, 10), Timestamp: strconv.FormatUint(ts, 10)}
			v.Buys = append(append([]BuyHistory{}, v.Buys...), BuyHistory{*v.LastBuy, l.BlockHash})
			if len(v.Buys) > 128 {
				v.Buys = v.Buys[len(v.Buys)-128:]
			}
		}
	}
	if dirty {
		if err = s.readState(ctx, &v, target); err != nil {
			return v, err
		}
	}
	// Commit the range only after all dependent reads succeed. Empty ranges advance
	// without state calls and are not requested again on the next tick.
	v.Cursor = end
	v.Hash = target.Hash
	v.ObservedAt = time.Now().Unix()
	s.calculate(&v, time.Now())
	return v, nil
}
