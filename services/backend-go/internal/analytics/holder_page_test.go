package analytics

import (
	"errors"
	"fmt"
	"testing"
)

func TestHolderPagination(t *testing.T) {
	data := MarketHolders{MarketID: fmt.Sprintf("0x%064x", 1), SourceBlockNumber: "1", HolderBalances: HolderBalances{PositiveAddressCount: 205, Balances: []HolderBalance{}}}
	for i := 1; i <= 205; i++ {
		data.Balances = append(data.Balances, HolderBalance{Account: fmt.Sprintf("0x%040x", i), BalanceRaw: "1"})
	}
	cursor := ""
	seen := map[string]bool{}
	for _, size := range []int{100, 100, 5} {
		page, err := PageHolders(4663, data, 100, cursor)
		if err != nil || len(page.Balances) != size || page.PositiveAddressCount != 205 {
			t.Fatal(page, err)
		}
		for _, b := range page.Balances {
			if seen[b.Account] {
				t.Fatal("repeated account")
			}
			seen[b.Account] = true
		}
		if page.NextCursor != nil {
			cursor = *page.NextCursor
		} else if size != 5 {
			t.Fatal("early terminal page")
		}
	}
	if len(seen) != 205 {
		t.Fatal(len(seen))
	}
	first, _ := PageHolders(4663, data, 100, "")
	cursor = *first.NextCursor
	if _, err := PageHolders(46630, data, 100, cursor); !errors.Is(err, ErrHolderCursor) {
		t.Fatal(err)
	}
	if _, err := PageHolders(4663, data, 50, cursor); !errors.Is(err, ErrHolderCursor) {
		t.Fatal(err)
	}
	data.SourceBlockNumber = "2"
	if _, err := PageHolders(4663, data, 100, cursor); !errors.Is(err, ErrHolderPageChanged) {
		t.Fatal(err)
	}
	data.SourceBlockNumber = "1"
	data.Balances[0].BalanceRaw = "2"
	if _, err := PageHolders(4663, data, 100, cursor); !errors.Is(err, ErrHolderPageChanged) {
		t.Fatal(err)
	}
	for _, bad := range []string{"!", cursor + "="} {
		if _, err := PageHolders(4663, data, 100, bad); !errors.Is(err, ErrHolderCursor) {
			t.Fatal(err)
		}
	}
	empty, err := PageHolders(4663, MarketHolders{}, 100, "")
	if err != nil || empty.Balances == nil || len(empty.Balances) != 0 || empty.NextCursor != nil {
		t.Fatal(empty, err)
	}
}
