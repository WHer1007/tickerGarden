package content

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

var testCID = "Qm" + strings.Repeat("a", 44)

func TestPinataPublishUsesPublicNetworkAndLinksImageBeforeMetadata(t *testing.T) {
	var keys []string
	var networks []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("method = %s", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer test-jwt" {
			t.Errorf("missing authorization")
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		networks = append(networks, r.FormValue("network"))
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		keys = append(keys, r.MultipartForm.File["file"][0].Filename)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"data":{"cid":"`+testCID+`"}}`)
	}))
	defer server.Close()

	p := NewPinata("test-jwt")
	p.endpoint = server.URL
	bundle := Bundle{
		Metadata: Object{Key: "metadata-key", Data: []byte(`{"name":"Garden"}`)},
		Image:    &Object{Key: "logo.png", Data: []byte("image")},
	}
	got, uri, err := p.Publish(context.Background(), bundle)
	if err != nil {
		t.Fatal(err)
	}
	if uri != "ipfs://"+testCID || len(keys) != 2 || len(networks) != 2 {
		t.Fatalf("uploads = %v networks = %v uri = %s", keys, networks, uri)
	}
	if keys[0] != "logo.png" || keys[1] != ""+Digest([]byte(`{"image":"ipfs://`+testCID+`","name":"Garden"}`))+".json" {
		t.Fatalf("upload order/metadata key = %v", keys)
	}
	for _, network := range networks {
		if network != "public" {
			t.Fatalf("network = %q", network)
		}
	}
	var metadata map[string]string
	if err := json.Unmarshal(got.Metadata.Data, &metadata); err != nil || metadata["image"] != "ipfs://"+testCID {
		t.Fatalf("linked metadata = %s", got.Metadata.Data)
	}
}

func TestPinataPublishCachesIdenticalRequestWithoutUploadingAgain(t *testing.T) {
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		count++
		io.WriteString(w, `{"data":{"cid":"`+testCID+`"}}`)
	}))
	defer server.Close()
	p := NewPinata("jwt")
	p.endpoint = server.URL
	b := Bundle{Metadata: Object{Key: "same-key", Data: []byte(`{"name":"Garden"}`)}}
	first, firstURI, err := p.Publish(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	second, secondURI, err := p.Publish(context.Background(), b)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 || firstURI != secondURI || string(first.Metadata.Data) != string(second.Metadata.Data) {
		t.Fatalf("count=%d uris=%q/%q", count, firstURI, secondURI)
	}
}

func TestPinataPublishRejectsUploadFailureAndMalformedCID(t *testing.T) {
	for _, tc := range []struct {
		name string
		code int
		body string
	}{
		{"upload failure", http.StatusBadGateway, `{}`},
		{"malformed cid", http.StatusOK, `{"data":{"cid":"not-a-cid"}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.code)
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			p := NewPinata("jwt")
			p.endpoint = server.URL
			_, _, err := p.Publish(context.Background(), Bundle{Metadata: Object{Key: "bad", Data: []byte(`{"name":"Garden"}`)}})
			if err == nil {
				t.Fatal("expected publish error")
			}
		})
	}
}

func TestPinataResumeAfterJSONFailureAndRestart(t *testing.T) {
	dir := t.TempDir()
	imageUploads, jsonUploads := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if e := r.ParseMultipartForm(1 << 20); e != nil {
			t.Error(e)
			w.WriteHeader(400)
			return
		}
		f, _, e := r.FormFile("file")
		if e != nil {
			t.Error(e)
			return
		}
		defer f.Close()
		raw, _ := io.ReadAll(f)
		if string(raw) == "logo-bytes" {
			imageUploads++
		} else {
			jsonUploads++
			if jsonUploads == 1 {
				w.WriteHeader(503)
				return
			}
		}
		io.WriteString(w, `{"data":{"cid":"`+testCID+`"}}`)
	}))
	defer server.Close()
	b := Bundle{Metadata: Object{Key: "original", Data: []byte(`{"name":"Token"}`)}, Image: &Object{Key: "logo.png", Data: []byte("logo-bytes")}}
	first := NewPinata("test")
	first.CacheDir = dir
	first.endpoint = server.URL
	if _, _, e := first.Publish(context.Background(), b); e == nil {
		t.Fatal("expected second upload failure")
	}
	restarted := NewPinata("test")
	restarted.CacheDir = dir
	restarted.endpoint = server.URL
	if _, _, e := restarted.Publish(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	if imageUploads != 1 || jsonUploads != 2 {
		t.Fatalf("image=%d json=%d", imageUploads, jsonUploads)
	}
	third := NewPinata("test")
	third.CacheDir = dir
	third.endpoint = server.URL
	if _, _, e := third.Publish(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	if imageUploads != 1 || jsonUploads != 2 {
		t.Fatal("restart repeated successful upload")
	}
}

func TestPinataUploadGroupUsesV3GroupID(t *testing.T) {
	group := "5068e78c-3f65-483c-94ac-aa72b3b4b15e"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if e := r.ParseMultipartForm(1 << 20); e != nil {
			t.Error(e)
			return
		}
		if r.FormValue("group_id") != group || r.FormValue("group") != "" {
			t.Error("incorrect group field")
		}
		io.WriteString(w, `{"data":{"cid":"`+testCID+`","group_id":"`+group+`"}}`)
	}))
	defer server.Close()
	p := NewPinata("test")
	p.GroupID = group
	p.endpoint = server.URL
	if _, e := p.upload(context.Background(), Object{Key: "test.json", Data: []byte(`{}`)}); e != nil {
		t.Fatal(e)
	}
}
