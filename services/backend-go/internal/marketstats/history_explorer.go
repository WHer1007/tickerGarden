package marketstats

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/readmodel"
	"time"
)

// Existing Growing markets can predate the local event cache. Read only one
// recent explorer page for this curve, then verify the candidate block through
// RPC. Explorer contents alone never become a buy record. No history scan or
// pagination is performed, and a missing candidate leaves lastBuy unknown.
func (s *Service) seedRecentCurve(ctx context.Context, v *State) {
	if s.Chain != 46630 || v.Phase != "0" || v.LastBuy != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, e := http.NewRequestWithContext(ctx, "GET", "https://explorer.testnet.chain.robinhood.com/api/v2/addresses/"+v.Curve+"/logs", nil)
	if e != nil {
		return
	}
	response, e := http.DefaultClient.Do(request)
	if e != nil {
		return
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return
	}
	var page struct {
		Items []struct {
			Address     struct{ Hash string }
			BlockNumber uint64 `json:"block_number"`
			Index       uint64
			Topics      []*string
		}
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&page) != nil || len(page.Items) > 100 {
		return
	}
	topic := deployment.Hash([]byte("CurveBuy(address,address,uint256,uint256,uint256,uint256)"))
	var block, index uint64
	for _, row := range page.Items {
		if !strings.EqualFold(row.Address.Hash, v.Curve) || row.BlockNumber > v.Cursor || len(row.Topics) == 0 || row.Topics[0] == nil || *row.Topics[0] != topic {
			continue
		}
		if row.BlockNumber > block || row.BlockNumber == block && row.Index > index {
			block, index = row.BlockNumber, row.Index
		}
	}
	if block == 0 {
		return
	}
	logs, e := s.RPC.ProjectLogs(ctx, []string{v.Curve}, []string{topic}, block, block)
	if e != nil {
		return
	}
	h, e := s.RPC.Header(ctx, fmt.Sprintf("0x%x", block))
	if e != nil {
		return
	}
	ts, e := h.Time()
	if e != nil {
		return
	}
	for _, l := range logs {
		li, _ := chainrpc.Quantity(l.LogIndex)
		if li != index {
			continue
		}
		if l.BlockHash != h.Hash {
			return
		}
		ti, _ := chainrpc.Quantity(l.TransactionIndex)
		buy := readmodel.LastBuyReadModel{BlockNumber: strconv.FormatUint(block, 10), TransactionIndex: strconv.FormatUint(ti, 10), LogIndex: strconv.FormatUint(li, 10), Timestamp: strconv.FormatUint(ts, 10)}
		v.LastBuy = &buy
		v.Buys = []BuyHistory{{Buy: buy, Hash: h.Hash}}
		return
	}
}
