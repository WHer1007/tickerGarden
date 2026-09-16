package analytics

import (
	"math/big"
	"strings"
	"testing"
)

func TestUint256ScratchReuse(t *testing.T) {
	max := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 256), big.NewInt(1)).String()
	overflow := new(big.Int).Lsh(big.NewInt(1), 256).String()
	var scratch big.Int
	for _, s := range []string{max, "1", "0", max, overflow, "2", "01", "-1", "+1", " 1", "1\n", "", strings.Repeat("9", 79), "3"} {
		valid := s == max || s == "0" || s == "1" || s == "2" || s == "3"
		err := setUint256(&scratch, s)
		if (err == nil) != valid {
			t.Fatalf("%q: %v", s, err)
		}
		if valid && scratch.String() != s {
			t.Fatal("scratch value changed", s, &scratch)
		}
	}
}
