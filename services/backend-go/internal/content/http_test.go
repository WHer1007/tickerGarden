package content

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeStore struct {
	saved int
	err   error
}

type fakePublisher struct {
	calls int
	err   error
}

func (f *fakePublisher) Publish(_ context.Context, b Bundle) (Bundle, string, error) {
	f.calls++
	if f.err != nil {
		return Bundle{}, "", f.err
	}
	b.Metadata.Data = []byte(`{"name":"A","symbol":"A"}`)
	return b, "ipfs://Qm" + strings.Repeat("a", 44), nil
}

func TestUploadPublisherFailuresReturn503WithoutMetadataURIAndRespectStoreReservation(t *testing.T) {
	t.Run("publisher failure", func(t *testing.T) {
		store := &fakeStore{}
		publisher := &fakePublisher{err: errors.New("offline")}
		h, _ := NewHandler(store, "https://content.example", "https://web.example")
		h.Publisher = publisher
		r := httptest.NewRequest("POST", "/launch-metadata", strings.NewReader(`{"name":"A","symbol":"A"}`))
		r.Header.Set("Origin", "https://web.example")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 503 || strings.Contains(w.Body.String(), "metadataURI") || publisher.calls != 1 {
			t.Fatalf("status=%d body=%s calls=%d", w.Code, w.Body.String(), publisher.calls)
		}
	})
	t.Run("store failure prevents publisher", func(t *testing.T) {
		store := &fakeStore{err: errors.New("database unavailable")}
		publisher := &fakePublisher{}
		h, _ := NewHandler(store, "https://content.example", "https://web.example")
		h.Publisher = publisher
		r := httptest.NewRequest("POST", "/launch-metadata", strings.NewReader(`{"name":"A","symbol":"A"}`))
		r.Header.Set("Origin", "https://web.example")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 503 || publisher.calls != 0 {
			t.Fatalf("status=%d calls=%d", w.Code, publisher.calls)
		}
	})
}

func TestUploadSuccessfulPublisherReturnsPublicURIAndCanonicalMetadata(t *testing.T) {
	store := &fakeStore{}
	publisher := &fakePublisher{}
	h, _ := NewHandler(store, "https://content.example", "https://web.example")
	h.Publisher = publisher
	r := httptest.NewRequest("POST", "/launch-metadata", strings.NewReader(`{"symbol":"A","name":"A"}`))
	r.Header.Set("Origin", "https://web.example")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 201 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var response struct {
		MetadataURI string          `json:"metadataURI"`
		Metadata    json.RawMessage `json:"metadata"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.MetadataURI != "ipfs://Qm"+strings.Repeat("a", 44) || string(response.Metadata) != `{"name":"A","symbol":"A"}` || publisher.calls != 1 {
		t.Fatalf("uri=%q metadata=%s calls=%d", response.MetadataURI, response.Metadata, publisher.calls)
	}
}

func (f *fakeStore) Save(context.Context, Bundle) error          { f.saved++; return f.err }
func (f *fakeStore) Get(context.Context, string) (Object, error) { return Object{}, ErrMissing }
func TestUploadHTTPBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, origin, typ, body string
		code                                  int
	}{
		{"ok", "POST", "/launch-metadata", "https://web.example", "application/json", `{"name":"A","symbol":"A"}`, 201},
		{"no origin", "POST", "/launch-metadata", "", "application/json", `{}`, 403},
		{"foreign", "POST", "/launch-metadata", "https://evil.example", "application/json", `{}`, 403},
		{"bad type", "POST", "/launch-metadata", "https://web.example", "text/plain", `{}`, 415},
		{"invalid", "POST", "/launch-metadata", "https://web.example", "application/json", `{}`, 400},
		{"oversize", "POST", "/launch-metadata", "https://web.example", "application/json", strings.Repeat("x", MaxBody+1), 413},
		{"traversal", "GET", "/launch-metadata/../../secret", "", "", "", 404},
		{"delete", "DELETE", "/launch-metadata", "", "", "", 405},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &fakeStore{}
			h, _ := NewHandler(store, "https://content.example", "https://web.example")
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Origin", tc.origin)
			r.Header.Set("Content-Type", tc.typ)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.code {
				t.Fatal(w.Code, w.Body.String())
			}
			if tc.code != 201 && store.saved != 0 {
				t.Fatal("invalid request stored")
			}
		})
	}
	for _, e := range []error{ErrQuota, errors.New("private database connection string")} {
		store := &fakeStore{err: e}
		h, _ := NewHandler(store, "https://content.example", "https://web.example")
		r := httptest.NewRequest("POST", "/launch-metadata", bytes.NewBufferString(`{"name":"A","symbol":"A"}`))
		r.Header.Set("Origin", "https://web.example")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 503
		if errors.Is(e, ErrQuota) {
			want = 429
		}
		if w.Code != want || strings.Contains(w.Body.String(), "private") {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
