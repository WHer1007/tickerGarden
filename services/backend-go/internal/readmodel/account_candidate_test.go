package readmodel

import (
	"reflect"
	"strings"
	"testing"
	"tickergarden/backend/internal/deployment"
)

func TestCandidateSetRetainsFreeOnlyAccount(t *testing.T) {
	b, sources := fullCandidateFixture(t)
	original := b.Observations[6]
	user := "0x" + strings.Repeat("9", 40)
	key := b.Observations[5].Key + ":" + user
	values := map[string]any{}
	for k, v := range original.Value {
		values[k] = v
	}
	values["user"] = user
	values["deposited"] = "900719925474099312345"
	values["allocated"] = "0"
	values["freeBalanceOf"] = "900719925474099312345"
	b.Observations = append(b.Observations, deployment.StateObservation{Kind: "vaultPosition", Key: key, Value: values})
	b.Expected++
	sources["account:"+key] = sources["account:"+original.Key]
	b.Observations[12].Value["totalDeposited"] = "1801439850948198624690"
	b.Observations[12].Value["tokenBalance"] = "1801439850948198624690"
	got, e := BuildCandidateSet(b, sources)
	if e != nil || len(got.Accounts) != 2 || len(got.Positions) != 1 || got.PublicationEligible {
		t.Fatal(got, e)
	}
	if got.Accounts[1].User != user || got.Accounts[1].Free != "900719925474099312345" || got.Accounts[1].Allocated != "0" {
		t.Fatal(got.Accounts)
	}
	values["freeBalanceOf"] = "0"
	if got.Accounts[1].Free != "900719925474099312345" {
		t.Fatal("input mutation escaped")
	}
}
func TestAccountCandidateRejectsPrincipalAndSourceMismatch(t *testing.T) {
	for _, mode := range []string{"free", "sum coverage", "missing amount", "wrong user", "wrong vault", "source", "negative", "overflow"} {
		t.Run(mode, func(t *testing.T) {
			b, s := fullCandidateFixture(t)
			v := b.Observations[6].Value
			switch mode {
			case "free":
				v["freeBalanceOf"] = "0"
			case "sum coverage":
				v["allocated"] = "1001"
				v["freeBalanceOf"] = "900719925474099311344"
			case "missing amount":
				delete(v, "deposited")
			case "wrong user":
				v["user"] = "0x" + strings.Repeat("9", 40)
			case "wrong vault":
				v["vault"] = "0x" + strings.Repeat("9", 40)
			case "source":
				k := "account:" + b.Observations[6].Key
				x := s[k]
				x.BlockNumber = "2"
				s[k] = x
			case "negative":
				v["allocated"] = "-1"
			case "overflow":
				v["deposited"] = strings.Repeat("9", 78)
			}
			got, e := BuildCandidateSet(b, s)
			if e == nil || !reflect.DeepEqual(got, CandidateSet{}) {
				t.Fatal("bad account accepted", got, e)
			}
		})
	}
}
