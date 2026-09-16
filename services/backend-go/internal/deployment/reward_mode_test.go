package deployment

import (
	"context"
	"errors"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type modeFixture struct {
	bindingFixture
	err error
}

func (f *modeFixture) CallAt(ctx context.Context, a, data, h string) ([]byte, error) {
	if f.err != nil {
		return nil, f.err
	}
	if value, ok := f.calls[a+data]; ok {
		return value, nil
	}
	return nil, errors.New("execution reverted: missing selector")
}

func TestFeeVaultUsesUserClaimsModes(t *testing.T) {
	block := chainrpc.Header{Hash: blockHash}
	modeData := bytesWord(strings.TrimPrefix(userClaimModeV1, "0x"))
	for _, tc := range []struct {
		name string
		data []byte
		err  error
		want bool
	}{
		{"v4", modeData, nil, true},
		{"legacy missing selector", nil, errors.New("missing selector"), false},
		{"transport failure", nil, errors.New("timeout"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := &modeFixture{bindingFixture: bindingFixture{calls: map[string][]byte{}}}
			key := "0x" + strings.Repeat("1", 40) + Hash([]byte("userClaimMode()"))[:10]
			if tc.err != nil {
				f.err = tc.err
				if tc.name == "legacy missing selector" {
					f.err = errors.New("execution reverted: missing selector")
				}
			} else {
				f.calls[key] = tc.data
			}
			got, err := feeVaultUsesUserClaims(context.Background(), f, "0x"+strings.Repeat("1", 40), block)
			if tc.err != nil && err == nil {
				t.Fatal("transport failure did not fail closed")
			}
			if tc.err == nil && (err != nil || got != tc.want) {
				t.Fatalf("got %v, %v; want %v", got, err, tc.want)
			}
		})
	}
}

func TestV4FeeObservationSkipsRemovedRawExitGetter(t *testing.T) {
	f, block, markets, vault, _ := feeSetup(t, false)
	f.calls[vault+Hash([]byte("userClaimMode()"))[:10]] = bytesWord(strings.TrimPrefix(userClaimModeV1, "0x"))
	for key := range f.calls {
		if strings.HasPrefix(key, vault+Hash([]byte("rawRewardExitAt(bytes32,address)"))[:10]) {
			delete(f.calls, key)
		}
	}
	if _, err := ObserveFeeBlock(context.Background(), f, f.manifest, block, markets); err != nil {
		t.Fatalf("V4 observation unexpectedly failed without raw getter: %v", err)
	}
}

func TestFeeVaultUsesUserClaimsRejectsUnknownAndMalformedModes(t *testing.T) {
	for name, data := range map[string][]byte{
		"previous all-assets-only mode": bytesWord(strings.TrimPrefix(Hash([]byte("TICKERGARDEN_USER_CLAIM_V1")), "0x")),
		"unknown":   bytesWord("01"),
		"malformed": []byte{1, 2, 3},
	} {
		t.Run(name, func(t *testing.T) {
			f := &modeFixture{bindingFixture: bindingFixture{calls: map[string][]byte{}}}
			key := "0x" + strings.Repeat("1", 40) + Hash([]byte("userClaimMode()"))[:10]
			f.calls[key] = data
			if _, err := feeVaultUsesUserClaims(context.Background(), f, "0x"+strings.Repeat("1", 40), chainBlock()); err == nil {
				t.Fatal("accepted invalid user claim mode")
			}
		})
	}
}

func chainBlock() chainrpc.Header { return chainrpc.Header{Hash: blockHash} }
