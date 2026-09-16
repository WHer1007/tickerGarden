package displayprice

import (
	"context"
	"net/url"
)

func (b *batch) price(ctx context.Context, p Provider, symbol string) (quote, string) {
	var quotes []quote
	var err error
	if b.bulk {
		b.pricesOnce.Do(func() {
			var response struct {
				Quotes []quote `json:"quotes"`
			}
			b.pricesErr = p.get(ctx, "/prices", &response)
			b.quotes = response.Quotes
			if b.pricesErr == nil && (b.quotes == nil || len(b.quotes) > 1024) {
				b.pricesErr = errData
			}
		})
		quotes, err = b.quotes, b.pricesErr
	} else {
		if err = b.waitQuote(ctx); err != nil {
			return quote{}, failureReason("prices", requestFailure(ctx, err))
		}
		var response struct {
			Quotes []quote `json:"quotes"`
		}
		err = p.get(ctx, "/prices/"+url.PathEscape(symbol), &response)
		quotes = response.Quotes
	}
	if err != nil {
		return quote{}, failureReason("prices", err)
	}
	if !b.bulk {
		if len(quotes) != 1 {
			return quote{}, "quote_missing"
		}
		return quotes[0], ""
	}
	var selected quote
	count := 0
	for _, q := range quotes {
		if q.Symbol == symbol {
			selected = q
			count++
		}
	}
	if count != 1 {
		return quote{}, "quote_missing"
	}
	return selected, ""
}
