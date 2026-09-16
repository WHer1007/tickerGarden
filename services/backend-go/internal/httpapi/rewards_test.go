package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/rewards"
)

type rewardReaderFake struct {
	result           rewards.Result
	err              error
	users, revisions []string
}

func (f *rewardReaderFake) LoadRewards(_ context.Context, user, revision string) (rewards.Result, error) {
	f.users = append(f.users, user)
	f.revisions = append(f.revisions, revision)
	return f.result, f.err
}
func rewardHandler(r rewards.Reader) http.Handler { return New(Options{Rewards: r}) }
func rewardReq(t *testing.T, h http.Handler, method, path string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(method, path, nil))
	return w
}

func TestRewardsEndpointPaginatesAndPassesRevision(t *testing.T) {
	u := "0x" + strings.Repeat("a", 40)
	rev := "12:0x" + strings.Repeat("b", 64)
	f := &rewardReaderFake{result: rewards.Result{Items: []deployment.StateObservation{{Key: "a"}, {Key: "b"}}, Source: rewards.Source{Revision: rev}}}
	h := rewardHandler(f)
	w := rewardReq(t, h, http.MethodGet, "/v1/users/"+u+"/rewards?limit=1")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	var first struct {
		Items  []deployment.StateObservation `json:"items"`
		Cursor *string                       `json:"nextCursor"`
	}
	if json.NewDecoder(w.Body).Decode(&first) != nil || len(first.Items) != 1 || first.Cursor == nil {
		t.Fatal(w.Body.String())
	}
	other := "0x" + strings.Repeat("c", 40)
	if bad := rewardReq(t, h, http.MethodGet, "/v1/users/"+other+"/rewards?cursor="+*first.Cursor); bad.Code != 400 {
		t.Fatal("cross-wallet cursor accepted")
	}
	w = rewardReq(t, h, http.MethodGet, "/v1/users/"+u+"/rewards?limit=1&cursor="+*first.Cursor)
	if w.Code != 200 || len(f.revisions) != 2 || f.revisions[1] != rev {
		t.Fatalf("%d %#v", w.Code, f.revisions)
	}
}

func TestRewardsEndpointRejectsBadQueriesAndMethods(t *testing.T) {
	f := &rewardReaderFake{result: rewards.Result{Source: rewards.Source{Revision: "1:0x" + strings.Repeat("b", 64)}}}
	h := rewardHandler(f)
	u := "0x" + strings.Repeat("a", 40)
	for _, p := range []string{"/v1/users/bad/rewards", "/v1/users/" + u + "/rewards?limit=0", "/v1/users/" + u + "/rewards?limit=1&limit=2", "/v1/users/" + u + "/rewards?wat=1"} {
		if w := rewardReq(t, h, http.MethodGet, p); w.Code != 400 {
			t.Fatalf("%s => %d", p, w.Code)
		}
	}
	w := rewardReq(t, h, http.MethodGet, "/v1/users/"+u+"/rewards?limit=1")
	var x struct {
		Cursor *string `json:"nextCursor"`
	}
	json.NewDecoder(w.Body).Decode(&x)
	if x.Cursor != nil {
		t.Fatal("unexpected cursor")
	}
	if w := rewardReq(t, h, http.MethodPost, "/v1/users/"+u+"/rewards"); w.Code != 405 {
		t.Fatal(w.Code)
	}
	if w := rewardReq(t, h, http.MethodGet, "/v1/users/"+u+"/rewards?cursor=eyJ2ZXJzaW9uIjoxLCJzY29wZSI6InJld2FyZHMiLCJmaWx0ZXIiOiIweGJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJzbmFwc2hvdCI6IjE6MHhiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmIiLCJhZnRlciI6ImEifQ"); w.Code != 400 {
		t.Fatal(w.Code)
	}
}

func TestRewardsEndpointHidesReaderErrorsAndNilReader(t *testing.T) {
	u := "0x" + strings.Repeat("a", 40)
	for _, r := range []rewards.Reader{nil, &rewardReaderFake{err: errors.New("secret db details")}} {
		w := rewardReq(t, rewardHandler(r), http.MethodGet, "/v1/users/"+u+"/rewards")
		if w.Code != 503 || strings.Contains(w.Body.String(), "secret") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}

func TestRewardsEndpointRejectsChangedRevision(t *testing.T) {
	f := &rewardReaderFake{err: rewards.ErrRevision}
	w := rewardReq(t, rewardHandler(f), http.MethodGet, "/v1/users/0x"+strings.Repeat("a", 40)+"/rewards")
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body.String())
	}
}
