package readmodel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"sync"
	"testing"
)

func cacheDigest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func TestPersistedValidationCacheRetainsIsolationAndBoundaries(t *testing.T) {
	raw, err := os.ReadFile("testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{ChainID: 46630}
	digest := cacheDigest(raw)
	first, err := store.parsePersisted(raw, digest)
	if err != nil {
		t.Fatal(err)
	}
	original := first.Markets[0].MemeToken
	first.Markets[0].MemeToken = "mutated"
	first.Configs[0].Values["minimumAllocation"] = "0"
	next, err := store.parsePersisted(raw, digest)
	if err != nil || next.Markets[0].MemeToken != original || next.Configs[0].Values["minimumAllocation"] != "414" {
		t.Fatal("cached snapshot shared mutable state", err)
	}
	// A matching checksum does not bypass schema validation for new bytes.
	altered := append([]byte{}, raw...)
	altered = append(altered, []byte(`{}`)...)
	if _, err = store.parsePersisted(altered, cacheDigest(altered)); err == nil {
		t.Fatal("new invalid bytes accepted")
	}
	if _, err = store.parsePersisted(altered, digest); err == nil {
		t.Fatal("checksum mismatch accepted")
	}
	store.ChainID = 421614
	if _, err = store.parsePersisted(raw, digest); err == nil {
		t.Fatal("validation reused across chains")
	}
	store.ChainID = 46630
	for i := 0; i < validationCacheLimit+2; i++ {
		variant := next
		variant.Markets = append([]MarketReadModel{}, next.Markets...)
		variant.Markets[0].CurveProgress.AccruedCurveFees = string([]byte{'1' + byte(i%9)})
		data, e := json.Marshal(variant)
		if e != nil {
			t.Fatal(e)
		}
		// Whitespace gives distinct valid bytes without changing economic fields.
		for j := 0; j < i; j++ {
			data = append(data, ' ')
		}
		if _, e = store.parsePersisted(data, cacheDigest(data)); e != nil {
			t.Fatal(e)
		}
	}
	if len(store.validated) != validationCacheLimit || len(store.validationOrder) != validationCacheLimit {
		t.Fatal("unbounded validation cache")
	}
	if store.validated[validationKey{46630, sha256.Sum256(raw)}] {
		t.Fatal("old validation entry not evicted")
	}
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			value, e := store.parsePersisted(raw, digest)
			if e != nil {
				t.Error(e)
				return
			}
			value.Markets[0].MemeToken = "private"
		}()
	}
	wg.Wait()
	value, err := store.parsePersisted(raw, digest)
	if err != nil || value.Markets[0].MemeToken != original {
		t.Fatal("concurrent caller mutated cache", err)
	}
}
