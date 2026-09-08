package settlement

import (
	"context"
	"strings"
	"testing"
)

// Called from the existing signed execution PostgreSQL fixture (synthetic and
// real local EVM variants), so no weakened replacement schema is used.
func checkReservationRelease(t *testing.T, ctx context.Context, s Store, scope WorkScope, key string, r ReceiptRecord, rpc ReceiptRPC) {
	t.Helper()
	bad := r
	bad.Digest = strings.Repeat("0", 64)
	if e := s.releaseReservation(ctx, rpc, scope, key, bad); e == nil {
		t.Fatal("wrong receipt digest released gas hold")
	}
	wrong := scope
	wrong.Operator = "0x" + strings.Repeat("f", 40)
	if e := s.releaseReservation(ctx, rpc, wrong, key, r); e == nil {
		t.Fatal("wrong account released gas hold")
	}
	for i := 0; i < 2; i++ {
		if e := s.releaseReservation(ctx, rpc, scope, key, r); e != nil {
			t.Fatal("reservation release", e)
		}
	}
	var count int
	if e := s.Pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.settlement_reservation_releases WHERE job_key=$1`, key).Scan(&count); e != nil || count != 1 {
		t.Fatal("release not idempotent", e)
	}
	var held string
	if e := s.Pool.QueryRow(ctx, `SELECT COALESCE(sum(maximum_gas_cost),0)::text FROM tickergarden.settlement_intents i WHERE job_key=$1 AND NOT EXISTS (SELECT 1 FROM tickergarden.settlement_reservation_releases r WHERE r.job_key=i.job_key)`, key).Scan(&held); e != nil || held != "0" {
		t.Fatal("finalized gas hold remains", e)
	}
	var retained int
	if e := s.Pool.QueryRow(ctx, `SELECT count(*) FROM tickergarden.settlement_intents WHERE job_key=$1`, key).Scan(&retained); e != nil || retained != 1 {
		t.Fatal("intent destroyed", e)
	}
	t.Log("reservation: digest/account rejection, idempotent release, zero remaining gas hold, immutable intent preserved")
}
