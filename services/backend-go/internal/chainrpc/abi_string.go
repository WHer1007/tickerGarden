package chainrpc

import (
	"encoding/binary"
	"errors"
	"unicode/utf8"
)

// DecodeABIString accepts exactly one canonical Solidity ABI string return.
// It does not reinterpret bytes32, offsets into arbitrary trailing data, invalid
// UTF-8 or nonzero padding. maxBytes bounds both allocation and stored display data.
func DecodeABIString(data []byte, maxBytes int) (string, error) {
	fail := func() (string, error) { return "", errors.New("invalid ABI string result") }
	if maxBytes < 0 || maxBytes > 65536 || len(data) < 64 || len(data) > 64+((maxBytes+31)/32)*32 {
		return fail()
	}
	for _, v := range data[:31] {
		if v != 0 {
			return fail()
		}
	}
	if data[31] != 32 {
		return fail()
	}
	for _, v := range data[32:56] {
		if v != 0 {
			return fail()
		}
	}
	n := binary.BigEndian.Uint64(data[56:64])
	if n > uint64(maxBytes) {
		return fail()
	}
	size := int(n)
	padded := ((size + 31) / 32) * 32
	if len(data) != 64+padded {
		return fail()
	}
	for _, v := range data[64+size:] {
		if v != 0 {
			return fail()
		}
	}
	raw := data[64 : 64+size]
	if !utf8.Valid(raw) {
		return fail()
	}
	return string(raw), nil
}
