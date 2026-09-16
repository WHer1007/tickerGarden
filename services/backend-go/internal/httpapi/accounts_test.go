package httpapi

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"tickergarden/backend/internal/readmodel"
)

func TestAccountReadEndpoint(t *testing.T) {
	raw, err := os.ReadFile("../readmodel/testdata/snapshot.json")
	if err != nil {
		t.Fatal(err)
	}
	s, err := readmodel.Parse(raw, 46630)
	if err != nil {
		t.Fatal(err)
	}
	user := s.Positions[0].User
	serve := func(path string, snap readmodel.Snapshot) *httptest.ResponseRecorder {
		h := New(Options{ChainID: 46630, ReadModels: fixtureReader{snap}, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))})
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		return w
	}
	path := "/v1/users/" + user + "/accounts"
	if w := serve(path, s); w.Code != 503 {
		t.Fatal("legacy snapshot claimed account coverage", w.Code)
	}
	accounts := []readmodel.UserAccountReadModel{{User: user, AssetUID: "0x" + strings.Repeat("1", 64), Deposited: "100", Allocated: "0", Free: "100"}, {User: user, AssetUID: "0x" + strings.Repeat("2", 64), Deposited: "9", Allocated: "0", Free: "9"}, {User: "0x" + strings.Repeat("8", 40), AssetUID: "0x" + strings.Repeat("1", 64)}}
	s.Accounts = &accounts
	w := serve(path+"?limit=1", s)
	var first page[readmodel.UserAccountReadModel]
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &first) != nil || len(first.Items) != 1 || first.NextCursor == nil {
		t.Fatal(w.Body.String())
	}
	w = serve(path+"?limit=1&cursor="+*first.NextCursor, s)
	var second page[readmodel.UserAccountReadModel]
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &second) != nil || len(second.Items) != 1 || second.NextCursor != nil || first.Items[0].AssetUID == second.Items[0].AssetUID {
		t.Fatal(w.Body.String())
	}
	if w = serve("/v1/users/0x"+strings.Repeat("8", 40)+"/accounts?cursor="+*first.NextCursor, s); w.Code != 400 {
		t.Fatal("cross-wallet cursor")
	}
	if w = serve(path+"?unknown=1", s); w.Code != 400 {
		t.Fatal("unknown query")
	}
	empty := []readmodel.UserAccountReadModel{}
	s.Accounts = &empty
	if w = serve(path, s); w.Code != 200 || !strings.Contains(w.Body.String(), `"items":[]`) {
		t.Fatal("known empty", w.Body.String())
	}
}
