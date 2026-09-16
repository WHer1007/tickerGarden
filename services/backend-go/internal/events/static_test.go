package events

import (
	"strings"
	"testing"
)

func TestDecodeStaticStrictReturnData(t *testing.T) {
	fields := []Input{{Name: "amount", Type: "uint256"}, {Name: "enabled", Type: "bool"}}
	data := make([]byte, 64)
	for i := 0; i < 32; i++ {
		data[i] = 255
	}
	data[63] = 1
	result, err := DecodeStatic(fields, data)
	if err != nil || result["amount"] != "115792089237316195423570985008687907853269984665640564039457584007913129639935" || result["enabled"] != true {
		t.Fatalf("lost exact ABI value: %v %v", result, err)
	}
	for _, bad := range [][]Input{
		{{Name: "amount", Type: "uint256"}, {Name: "amount", Type: "bool"}},
		{{Name: "amount", Type: "uint256", Indexed: true}, {Name: "enabled", Type: "bool"}},
		{{Name: "", Type: "uint256"}, {Name: "enabled", Type: "bool"}},
		{{Name: "amount", Type: "uint256"}, {Name: "enabled", Type: "string"}},
	} {
		if _, err := DecodeStatic(bad, data); err == nil {
			t.Fatal("accepted ambiguous or dynamic return schema")
		}
	}
	for _, bad := range [][]byte{data[:63], append(append([]byte{}, data...), 0)} {
		if _, err := DecodeStatic(fields, bad); err == nil {
			t.Fatal("accepted wrong ABI length")
		}
	}
	data[63] = 2
	if _, err := DecodeStatic(fields, data); err == nil {
		t.Fatal("accepted non-boolean")
	}
	dirty := make([]byte, 32)
	dirty[0] = 1
	if _, err := DecodeStatic([]Input{{Name: "address", Type: "address"}}, dirty); err == nil {
		t.Fatal("accepted dirty address")
	}
	result, err = DecodeStatic([]Input{{Name: "address", Type: "address"}}, make([]byte, 32))
	if err != nil || result["address"] != "0x"+strings.Repeat("0", 40) {
		t.Fatal("zero quote address must decode")
	}
}
