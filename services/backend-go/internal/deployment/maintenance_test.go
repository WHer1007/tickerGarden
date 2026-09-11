package deployment

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
)

type maintenanceFixture struct {
	*discoveryFixture
	timestamp                  string
	simulated                  bool
	reorg                      bool
	result                     []byte
	simulationError            bool
	wantFrom, wantTo, wantData string
}

func (f *maintenanceFixture) Header(ctx context.Context, tag string) (chainrpc.Header, error) {
	h, e := f.discoveryFixture.Header(ctx, tag)
	h.Timestamp = f.timestamp
	if f.simulated && f.reorg {
		h.Hash = genesisHash
	}
	return h, e
}
func (f *maintenanceFixture) SimulateAt(_ context.Context, from, to, data, hash string) ([]byte, error) {
	if from != f.wantFrom || to != f.wantTo || data != f.wantData || hash != blockHash {
		return nil, errors.New("wrong simulation request")
	}
	f.simulated = true
	if f.simulationError {
		return nil, errors.New("secret provider URL")
	}
	return f.result, nil
}
func TestMaintenancePreviewAuthenticatesAndSimulates(t *testing.T) {
	for _, name := range []string{"success", "revert", "bad-return", "reorg", "unmanifested", "bad-runtime", "stale", "future", "reverse"} {
		t.Run(name, func(t *testing.T) {
			base, b, markets, _, curve := businessFixture(t)
			id := ""
			for key := range markets {
				id = key
			}
			from := "0x" + strings.Repeat("e", 40)
			timestamp := time.Now().Unix()
			if name == "stale" {
				timestamp -= 121
			}
			if name == "future" {
				timestamp += 60
			}
			b.Timestamp = "0x" + strconv.FormatInt(timestamp, 16)
			f := &maintenanceFixture{discoveryFixture: base, timestamp: b.Timestamp, result: bytesWord("7"), wantFrom: from, wantTo: curve, wantData: Hash([]byte("sweepCurveFees()"))[:10]}
			r := MaintenanceRequest{Operation: "sweep", MarketID: id, TriggerID: wordHex("1")}
			switch name {
			case "revert":
				f.simulationError = true
			case "bad-return":
				f.result = []byte{1}
			case "reorg":
				f.reorg = true
			case "unmanifested":
				for i, c := range f.manifest.Contracts {
					if c.Address == curve {
						f.manifest.Contracts = append(f.manifest.Contracts[:i], f.manifest.Contracts[i+1:]...)
						break
					}
				}
			case "bad-runtime":
				f.code[curve] = []byte{255}
			case "reverse":
				for key := range f.calls {
					if strings.Contains(key, Hash([]byte("marketIdByToken(address)"))[:10]) {
						f.calls[key] = make([]byte, 32)
					}
				}
			}
			got, err := PreviewMaintenance(context.Background(), f, f.manifest, b, from, r)
			if name != "success" {
				if err == nil || got.Status != "" {
					t.Fatal("accepted invalid preview", got, err)
				}
				if strings.Contains(err.Error(), "secret") {
					t.Fatal("leaked RPC error")
				}
				if (name == "unmanifested" || name == "bad-runtime" || name == "stale" || name == "future" || name == "reverse") && f.simulated {
					t.Fatal("simulated before authentication")
				}
				return
			}
			if err != nil || !f.simulated || got.Status != "simulated" || got.ReturnValues["sweptAmount"] != "7" || got.ExecutionComplete || got.TransactionSubmission || got.Value != "0x0" {
				t.Fatal(got, err)
			}
			f.simulated = false
			again, err := PreviewMaintenance(context.Background(), f, f.manifest, b, from, r)
			if err != nil || again.Key != got.Key {
				t.Fatal("unstable request key", err)
			}
			r.TriggerID = wordHex("2")
			f.simulated = false
			other, err := PreviewMaintenance(context.Background(), f, f.manifest, b, from, r)
			if err != nil || other.Key == got.Key {
				t.Fatal("trigger collision", err)
			}
		})
	}
}

func TestMaintenancePreviewResolvesTargets(t *testing.T) {
	for _, op := range []string{"checkpoint", "flush-forfeiture", "settle-rage-quit"} {
		t.Run(op, func(t *testing.T) {
			base, b, market, user, _ := gaugeFixture(t)
			b.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
			target := market.State["gauge"].(string)
			r := MaintenanceRequest{Operation: op, MarketID: market.MarketID, TriggerID: wordHex("1")}
			var raw []byte
			if op == "checkpoint" {
				raw = append(bytesWord("4"), bytesWord("1")...)
			}
			roots := map[string]string{}
			for _, c := range base.manifest.Contracts {
				roots[c.Module] = c.Address
			}
			if op == "settle-rage-quit" {
				target = roots["AllocationManager"]
				r.User = user
				raw = append(append(bytesWord("7"), bytesWord("9")...), bytesWord("1")...)
			}
			_, signature, args, _, err := maintenanceAction(r)
			if err != nil {
				t.Fatal(err)
			}
			f := &maintenanceFixture{discoveryFixture: base, timestamp: b.Timestamp, result: raw, wantFrom: user, wantTo: target, wantData: Hash([]byte(signature))[:10] + args}
			got, err := PreviewMaintenance(context.Background(), f, f.manifest, b, user, r)
			if err != nil || got.To != target || !f.simulated {
				t.Fatal(got, err)
			}
		})
	}
}
