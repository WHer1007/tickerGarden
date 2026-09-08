package readmodel

import (
	"reflect"
	"testing"
)

func TestCandidatePrincipalRecomputesTotals(t *testing.T) {
	for _, mode := range []string{"matching", "surplus", "deposit mismatch", "allocation mismatch", "underfunded", "missing observation", "wrong token", "wrong vault", "malformed amount"} {
		t.Run(mode, func(t *testing.T) {
			b, s := fullCandidateFixture(t)
			v := b.Observations[12].Value
			// Stored flags must not be accepted as substitutes for arithmetic.
			v["checks"] = map[string]bool{"balanceCoversDeposits": true, "knownUserSumEqualsDeposited": true}
			switch mode {
			case "surplus":
				v["tokenBalance"] = "900719925474099312346"
			case "deposit mismatch":
				v["totalDeposited"] = "900719925474099312344"
			case "allocation mismatch":
				v["totalAllocated"] = "999"
			case "underfunded":
				v["tokenBalance"] = "900719925474099312344"
			case "missing observation":
				b.Observations = b.Observations[:12]
				b.Expected--
			case "wrong token":
				v["stockToken"] = v["vault"]
			case "wrong vault":
				v["vault"] = v["stockToken"]
			case "malformed amount":
				v["totalAllocated"] = "01000"
			}
			got, e := BuildCandidateSet(b, s)
			if mode == "matching" || mode == "surplus" {
				if e != nil || got.PublicationEligible {
					t.Fatal(got, e)
				}
			} else if e == nil || !reflect.DeepEqual(got, CandidateSet{}) {
				t.Fatal("bad principal totals accepted", got, e)
			}
		})
	}
}

func TestCandidatePrincipalRejectsDuplicateTokenAssets(t *testing.T) {
	b, s := fullCandidateFixture(t)
	asset := b.Observations[5]
	old := asset.Key
	asset.Key = "0x9999999999999999999999999999999999999999999999999999999999999999"
	solvency := b.Observations[12]
	values := map[string]any{}
	for k, v := range solvency.Value {
		values[k] = v
	}
	values["assetUid"] = asset.Key
	values["totalDeposited"] = "0"
	values["totalAllocated"] = "0"
	solvency.Key = asset.Key
	solvency.Value = values
	b.Observations = append(b.Observations, asset, solvency)
	b.Expected += 2
	s["config:asset:"+asset.Key] = s["config:asset:"+old]
	if _, e := BuildCandidateSet(b, s); e == nil {
		t.Fatal("duplicate token accounting accepted")
	}
}
