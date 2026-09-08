package httpapi

import (
	"net/url"
	"reflect"
	"testing"
	"tickergarden/backend/internal/readmodel"
)

func TestPaginationPrecomputesIdentityAndPreservesInput(t *testing.T) {
	items := []string{"e", "b", "a", "d", "c"}
	original := append([]string(nil), items...)
	calls := 0
	identity := func(s string) string { calls++; return s }
	q := url.Values{"limit": {"2"}}
	sync := readmodel.SyncStatus{Revision: "snapshot"}
	first, err := paginate(items, q, "test", "all", sync, identity)
	if err != nil || !reflect.DeepEqual(first.Items, []string{"a", "b"}) || first.NextCursor == nil || calls != len(items) || !reflect.DeepEqual(items, original) {
		t.Fatal(first, err, calls, items)
	}
	q.Set("cursor", *first.NextCursor)
	calls = 0
	second, err := paginate(items, q, "test", "all", sync, identity)
	if err != nil || !reflect.DeepEqual(second.Items, []string{"c", "d"}) || second.NextCursor == nil || calls != len(items) {
		t.Fatal(second, err, calls)
	}
	q.Set("cursor", *second.NextCursor)
	last, err := paginate(items, q, "test", "all", sync, identity)
	if err != nil || !reflect.DeepEqual(last.Items, []string{"e"}) || last.NextCursor != nil {
		t.Fatal(last, err)
	}
	empty, err := paginate([]string{}, url.Values{}, "test", "all", sync, identity)
	if err != nil || empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != nil {
		t.Fatal(empty, err)
	}
}
