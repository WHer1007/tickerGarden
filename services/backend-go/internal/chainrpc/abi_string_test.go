package chainrpc

import (
	"encoding/binary"
	"strings"
	"testing"
)

func abiStringWords(payload []byte) []byte {
	words := make([]byte, 64+((len(payload)+31)/32)*32)
	words[31] = 32
	binary.BigEndian.PutUint64(words[56:64], uint64(len(payload)))
	copy(words[64:], payload)
	return words
}

func TestDecodeABIStringCanonicalValues(t *testing.T) {
	tests := []struct {
		name    string
		payload []byte
		max     int
		want    string
	}{
		{name: "empty", payload: nil, max: 0, want: ""},
		{name: "utf8", payload: []byte("股票 🍎"), max: 32, want: "股票 🍎"},
		{name: "exact32", payload: []byte("01234567890123456789012345678901"), max: 32, want: "01234567890123456789012345678901"},
		{name: "exact33", payload: []byte("012345678901234567890123456789012"), max: 33, want: "012345678901234567890123456789012"},
		{name: "full bound", payload: []byte(strings.Repeat("a", 65536)), max: 65536, want: strings.Repeat("a", 65536)},
		{name: "max boundary", payload: []byte("abc"), max: 3, want: "abc"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeABIString(abiStringWords(tt.payload), tt.max)
			if err != nil {
				t.Fatalf("DecodeABIString() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("DecodeABIString() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestDecodeABIStringRejectsMalformedResults(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		max  int
	}{
		{name: "over configured bound", data: abiStringWords([]byte("abcd")), max: 3},
		{name: "bad offset", data: func() []byte { b := abiStringWords(nil); b[31] = 0; return b }(), max: 0},
		{name: "oversized high length word", data: func() []byte { b := abiStringWords(nil); b[55] = 1; return b }(), max: 0},
		{name: "truncated", data: abiStringWords([]byte("abc"))[:66], max: 3},
		{name: "trailing", data: append(abiStringWords([]byte("abc")), 0), max: 3},
		{name: "nonzero padding", data: func() []byte { b := abiStringWords([]byte("abc")); b[len(b)-1] = 1; return b }(), max: 3},
		{name: "invalid UTF8", data: abiStringWords([]byte{0xff}), max: 1},
		{name: "bytes32 return", data: make([]byte, 32), max: 32},
		{name: "negative max", data: abiStringWords(nil), max: -1},
		{name: "max too large", data: abiStringWords(nil), max: 65537},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got, err := DecodeABIString(tt.data, tt.max); err == nil {
				t.Fatalf("DecodeABIString() = %q, want error", got)
			}
		})
	}
}
