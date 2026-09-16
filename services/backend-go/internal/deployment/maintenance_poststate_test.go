package deployment

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"tickergarden/backend/internal/chainrpc"
)

func poststateBase(t *testing.T, op string) (*maintenanceFixture, chainrpc.Header, MaintenanceRequest, string) {
	t.Helper()
	base, b, markets, _, curve := businessFixture(t)
	id := ""
	for k := range markets {
		id = k
	}
	target := curve
	r := MaintenanceRequest{Operation: op, MarketID: id, TriggerID: wordHex("1")}
	if op == "checkpoint" || op == "flush-forfeiture" || op == "settle-rage-quit" {
		var market MarketDiscovery
		var user string
		base, b, market, user, _ = gaugeFixture(t)
		id, target = market.MarketID, market.State["gauge"].(string)
		r.MarketID = id
		if op == "settle-rage-quit" {
			r.User = user
			for _, c := range base.manifest.Contracts {
				if c.Module == "AllocationManager" {
					target = c.Address
				}
			}
		}
	}
	b.Timestamp = "0x" + strconv.FormatInt(time.Now().Unix(), 16)
	return &maintenanceFixture{discoveryFixture: base, timestamp: b.Timestamp}, b, r, target
}

func TestObserveMaintenancePoststateOperations(t *testing.T) {
	for _, op := range []string{"sweep", "flush-forfeiture", "settle-rage-quit"} {
		t.Run(op, func(t *testing.T) {
			f, b, r, target := poststateBase(t, op)
			key := func(sig, args string) string { return target + Hash([]byte(sig))[:10] + args }
			switch op {
			case "sweep":
				f.calls[key("accruedCurveFees()", "")] = bytesWord("0")
			case "flush-forfeiture":
				f.calls[key("deferredForfeiture()", "")] = append(bytesWord("0"), bytesWord("0")...)
			case "settle-rage-quit":
				f.calls[key("rageQuitSettlementPending(bytes32,address)", r.MarketID[2:]+addressArgument(r.User))] = append(bytesWord("0"), bytesWord("0")...)
			}
			got, err := ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
			if err != nil || !got.Satisfied || got.Target != target {
				t.Fatal(got, err)
			}
			if op == "sweep" {
				f.calls[key("accruedCurveFees()", "")] = bytesWord("1")
				got, err = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
				if err != nil || got.Satisfied {
					t.Fatal("nonzero fees reported satisfied", got, err)
				}
			}
			if _, err = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target+"0"); err == nil {
				t.Fatal("accepted expected target mismatch")
			}
		})
	}
}

func TestObserveMaintenancePoststateCheckpointAndFailures(t *testing.T) {
	f, b, r, target := poststateBase(t, "checkpoint")
	for i := 0; i < 32; i++ {
		f.calls[target+Hash([]byte("activationSlot(uint8)"))[:10]+fmt.Sprintf("%064x", i)] = append(append(bytesWord("0"), bytesWord("0")...), bytesWord("0")...)
	}
	got, err := ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
	if err != nil || !got.Satisfied || len(got.Values) != 32 {
		t.Fatal(got, err)
	}
	f.calls[target+Hash([]byte("activationSlot(uint8)"))[:10]+fmt.Sprintf("%064x", 0)] = append(append(bytesWord("1"), bytesWord("2")...), bytesWord("3")...)
	got, err = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
	if err != nil || got.Satisfied {
		t.Fatal("matured slot should be unsatisfied", got, err)
	}
	f.reorg, f.simulated = true, true
	if _, err = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target); err == nil {
		t.Fatal("accepted reorg")
	}
}

func TestMaintenancePoststateUnmetAndInvalidState(t *testing.T) {
	for _, op := range []string{"flush-forfeiture", "settle-rage-quit"} {
		f, b, r, target := poststateBase(t, op)
		var sig, args string
		var raw []byte
		switch op {
		case "flush-forfeiture":
			sig = "deferredForfeiture()"
			raw = append(bytesWord("1"), bytesWord("0")...)
		case "settle-rage-quit":
			sig = "rageQuitSettlementPending(bytes32,address)"
			args = r.MarketID[2:] + addressArgument(r.User)
			raw = append(bytesWord("1"), bytesWord("1")...)
		}
		call := target + Hash([]byte(sig))[:10] + args
		f.calls[call] = raw
		got, e := ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
		if e != nil || got.Satisfied {
			t.Fatalf("%s unmet: %#v %v", op, got, e)
		}
	}
}
func TestMaintenancePoststateFutureAndInvalidActivationSlots(t *testing.T) {
	f, b, r, target := poststateBase(t, "checkpoint")
	for i := 0; i < 32; i++ {
		f.calls[target+Hash([]byte("activationSlot(uint8)"))[:10]+fmt.Sprintf("%064x", i)] = make([]byte, 96)
	}
	key := target + Hash([]byte("activationSlot(uint8)"))[:10] + fmt.Sprintf("%064x", 31)
	timestamp, _ := b.Time()
	f.calls[key] = append(append(bytesWord(strconv.FormatUint(timestamp+1, 16)), bytesWord("2")...), bytesWord("1")...)
	got, e := ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target)
	if e != nil || !got.Satisfied {
		t.Fatal("future activation should remain pending", got, e)
	}
	for _, raw := range [][]byte{append(append(bytesWord("0"), bytesWord("1")...), bytesWord("0")...), append(append(bytesWord("1"), bytesWord("0")...), bytesWord("1")...)} {
		f.calls[key] = raw
		if _, e = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target); e == nil {
			t.Fatal("invalid slot accepted")
		}
	}
	delete(f.calls, key)
	if _, e = ObserveMaintenancePoststate(context.Background(), f, f.manifest, b, r, target); e == nil {
		t.Fatal("missing slot accepted")
	}
}
