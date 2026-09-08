package deployment

import (
	"context"
	"fmt"
	"testing"
	"tickergarden/backend/internal/chainrpc"
)

type requestFixture struct {
	*feeFixture
	now, sourceTime uint64
	sourceReads     int
	lateReorg       bool
}

func (f *requestFixture) Header(_ context.Context, tag string) (chainrpc.Header, error) {
	h := chainrpc.Header{Number: tag, Hash: blockHash, Timestamp: fmt.Sprintf("0x%x", f.now)}
	if tag == "0x0" {
		f.sourceReads++
		h.Hash = genesisHash
		h.Timestamp = fmt.Sprintf("0x%x", f.sourceTime)
	} else if f.lateReorg && f.sourceReads >= 2 {
		h.Hash = genesisHash
	}
	return h, nil
}
func requestSetup(t *testing.T) (*requestFixture, chainrpc.Header, string, string, string) {
	base, b, markets, d := holderSetup(t)
	var id string
	for key := range markets {
		id = key
	}
	f := &requestFixture{feeFixture: base, now: 605100, sourceTime: 604950}
	for _, c := range f.manifest.Contracts {
		if c.Module == "MarketRegistryV1" {
			row := f.calls[c.Address+Hash([]byte("market(bytes32)"))[:10]+id[2:]]
			copy(row[12*32:13*32], addrWord(zero20))
		}
	}
	f.manifest.Contracts = append(f.manifest.Contracts, Contract{Module: "TreasuryDistributorV1", Address: d, RuntimeCodeHash: Hash(f.code[d])})
	b.Timestamp = fmt.Sprintf("0x%x", f.now)
	key := d + Hash([]byte("epoch(bytes32,uint32)"))[:10] + id[2:] + fmt.Sprintf("%064x", 1)
	row := f.calls[key]
	put := func(index int, value string) { copy(row[index*32:(index+1)*32], bytesWord(value)) }
	put(0, fmt.Sprintf("%x", 605000))
	put(1, fmt.Sprintf("%x", 605200))
	put(4, "0")
	put(6, "1")
	copy(row[7*32:8*32], addrWord(d))
	put(10, genesisHash)
	put(14, "0")
	f.calls[d+Hash([]byte("epochWindow(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 1)] = append(bytesWord("64"), bytesWord(fmt.Sprintf("%x", 604900))...)
	return f, b, id, d, key
}
func TestTreasuryRequestPinnedAndRejectsDrift(t *testing.T) {
	for _, name := range []string{"valid", "missing pin", "runtime", "status", "expired", "funding", "source time", "source hash", "late reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, id, d, key := requestSetup(t)
			switch name {
			case "missing pin":
				f.manifest.Contracts = f.manifest.Contracts[:len(f.manifest.Contracts)-1]
			case "runtime":
				f.code[d] = []byte{9}
			case "status":
				copy(f.calls[key][6*32:7*32], bytesWord("2"))
			case "expired":
				copy(f.calls[key][32:64], bytesWord(fmt.Sprintf("%x", 605050)))
			case "funding":
				f.calls[d+Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10]+id[2:]+fmt.Sprintf("%064x", 1)] = bytesWord("b")
			case "source time":
				f.sourceTime = 1
			case "source hash":
				copy(f.calls[key][10*32:11*32], bytesWord(blockHash))
			case "late reorg":
				f.lateReorg = true
			}
			got, e := ObserveTreasuryRequest(context.Background(), f, f.manifest, b, id, 1)
			if name == "valid" {
				if e != nil || got.SourceTimestamp != "604950" || got.Epoch["quoteAmount"] != "10" {
					t.Fatal(got, e)
				}
			} else if e == nil || got.BlockHash != "" {
				t.Fatal("invalid request accepted", got, e)
			}
		})
	}
}

func TestTreasuryClaimEpochAndReplayGuards(t *testing.T) {
	for _, name := range []string{"valid", "at deadline", "expired", "requested", "review", "rolled", "bad root", "bad dataset", "zero leaves", "overclaimed", "bad finalize", "funding", "runtime", "late reorg", "bitmap claimed", "account claimed", "bad bool", "claim reorg"} {
		t.Run(name, func(t *testing.T) {
			f, b, id, d, key := requestSetup(t)
			put := func(index int, value string) { copy(f.calls[key][index*32:(index+1)*32], bytesWord(value)) }
			put(6, "3")
			put(2, fmt.Sprintf("%x", 605050))
			put(3, fmt.Sprintf("%x", 605150))
			put(5, "1")
			put(11, blockHash)
			put(12, genesisHash)
			put(15, "64")
			put(14, "3")
			args := id[2:] + fmt.Sprintf("%064x", 1)
			account := d // RPC guard is address-neutral; service rejects distributor beneficiaries.
			bitmap := d + Hash([]byte("isClaimed(bytes32,uint32,uint256)"))[:10] + args + fmt.Sprintf("%064x", 0)
			accountKey := d + Hash([]byte("accountClaimed(bytes32,uint32,address)"))[:10] + args + fmt.Sprintf("%064s", account[2:])
			f.calls[bitmap] = bytesWord("0")
			f.calls[accountKey] = bytesWord("0")
			switch name {
			case "at deadline":
				put(3, fmt.Sprintf("%x", f.now))
			case "expired":
				put(3, fmt.Sprintf("%x", f.now-1))
			case "requested":
				put(6, "1")
			case "review":
				put(6, "2")
			case "rolled":
				put(6, "4")
			case "bad root":
				put(11, "0")
			case "bad dataset":
				put(12, "0")
			case "zero leaves":
				put(5, "0")
			case "overclaimed":
				put(14, "b")
			case "bad finalize":
				put(2, fmt.Sprintf("%x", f.now+1))
			case "funding":
				f.calls[d+Hash([]byte("epochQuoteAmount(bytes32,uint32)"))[:10]+args] = bytesWord("b")
			case "runtime":
				f.code[d] = []byte{9}
			case "late reorg":
				f.lateReorg = true
			case "bitmap claimed":
				f.calls[bitmap] = bytesWord("1")
			case "account claimed":
				f.calls[accountKey] = bytesWord("1")
			case "bad bool":
				f.calls[accountKey] = bytesWord("2")
			}
			got, err := ObserveTreasuryClaimEpoch(context.Background(), f, f.manifest, b, id, 1)
			valid := name == "valid" || name == "at deadline" || name == "bitmap claimed" || name == "account claimed" || name == "bad bool" || name == "claim reorg"
			if !valid {
				if err == nil || got.BlockHash != "" {
					t.Fatal("invalid claim epoch accepted", name, got, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if name == "claim reorg" {
				f.lateReorg = true
			}
			consumed, err := TreasuryClaimConsumed(context.Background(), f, b, d, id, 1, 0, account)
			if name == "bad bool" || name == "claim reorg" {
				if err == nil {
					t.Fatal("invalid guard accepted")
				}
				return
			}
			if err != nil || consumed != (name == "bitmap claimed" || name == "account claimed") {
				t.Fatal(consumed, err)
			}
		})
	}
}
