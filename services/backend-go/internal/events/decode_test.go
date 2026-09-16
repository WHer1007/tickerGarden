package events

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

func testCatalog(t *testing.T) Catalog {
	t.Helper()
	var c Catalog
	if err := json.Unmarshal(catalogJSON, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

func zeroWord(typ string) string {
	if typ == "bool" {
		return strings.Repeat("0", 64)
	}
	return strings.Repeat("0", 64)
}

func testLog(d Definition, module string) chainrpc.Log {
	l := chainrpc.Log{Address: "0x" + strings.Repeat("11", 20), Topics: []string{d.Topic0}, Data: "0x"}
	for _, p := range d.Inputs {
		if p.Indexed {
			l.Topics = append(l.Topics, "0x"+zeroWord(p.Type))
		} else {
			l.Data += zeroWord(p.Type)
		}
	}
	return l
}

func TestDecodeEveryCatalogDefinitionAndModule(t *testing.T) {
	c := testCatalog(t)
	if len(c.Events) != 69 {
		t.Fatalf("catalog has %d events, want 69", len(c.Events))
	}
	for _, d := range c.Events {
		for _, module := range d.Modules {
			got, err := Decode(module, testLog(d, module))
			if err != nil {
				t.Fatalf("%s/%s: %v", module, d.Signature, err)
			}
			if len(got.Args) != len(d.Inputs) {
				t.Fatalf("%s args=%d want %d", d.Signature, len(got.Args), len(d.Inputs))
			}
			for _, p := range d.Inputs {
				v, ok := got.Args[p.Name]
				if !ok {
					t.Fatalf("%s missing %s", d.Signature, p.Name)
				}
				switch p.Type {
				case "bool":
					if v != false {
						t.Errorf("%s bool zero=%v", d.Signature, v)
					}
				default:
					if s, ok := v.(string); !ok || s != "0x"+strings.Repeat("0", 64) && p.Type == "bytes32" {
						t.Errorf("%s %s=%v", d.Signature, p.Name, v)
					}
				}
			}
		}
	}
}

func findDef(t *testing.T, sig string) Definition {
	for _, d := range testCatalog(t).Events {
		if d.Signature == sig {
			return d
		}
	}
	t.Fatalf("missing %s", sig)
	return Definition{}
}

func TestDecodeCanonicalWordsAndRejections(t *testing.T) {
	d := findDef(t, "Transfer(address,address,uint256)")
	l := testLog(d, "TickerMemeTokenV1")
	l.Data = "0x" + strings.Repeat("f", 64)
	got, err := Decode("TickerMemeTokenV1", l)
	if err != nil || got.Args["value"] != "115792089237316195423570985008687907853269984665640564039457584007913129639935" {
		t.Fatalf("max uint: %#v %v", got, err)
	}
	d = findDef(t, "Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
	l = testLog(d, "UniswapV4PoolManager")
	for i, p := range d.Inputs {
		if !p.Indexed && strings.HasPrefix(p.Type, "int") {
			l.Data = "0x" + strings.Repeat("f", 64) + l.Data[2:]
			break
		}
		_ = i
	}
	if _, err = Decode("UniswapV4PoolManager", l); err == nil {
		t.Fatal("invalid signed padding accepted")
	}
	bad := testLog(d, "UniswapV4PoolManager")
	bad.Topics = append(bad.Topics, "0x"+strings.Repeat("0", 64))
	if _, err = Decode("UniswapV4PoolManager", bad); err == nil {
		t.Fatal("extra topic accepted")
	}
	for _, x := range []chainrpc.Log{{Removed: true}, {Address: "0x" + strings.Repeat("11", 20), Topics: []string{d.Topic0}, Data: "0x"}} {
		if _, err = Decode("UniswapV4PoolManager", x); err == nil {
			t.Fatal("invalid log accepted")
		}
	}
	if _, err = Decode("wrongmodule", testLog(d, "UniswapV4PoolManager")); err == nil {
		t.Fatal("wrong module accepted")
	}
}

func TestCatalogSourceHashes(t *testing.T) {
	c := testCatalog(t)
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "../../../../"))
	for path, want := range c.Sources {
		filePath := strings.TrimSuffix(path, "#abi")
		b, err := os.ReadFile(filepath.Join(root, filePath))
		if err != nil {
			t.Fatal(err)
		}
		if strings.HasSuffix(path, "#abi") {
			var artifact map[string]any
			if err := json.Unmarshal(b, &artifact); err != nil {
				t.Fatal(err)
			}
			b, err = json.Marshal(artifact["abi"])
			if err != nil {
				t.Fatal(err)
			}
		}
		sum := sha256.Sum256(b)
		if hex.EncodeToString(sum[:]) != want {
			t.Fatalf("source hash mismatch: %s", path)
		}
	}
}

func TestWordBoundaries(t *testing.T) {
	negative := make([]byte, 32)
	for i := range negative {
		negative[i] = 255
	}
	for _, typ := range []string{"int24", "int128", "int256"} {
		v, e := word(negative, typ)
		if e != nil || v != "-1" {
			t.Fatal(typ, v, e)
		}
	}
	bad := append([]byte(nil), negative...)
	bad[0] = 0
	if _, e := word(bad, "int128"); e == nil {
		t.Fatal("bad signed extension accepted")
	}
	b := make([]byte, 32)
	b[31] = 2
	if _, e := word(b, "bool"); e == nil {
		t.Fatal("bool 2 accepted")
	}
	b = make([]byte, 32)
	b[0] = 1
	if _, e := word(b, "address"); e == nil {
		t.Fatal("address prefix accepted")
	}
	b = make([]byte, 32)
	b[30] = 1
	if _, e := word(b, "uint8"); e == nil {
		t.Fatal("uint8 overflow accepted")
	}
}
