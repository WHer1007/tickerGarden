package readmodel

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/projection"
)

type registrationRows struct {
	pgx.Rows
	data [][]byte
	at   int
}

func (r *registrationRows) Next() bool { return r.at < len(r.data) }
func (r *registrationRows) Scan(dest ...any) error {
	*dest[0].(*[]byte) = r.data[r.at]
	r.at++
	return nil
}
func (r *registrationRows) Close()     {}
func (r *registrationRows) Err() error { return nil }

type registrationTx struct {
	pgx.Tx
	data [][]byte
}

func (tx registrationTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return &registrationRows{data: tx.data}, nil
}

func TestCandidateRegistrationPrepass(t *testing.T) {
	raw, e := os.ReadFile("../projection/testdata/golden.json")
	if e != nil {
		t.Fatal(e)
	}
	var fixtures []struct {
		Name  string
		Input projection.Input
	}
	if json.Unmarshal(raw, &fixtures) != nil {
		t.Fatal("fixture")
	}
	var registration, deposit projection.Input
	for _, f := range fixtures {
		if f.Name == "AssetRegistered" {
			registration = f.Input
		}
		if f.Name == "StockDeposited" {
			deposit = f.Input
		}
	}
	vault := "0x" + strings.Repeat("0", 39) + "9"
	registration.Log.Topics[3] = "0x" + strings.Repeat("0", 63) + "9"
	registration.Log.LogIndex = "0x2"
	deposit.Log.Address = vault
	deposit.Log.BlockNumber = registration.Log.BlockNumber
	deposit.Log.LogIndex = "0x1"
	for _, mode := range []string{"same block", "earlier block", "missing registration", "duplicate asset", "duplicate token", "shared vault"} {
		t.Run(mode, func(t *testing.T) {
			b := &candidateEmitterBindings{registry: registration.Log.Address, addresses: map[string]emitterBinding{registration.Log.Address: {module: registration.Module}}}
			encoded, _ := json.Marshal(registration.Log)
			data := [][]byte{encoded}
			if mode == "missing registration" {
				data = nil
			}
			if mode == "duplicate asset" {
				data = append(data, encoded)
			}
			if mode == "duplicate token" || mode == "shared vault" {
				other := registration.Log
				other.Topics = append([]string(nil), other.Topics...)
				other.Topics[1] = "0x" + strings.Repeat("7", 64)
				if mode == "shared vault" {
					other.Topics[2] = "0x" + strings.Repeat("0", 63) + "6"
				}
				encoded, _ := json.Marshal(other)
				data = append(data, encoded)
			}
			e := (&ObservationStore{ChainID: 46630}).bindCandidateRegistrations(context.Background(), registrationTx{data: data}, 10, b)
			if strings.HasPrefix(mode, "duplicate") {
				if e == nil {
					t.Fatal("duplicate accepted")
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			input := deposit
			if mode == "earlier block" {
				input.Log.BlockNumber = "0x9"
			}
			if e := b.check(input); (e == nil) != (mode == "same block" || mode == "shared vault") {
				t.Fatal(mode, e)
			}
		})
	}
}
