package marketstats

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/events"
	"time"
)

// A bounded, display-only explorer index query selects actual project logs.
// Never scan unrelated blocks or pools. Full pages continue with bounded pagination;
// errors or repeated pages fail closed rather than silently truncating volume. Cache cadence is the existing 20-minute worker.
func (s *Service) volume(ctx context.Context, v State) (string, error) {
	if s.Chain != 46630 || s.Pool == nil {
		return "", errors.New("volume index unavailable")
	}
	var created uint64
	var trackHolders bool
	err := s.Pool.QueryRow(ctx, `SELECT min(e.block_number), EXISTS(SELECT 1 FROM tickergarden.demand_event_records r JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE d.chain_id=$1 AND d.config->'modules'->>$3='MarketRegistryV1' AND r.block_number<=d.processed_through AND r.payload->'event'->'args'->>'marketId'=$2 AND r.payload->'event'->>'signature' IN ('HolderStreamMarketRegistered(bytes32,address,address,address)','TreasuryMarketRegistered(bytes32,address,address,bytes32)')) FROM tickergarden.demand_event_records e JOIN tickergarden.demand_event_scopes d USING(scope_id) WHERE d.chain_id=$1 AND e.block_number<=d.processed_through AND e.payload->'event'->>'signature'='MarketCreated(bytes32,bytes32,address,address,address,address,bytes32,bytes32,bytes32)' AND e.payload->'event'->'args'->>'marketId'=$2`, s.Chain, v.MarketID, s.Registry).Scan(&created, &trackHolders)
	if err != nil {
		return "", err
	}
	from := created
	var through uint64
	var hash string
	if s.Pool.QueryRow(ctx, `SELECT through_block,block_hash FROM tickergarden.market_volume_cursors WHERE chain_id=$1 AND registry=$2 AND market_id=$3 AND version=2`, s.Chain, s.Registry, v.MarketID).Scan(&through, &hash) == nil && through <= v.Cursor {
		h, err := s.RPC.Header(ctx, fmt.Sprintf("0x%x", through))
		if err != nil {
			return "", err
		}
		if h.Hash == hash {
			from = created
			if through > 512 && through-512 > created {
				from = through - 512
			}
		}
	}
	type fact struct {
		log               volumeLog
		number, ts, index uint64
		amount            string
		fee               *string
	}
	facts := []fact{}
	type transfer struct {
		number, index  uint64
		hash, from, to string
	}
	transfers := []transfer{}
	seen := map[string]bool{}
	cutoff := time.Now().Unix() - 86400
	fetch := func(address, topic, pool, module string) error {
		q := url.Values{"module": {"logs"}, "action": {"getLogs"}, "fromBlock": {strconv.FormatUint(from, 10)}, "toBlock": {strconv.FormatUint(v.Cursor, 10)}, "address": {address}, "topic0": {topic}, "page": {"1"}, "offset": {"1000"}}
		if pool != "" {
			q.Set("topic1", pool)
			q.Set("topic0_1_opr", "and")
		}
		return eachVolumePage(ctx, http.DefaultClient, "https://explorer.testnet.chain.robinhood.com/api", q, func(logs []volumeLog) error {
			for _, l := range logs {
				for len(l.Topics) > 0 && l.Topics[len(l.Topics)-1] == "" {
					l.Topics = l.Topics[:len(l.Topics)-1]
				}
				n, e := chainrpc.Quantity(l.BlockNumber)
				if e != nil || n < from || n > v.Cursor || strings.ToLower(l.Address) != address || len(l.Topics) == 0 || l.Topics[0] != topic {
					return errors.New("volume log scope mismatch")
				}
				if pool != "" && (len(l.Topics) < 2 || l.Topics[1] != pool) {
					return errors.New("unrelated pool volume")
				}
				ts, e := chainrpc.Quantity(l.TimeStamp)
				if e != nil {
					return e
				}

				key := l.TransactionHash + ":" + l.LogIndex
				if seen[key] {
					continue
				}
				seen[key] = true
				ev, e := events.Decode(module, chainrpc.Log{Address: strings.ToLower(l.Address), Topics: l.Topics, Data: l.Data, BlockNumber: l.BlockNumber, BlockHash: l.BlockHash, TransactionHash: l.TransactionHash, TransactionIndex: l.TransactionIndex, LogIndex: l.LogIndex})
				if e != nil {
					return e
				}
				if module == "TickerMemeTokenV1" {
					fromAddress, ok := ev.Args["from"].(string)
					toAddress, valid := ev.Args["to"].(string)
					index, err := chainrpc.Quantity(l.LogIndex)
					if !ok || !valid || len(fromAddress) != 42 || len(toAddress) != 42 || err != nil {
						return errors.New("invalid token transfer")
					}
					transfers = append(transfers, transfer{n, index, l.TransactionHash, fromAddress, toAddress})
					continue
				}
				field := "quoteIn"
				if strings.HasPrefix(ev.Signature, "CurveSell(") {
					field = "quoteOut"
				}
				if module == "UniswapV4PoolManager" {
					if ev.Args["sender"] == v.Hook {
						continue
					}
					field = "amount0"
					if v.Quote > v.Token {
						field = "amount1"
					}
				}
				amount, e := volumeAmount(ev.Signature, ev.Args, field)
				if e != nil {
					return e
				}
				index, err := chainrpc.Quantity(l.LogIndex)
				if err != nil {
					return err
				}
				var fee *string
				if module == "TickerGardenCurve" {
					base, err := checkedVolumeInt(ev.Args, "fee")
					if err != nil {
						return err
					}
					tax, err := checkedVolumeInt(ev.Args, "tax")
					if err != nil {
						return err
					}
					value := new(big.Int).Add(base, tax).String()
					fee = &value
				}
				facts = append(facts, fact{l, n, ts, index, amount.String(), fee})
			}
			return nil
		})
	}
	if from <= v.Cursor {
		for _, signature := range []string{"CurveBuy(address,address,uint256,uint256,uint256,uint256)", "CurveSell(address,address,uint256,uint256,uint256,uint256)"} {
			if err = fetch(v.Curve, deployment.Hash([]byte(signature)), "", "TickerGardenCurve"); err != nil {
				return "", err
			}
		}
		if trackHolders {
			if err = fetch(v.Token, deployment.Hash([]byte("Transfer(address,address,uint256)")), "", "TickerMemeTokenV1"); err != nil {
				return "", err
			}
		}
		if v.Phase == "1" {
			if err = fetch(v.Manager, deployment.Hash([]byte(swap)), v.Pool, "UniswapV4PoolManager"); err != nil {
				return "", err
			}
		}
	}
	h, err := s.RPC.Header(ctx, fmt.Sprintf("0x%x", v.Cursor))
	if err != nil {
		return "", err
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	// A bounded recent overlap tolerates index lag; old history is not reread.
	// Cursor and facts commit together. A changed checkpoint hash rebuilds only this market.
	if _, err = tx.Exec(ctx, `DELETE FROM tickergarden.market_volume_events WHERE chain_id=$1 AND registry=$2 AND market_id=$3 AND block_number>=$4`, s.Chain, s.Registry, v.MarketID, from); err != nil {
		return "", err
	}
	for _, f := range facts {
		if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.market_volume_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, s.Chain, s.Registry, v.MarketID, f.number, f.log.BlockHash, f.log.TransactionHash, f.index, f.ts, f.amount, f.fee); err != nil {
			return "", err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM tickergarden.market_transfer_events WHERE chain_id=$1 AND registry=$2 AND market_id=$3 AND block_number>=$4`, s.Chain, s.Registry, v.MarketID, from); err != nil {
		return "", err
	}
	for _, t := range transfers {
		if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.market_transfer_events VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, s.Chain, s.Registry, v.MarketID, t.number, t.hash, t.index, t.from, t.to); err != nil {
			return "", err
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO tickergarden.market_volume_cursors VALUES($1,$2,$3,$4,$5,2) ON CONFLICT(chain_id,registry,market_id) DO UPDATE SET through_block=excluded.through_block,block_hash=excluded.block_hash,version=2`, s.Chain, s.Registry, v.MarketID, v.Cursor, h.Hash); err != nil {
		return "", err
	}
	var total string
	if err = tx.QueryRow(ctx, `SELECT COALESCE(sum(amount),0)::text FROM tickergarden.market_volume_events WHERE chain_id=$1 AND registry=$2 AND market_id=$3 AND block_time>=$4`, s.Chain, s.Registry, v.MarketID, cutoff).Scan(&total); err != nil {
		return "", err
	}
	return total, tx.Commit(ctx)
}

func checkedVolumeInt(args map[string]any, key string) (*big.Int, error) {
	raw, ok := args[key].(string)
	if !ok {
		return nil, errors.New("invalid volume amount")
	}
	n, valid := new(big.Int).SetString(raw, 10)
	if !valid || n.Sign() < 0 {
		return nil, errors.New("invalid volume amount")
	}
	return n, nil
}

func volumeAmount(signature string, args map[string]any, poolField string) (*big.Int, error) {
	if poolField == "amount0" || poolField == "amount1" {
		raw, ok := args[poolField].(string)
		n, valid := new(big.Int).SetString(raw, 10)
		if !ok || !valid {
			return nil, errors.New("invalid volume amount")
		}
		return new(big.Int).Abs(n), nil
	}
	baseField := "quoteIn"
	if strings.HasPrefix(signature, "CurveSell(") {
		baseField = "quoteOut"
	}
	base, err := checkedVolumeInt(args, baseField)
	if err != nil {
		return nil, err
	}
	fee, err := checkedVolumeInt(args, "fee")
	if err != nil {
		return nil, err
	}
	tax, err := checkedVolumeInt(args, "tax")
	if err != nil {
		return nil, err
	}
	amount := new(big.Int)
	if baseField == "quoteIn" {
		amount.Sub(base, fee)
		amount.Sub(amount, tax)
		if amount.Sign() < 0 {
			return nil, errors.New("invalid volume amount")
		}
		return amount, nil
	}
	return amount.Add(base, fee).Add(amount, tax), nil
}

// The context bounds the complete scan. Repeated full pages indicate an index
// ignoring pagination, and must never be counted as complete coverage.
type volumeLog struct {
	Address, Data, BlockNumber, BlockHash, TransactionHash, TransactionIndex, LogIndex, TimeStamp string
	Topics                                                                                        []string
}

func eachVolumePage(ctx context.Context, client *http.Client, endpoint string, q url.Values, consume func([]volumeLog) error) error {
	seenPages := map[string]bool{}
	for page := 1; page <= 100; page++ {
		q.Set("page", strconv.Itoa(page))
		req, e := http.NewRequestWithContext(ctx, "GET", endpoint+"?"+q.Encode(), nil)
		if e != nil {
			return e
		}
		resp, e := client.Do(req)
		if e != nil {
			return e
		}
		var body struct {
			Status, Message string
			Result          json.RawMessage
		}
		e = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body)
		resp.Body.Close()
		if resp.StatusCode != 200 || e != nil {
			return errors.New("volume index response")
		}
		var logs []volumeLog
		if json.Unmarshal(body.Result, &logs) != nil || len(logs) > 1000 {
			return errors.New("volume coverage incomplete")
		}
		if body.Status != "1" && !(body.Status == "0" && len(logs) == 0 && strings.EqualFold(body.Message, "No logs found")) {
			return errors.New("invalid indexed logs")
		}
		fingerprint := deployment.Hash(body.Result)
		if len(logs) > 0 && seenPages[fingerprint] {
			return errors.New("repeated volume page")
		}
		seenPages[fingerprint] = true
		if e = consume(logs); e != nil {
			return e
		}
		if len(logs) < 1000 {
			return nil
		}
	}
	return errors.New("volume pagination budget exceeded")
}
