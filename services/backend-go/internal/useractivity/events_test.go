package useractivity

import (
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	"tickergarden/backend/internal/chainrpc"
)

type assertions struct{}

var require assertions

func (assertions) NoError(t *testing.T, e error) {
	t.Helper()
	if e != nil {
		t.Fatal(e)
	}
}
func (assertions) Error(t *testing.T, e error) {
	t.Helper()
	if e == nil {
		t.Fatal("expected error")
	}
}
func (assertions) ErrorIs(t *testing.T, e, target error) {
	t.Helper()
	if !errors.Is(e, target) {
		t.Fatalf("error %v is not %v", e, target)
	}
}
func (assertions) Len(t *testing.T, v any, n int) {
	t.Helper()
	if reflect.ValueOf(v).Len() != n {
		t.Fatalf("length %d, want %d", reflect.ValueOf(v).Len(), n)
	}
}
func (assertions) Empty(t *testing.T, v any) {
	t.Helper()
	if reflect.ValueOf(v).Len() != 0 {
		t.Fatalf("want empty, got %v", v)
	}
}
func (assertions) Equal(t *testing.T, want, got any) {
	t.Helper()
	if !reflect.DeepEqual(want, got) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

type catalogForTest struct {
	Events []struct {
		Name, Topic0 string
		Modules      []string
		Inputs       []struct {
			Name, Type string
			Indexed    bool
		}
	} `json:"events"`
}

const testFrom = "0x1111111111111111111111111111111111111111"
const testTo = "0x2222222222222222222222222222222222222222"
const testEmitter = "0x3333333333333333333333333333333333333333"
const testTx = "0x" + "44" + "00000000000000000000000000000000000000000000000000000000000000"
const testBlock = "0x" + "55" + "00000000000000000000000000000000000000000000000000000000000000"

func wordAddress(a string) string { return strings.Repeat("0", 24) + a[2:] }
func wordZero() string            { return strings.Repeat("0", 64) }

func loadCatalog(t *testing.T) catalogForTest {
	b, err := os.ReadFile("../events/catalog.json")
	require.NoError(t, err)
	var c catalogForTest
	require.NoError(t, json.Unmarshal(b, &c))
	return c
}

func makeLog(t *testing.T, name string, values map[string]string) (chainrpc.Log, string) {
	for _, e := range loadCatalog(t).Events {
		if e.Name != name {
			continue
		}
		topics := []string{"0x" + e.Topic0[2:]}
		var data strings.Builder
		for _, in := range e.Inputs {
			v := values[in.Name]
			if v == "" {
				v = wordZero()
			}
			if in.Type == "address" && len(v) == 42 {
				v = wordAddress(v)
			}
			if in.Indexed {
				topics = append(topics, "0x"+v)
			} else {
				data.WriteString(v)
			}
		}
		l := chainrpc.Log{Address: testEmitter, Topics: topics, Data: "0x" + data.String(), BlockNumber: "0x10", BlockHash: testBlock, TransactionHash: testTx, TransactionIndex: "0x1", LogIndex: "0x0"}
		return l, e.Modules[0]
	}
	t.Fatalf("event %s absent from catalog", name)
	return chainrpc.Log{}, ""
}

func receipt(l chainrpc.Log, status string) *chainrpc.Receipt {
	return &chainrpc.Receipt{TransactionHash: testTx, TransactionIndex: "0x1", BlockHash: testBlock, BlockNumber: "0x10", Status: status, Logs: []chainrpc.Log{l}}
}

func TestFromEventAllParticipantFieldsAreAddressAndDecode(t *testing.T) {
	for name, fields := range participantFields {
		t.Run(name, func(t *testing.T) {
			for _, field := range fields {
				found := false
				for _, definition := range loadCatalog(t).Events {
					if definition.Name != name {
						continue
					}
					for _, input := range definition.Inputs {
						if input.Name == field && input.Type == "address" {
							found = true
						}
					}
				}
				if !found {
					t.Fatalf("%s.%s is not an address field", name, field)
				}
			}
			values := map[string]string{}
			for i, field := range fields {
				if i == 0 {
					values[field] = testFrom
				} else {
					values[field] = testTo
				}
			}
			l, module := makeLog(t, name, values)
			r, err := FromEvent(4663, module, l, receipt(l, "0x1"))
			require.NoError(t, err)
			require.Len(t, r, len(fields))
		})
	}
}

func TestFromEventRolesAndEvidenceBoundaries(t *testing.T) {
	l, m := makeLog(t, "Transfer", map[string]string{"from": testFrom, "to": testFrom})
	r, err := FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Len(t, r, 1)
	require.Equal(t, []string{"from", "to"}, r[0].Roles)
	l, m = makeLog(t, "Transfer", map[string]string{"from": "0x0000000000000000000000000000000000000000", "to": testTo})
	r, err = FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Len(t, r, 1)
	require.Equal(t, testTo, r[0].Account)
	l, m = makeLog(t, "Transfer", map[string]string{"from": testFrom, "to": "0x0000000000000000000000000000000000000000"})
	r, err = FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Len(t, r, 1)
	require.Equal(t, testFrom, r[0].Account)
	l, m = makeLog(t, "CurveBuy", map[string]string{"buyer": testFrom, "recipient": testTo})
	r, err = FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Len(t, r, 2)
	l, m = makeLog(t, "Swap", map[string]string{"sender": testFrom})
	r, err = FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Len(t, r, 1)
	require.Equal(t, "sender", r[0].Roles[0])
	require.Equal(t, "event_address_reference_not_verified_initiator", r[0].IdentityBasis)
	l, m = makeLog(t, "TickerGardenBaselineAdded", nil)
	r, err = FromEvent(4663, m, l, receipt(l, "0x1"))
	require.NoError(t, err)
	require.Empty(t, r)
	bad := receipt(l, "0x1")
	bad.Logs[0].LogIndex = "0x1"
	require.ErrorIs(t, mustErr(FromEvent(4663, m, l, bad)), ErrEvidence)
	require.ErrorIs(t, mustErr(FromEvent(4663, m, l, receipt(l, "0x0"))), ErrEvidence)
	require.Error(t, mustErr(FromEvent(4663, "wrong-module", l, receipt(l, "0x1"))))
}

func mustErr(_ []Record, err error) error { return err }

func TestBranchIdentityAndOutputIsolation(t *testing.T) {
	log, module := makeLog(t, "CurveBuy", map[string]string{"buyer": testFrom, "recipient": testTo})
	first, err := FromEvent(4663, module, log, receipt(log, "0x1"))
	require.NoError(t, err)
	first[0].Arguments["buyer"] = "changed"
	require.Equal(t, testFrom, first[1].Arguments["buyer"])
	second, err := FromEvent(4663, module, log, receipt(log, "0x1"))
	require.NoError(t, err)
	require.Equal(t, testFrom, second[0].Arguments["buyer"])
	moved := log
	moved.BlockHash = "0x" + strings.Repeat("6", 64)
	movedReceipt := receipt(moved, "0x1")
	movedReceipt.BlockHash = moved.BlockHash
	branch, err := FromEvent(4663, module, moved, movedReceipt)
	require.NoError(t, err)
	if first[0].ID == branch[0].ID {
		t.Fatal("branch identity was collapsed")
	}
	require.Equal(t, first[0].TransactionHash, branch[0].TransactionHash)
}
