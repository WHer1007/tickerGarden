package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"tickergarden/backend/internal/readmodel"
)

func TestSnapshotUpdates(t *testing.T) {
	previous := testSnapshot(t)
	current := testSnapshot(t)
	number, hash := "99", "0x"+strings.Repeat("9", 64)
	current.Sync.BlockNumber = &number
	current.Sync.BlockHash = &hash
	current.Sync.Revision = number + ":" + hash
	current.Markets[0].MemeToken = "0x" + strings.Repeat("9", 40)
	for _, tc := range []struct {
		name, since, mode   string
		stale, failed, head bool
		code                int
	}{
		{name: "initial", mode: "reset", code: 200},
		{name: "unchanged", since: current.Sync.Revision, mode: "unchanged", code: 200},
		{name: "changed", since: previous.Sync.Revision, mode: "changed", code: 200},
		{name: "expired", since: previous.Sync.Revision, mode: "reset", stale: true, code: 200},
		{name: "storage failure", since: previous.Sync.Revision, failed: true, code: 503},
		{name: "head rejected", head: true, code: 503},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader := readerFunc(func(_ context.Context, revision string) (readmodel.Snapshot, error) {
				if revision == "" {
					s := current
					if tc.head {
						s.Sync.Finality = "head"
					}
					return s, nil
				}
				if tc.stale {
					return readmodel.Snapshot{}, readmodel.ErrRevision
				}
				if tc.failed {
					return readmodel.Snapshot{}, errors.New("database private error")
				}
				return previous, nil
			})
			path := "/v1/updates"
			if tc.since != "" {
				path += "?since=" + tc.since
			}
			w := httptest.NewRecorder()
			New(Options{ChainID: current.Sync.ChainID, ReadModels: reader}).ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if w.Code != tc.code {
				t.Fatalf("%d %s", w.Code, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("cached updates")
			}
			schema := "SnapshotUpdatesError"
			if tc.code == 200 {
				schema = "SnapshotUpdatesResponse"
			}
			if err := readmodel.ValidateResponse(schema, w.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
			if tc.code == 200 {
				var result struct {
					Mode        string
					Invalidated []string
					Sync        readmodel.SyncStatus
				}
				if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				if result.Mode != tc.mode || result.Sync.Revision != current.Sync.Revision {
					t.Fatal(result)
				}
				expected := 0
				if tc.mode == "reset" {
					expected = 4
				}
				if tc.mode == "changed" {
					expected = 1
				}
				if len(result.Invalidated) != expected {
					t.Fatal(result)
				}
			}
		})
	}
	for _, path := range []string{"?since=", "?since=bad", "?unknown=1", "?since=a&since=b", "?since=%zz"} {
		w := httptest.NewRecorder()
		New(Options{}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/updates"+path, nil))
		if w.Code != 400 {
			t.Fatal(path, w.Code)
		}
	}
}

func TestSnapshotUpdatesRejectInconsistentIdentity(t *testing.T) {
	mutations := []struct {
		name   string
		mutate func(*readmodel.SyncStatus)
	}{
		{"missing number", func(s *readmodel.SyncStatus) { s.BlockNumber = nil }},
		{"missing hash", func(s *readmodel.SyncStatus) { s.BlockHash = nil }},
		{"different number", func(s *readmodel.SyncStatus) { v := "101"; s.BlockNumber = &v }},
		{"different hash", func(s *readmodel.SyncStatus) { v := "0x" + strings.Repeat("f", 64); s.BlockHash = &v }},
		{"wrong chain", func(s *readmodel.SyncStatus) { s.ChainID++ }},
		{"not finalized", func(s *readmodel.SyncStatus) { s.Finality = "head" }},
		{"not synced", func(s *readmodel.SyncStatus) { s.Status = "stale" }},
		{"wrong revision", func(s *readmodel.SyncStatus) { s.Revision = "102:0x" + strings.Repeat("a", 64) }},
	}
	for _, target := range []string{"current", "previous"} {
		for _, mutation := range mutations {
			t.Run(target+"/"+mutation.name, func(t *testing.T) {
				previous := testSnapshot(t)
				current := testSnapshot(t)
				number, hash := "99", "0x"+strings.Repeat("9", 64)
				current.Sync.BlockNumber = &number
				current.Sync.BlockHash = &hash
				current.Sync.Revision = number + ":" + hash
				since := previous.Sync.Revision
				if target == "current" {
					mutation.mutate(&current.Sync)
				} else {
					mutation.mutate(&previous.Sync)
				}
				calls := 0
				reader := readerFunc(func(_ context.Context, revision string) (readmodel.Snapshot, error) {
					calls++
					if revision == "" {
						return current, nil
					}
					return previous, nil
				})
				w := httptest.NewRecorder()
				New(Options{ChainID: testSnapshot(t).Sync.ChainID, ReadModels: reader}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/updates?since="+since, nil))
				if w.Code != 503 || strings.Contains(w.Body.String(), `"mode"`) {
					t.Fatal(w.Code, w.Body.String())
				}
				if target == "current" && calls != 1 {
					t.Fatal("invalid current snapshot reached historical reader", calls)
				}
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("cacheable failure")
				}
				if err := readmodel.ValidateResponse("SnapshotUpdatesError", w.Body.Bytes()); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestSnapshotUpdatesAccounts(t *testing.T) {
	empty := []readmodel.UserAccountReadModel{}
	before := []readmodel.UserAccountReadModel{{User: "wallet", Free: "1"}}
	after := []readmodel.UserAccountReadModel{{User: "wallet", Free: "2"}}
	for _, tc := range []struct {
		name              string
		previous, current *[]readmodel.UserAccountReadModel
		invalidated       bool
	}{
		{"amount changed", &before, &after, true},
		{"coverage added", nil, &empty, true},
		{"coverage removed", &empty, nil, true},
		{"same accounts", &before, &before, false},
		{"both absent", nil, nil, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			previous, current := testSnapshot(t), testSnapshot(t)
			previous.Accounts, current.Accounts = tc.previous, tc.current
			number, hash := "99", "0x"+strings.Repeat("9", 64)
			current.Sync.BlockNumber, current.Sync.BlockHash = &number, &hash
			current.Sync.Revision = number + ":" + hash
			reader := readerFunc(func(_ context.Context, revision string) (readmodel.Snapshot, error) {
				if revision == "" {
					return current, nil
				}
				return previous, nil
			})
			w := httptest.NewRecorder()
			New(Options{ChainID: current.Sync.ChainID, ReadModels: reader}).ServeHTTP(w, httptest.NewRequest("GET", "/v1/updates?since="+previous.Sync.Revision, nil))
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			if err := readmodel.ValidateResponse("SnapshotUpdatesResponse", w.Body.Bytes()); err != nil {
				t.Fatal(err)
			}
			var result struct {
				Mode        string
				Invalidated []string
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			if result.Mode != "changed" {
				t.Fatal(result)
			}
			if tc.invalidated {
				if len(result.Invalidated) != 1 || result.Invalidated[0] != "accounts" {
					t.Fatal(result)
				}
			} else if len(result.Invalidated) != 0 {
				t.Fatal(result)
			}
		})
	}
}
