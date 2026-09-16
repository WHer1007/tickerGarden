// Package events decodes the frozen V1 static ABI event surface. Decoding is
// separate from authenticating an emitter and reconciling protocol state.
package events

import (
	"bytes"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"

	"tickergarden/backend/internal/chainrpc"
)

//go:embed catalog.json
var catalogJSON []byte

type Input struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Indexed bool   `json:"indexed"`
}
type Definition struct {
	Signature string   `json:"signature"`
	Name      string   `json:"name"`
	Modules   []string `json:"modules"`
	Topic0    string   `json:"topic0"`
	Inputs    []Input  `json:"inputs"`
}
type Catalog struct {
	ExecutionSpecID string            `json:"executionSpecId"`
	Sources         map[string]string `json:"sources"`
	Modules         []string          `json:"modules"`
	Events          []Definition      `json:"events"`
}
type Decoded struct {
	Signature string         `json:"signature"`
	Module    string         `json:"module"`
	Emitter   string         `json:"emitter"`
	Args      map[string]any `json:"args"`
}

var ErrUnknown = errors.New("event is not declared by the bound module")
var catalogOnce sync.Once
var definitions map[string]Definition
var modules map[string]bool
var catalogErr error
var integerType = regexp.MustCompile(`^(u?int)([0-9]+)$`)

// DecodeStatic decodes a flattened static ABI return tuple with the same strict
// word rules as events. Dynamic values and trailing bytes are not accepted.
func DecodeStatic(fields []Input, data []byte) (map[string]any, error) {
	if len(data) != len(fields)*32 {
		return nil, errors.New("invalid static ABI length")
	}
	out := make(map[string]any, len(fields))
	for i, field := range fields {
		if field.Name == "" || field.Indexed || out[field.Name] != nil {
			return nil, errors.New("invalid static ABI field")
		}
		value, err := word(data[i*32:(i+1)*32], field.Type)
		if err != nil {
			return nil, err
		}
		out[field.Name] = value
	}
	return out, nil
}

func load() {
	var c Catalog
	if json.Unmarshal(catalogJSON, &c) != nil || c.ExecutionSpecID != "V1-EXEC-11" || len(c.Events) == 0 {
		catalogErr = errors.New("invalid embedded event catalog")
		return
	}
	definitions = map[string]Definition{}
	modules = map[string]bool{}
	for _, m := range c.Modules {
		modules[m] = true
	}
	for _, e := range c.Events {
		if len(e.Topic0) != 66 || len(e.Modules) == 0 || len(e.Inputs) > 32 {
			catalogErr = errors.New("invalid event definition")
			return
		}
		names := map[string]bool{}
		indexed := 0
		for _, p := range e.Inputs {
			if p.Name == "" || names[p.Name] {
				catalogErr = errors.New("ambiguous event field")
				return
			}
			names[p.Name] = true
			if p.Indexed {
				indexed++
			}
			if _, err := word(make([]byte, 32), p.Type); err != nil {
				catalogErr = err
				return
			}
		}
		if indexed > 3 {
			catalogErr = errors.New("too many indexed fields")
			return
		}
		for _, m := range e.Modules {
			key := m + ":" + e.Topic0
			if _, ok := definitions[key]; ok {
				catalogErr = errors.New("duplicate module event topic")
				return
			}
			definitions[key] = e
		}
	}
}

func word(b []byte, typ string) (any, error) {
	bad := errors.New("noncanonical ABI word")
	if len(b) != 32 {
		return nil, bad
	}
	switch typ {
	case "bytes32":
		return "0x" + hex.EncodeToString(b), nil
	case "address":
		if !bytes.Equal(b[:12], make([]byte, 12)) {
			return nil, bad
		}
		return "0x" + hex.EncodeToString(b[12:]), nil
	case "bool":
		if !bytes.Equal(b[:31], make([]byte, 31)) || b[31] > 1 {
			return nil, bad
		}
		return b[31] == 1, nil
	}
	match := integerType.FindStringSubmatch(typ)
	if match == nil {
		return nil, errors.New("unsupported ABI event type")
	}
	bits, e := strconv.Atoi(match[2])
	if e != nil || bits < 8 || bits > 256 || bits%8 != 0 {
		return nil, errors.New("unsupported ABI integer width")
	}
	size := bits / 8
	n := new(big.Int).SetBytes(b)
	if match[1] == "uint" {
		if n.BitLen() > bits {
			return nil, bad
		}
		return n.String(), nil
	}
	negative := b[32-size]&0x80 != 0
	padding := byte(0)
	if negative {
		padding = 255
	}
	for _, v := range b[:32-size] {
		if v != padding {
			return nil, bad
		}
	}
	if negative {
		n.Sub(n, new(big.Int).Lsh(big.NewInt(1), 256))
	}
	return n.String(), nil
}

// Decode requires the caller to supply the authenticated module bound to the
// emitter at this block. Matching a topic alone must never establish identity.
// Integer args use decimal strings so persisted JSON cannot round uint256/int128.
func Decode(module string, log chainrpc.Log) (Decoded, error) {
	catalogOnce.Do(load)
	if catalogErr != nil {
		return Decoded{}, catalogErr
	}
	if log.Removed || len(log.Topics) == 0 {
		return Decoded{}, ErrUnknown
	}
	d, ok := definitions[module+":"+strings.ToLower(log.Topics[0])]
	if !ok {
		return Decoded{}, ErrUnknown
	}
	if len(log.Address) != 42 || !strings.HasPrefix(log.Address, "0x") {
		return Decoded{}, errors.New("invalid event emitter")
	}
	if _, e := hex.DecodeString(log.Address[2:]); e != nil {
		return Decoded{}, errors.New("invalid event emitter")
	}
	indexed := 0
	for _, p := range d.Inputs {
		if p.Indexed {
			indexed++
		}
	}
	if len(log.Topics) != indexed+1 || !strings.HasPrefix(log.Data, "0x") || len(log.Data) != 2+(len(d.Inputs)-indexed)*64 {
		return Decoded{}, errors.New("event topic/data length mismatch")
	}
	data, e := hex.DecodeString(log.Data[2:])
	if e != nil {
		return Decoded{}, errors.New("invalid event data encoding")
	}
	out := Decoded{Signature: d.Signature, Module: module, Emitter: strings.ToLower(log.Address), Args: map[string]any{}}
	topic, offset := 1, 0
	for _, p := range d.Inputs {
		var raw []byte
		if p.Indexed {
			t := log.Topics[topic]
			topic++
			if len(t) != 66 || !strings.HasPrefix(t, "0x") {
				return Decoded{}, errors.New("invalid indexed ABI word")
			}
			raw, e = hex.DecodeString(t[2:])
			if e != nil {
				return Decoded{}, errors.New("invalid topic encoding")
			}
		} else {
			raw = data[offset : offset+32]
			offset += 32
		}
		value, e := word(raw, p.Type)
		if e != nil {
			return Decoded{}, e
		}
		out.Args[p.Name] = value
	}
	return out, nil
}

func HasModule(module string) bool {
	catalogOnce.Do(load)
	return catalogErr == nil && modules[module]
}

// Topics returns only the frozen event signatures for a bound module.
func Topics(module string) []string {
	catalogOnce.Do(load)
	out := []string{}
	if catalogErr != nil {
		return out
	}
	for _, d := range definitions {
		for _, m := range d.Modules {
			if m == module {
				out = append(out, d.Topic0)
				break
			}
		}
	}
	sort.Strings(out)
	return out
}
