package marketstats

import "testing"

func TestVolumeAmountCurveConservation(t *testing.T) {
	cases := []struct {
		name, signature, quoteIn, quoteOut, fee, tax, want string
	}{
		{"buy taxed", "CurveBuy(", "100", "", "7", "3", "90"},
		{"buy untaxed", "CurveBuy(", "100", "", "7", "0", "93"},
		{"sell taxed", "CurveSell(", "", "100", "7", "3", "110"},
		{"sell untaxed", "CurveSell(", "", "100", "7", "0", "107"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			args := map[string]any{"quoteIn": tc.quoteIn, "quoteOut": tc.quoteOut, "fee": tc.fee, "tax": tc.tax}
			got, err := volumeAmount(tc.signature, args, "quoteIn")
			if err != nil || got.String() != tc.want {
				t.Fatalf("got %v, err %v, want %s", got, err, tc.want)
			}
		})
	}
}

func TestVolumeAmountRejectsInvalidCurveValues(t *testing.T) {
	for _, args := range []map[string]any{
		{"quoteIn": "-1", "fee": "0", "tax": "0"},
		{"quoteIn": "1", "fee": "2", "tax": "0"},
		{"quoteIn": "1", "fee": "0"},
	} {
		if got, err := volumeAmount("CurveBuy(", args, "quoteIn"); err == nil || got != nil {
			t.Fatalf("expected invalid amount, got %v, err %v", got, err)
		}
	}
}

func TestVolumeAmountPoolUsesAbsoluteRawAmount(t *testing.T) {
	got, err := volumeAmount("Swap(", map[string]any{"amount0": "-12"}, "amount0")
	if err != nil || got.String() != "12" {
		t.Fatalf("got %v, err %v", got, err)
	}
}
