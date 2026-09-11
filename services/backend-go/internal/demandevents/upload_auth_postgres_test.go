package demandevents

import (
	"context"
	"encoding/hex"
	"errors"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/crypto"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"tickergarden/backend/internal/content"
)

func TestUploadAuthorizationSecurity(t *testing.T) {
	pool, cleanup := demandTestDB(t)
	defer cleanup()
	ctx := context.Background()
	key, _ := crypto.GenerateKey()
	wallet := strings.ToLower(crypto.PubkeyToAddress(key.PublicKey).Hex())
	digest := content.Digest([]byte(`{"name":"Token"}`))
	a := content.UploadAuthorizer{Pool: pool, Origin: "https://web.example", ChainID: 46630}
	sign := func(c content.UploadChallenge) string {
		raw, e := crypto.Sign(accounts.TextHash([]byte(c.Message)), key)
		if e != nil {
			t.Fatal(e)
		}
		raw[64] += 27
		return "0x" + hex.EncodeToString(raw)
	}
	c, e := a.Challenge(ctx, wallet, digest, "ip")
	if e != nil {
		t.Fatal(e)
	}
	if e = a.Consume(ctx, c.Nonce, sign(c), content.Digest([]byte("changed")), "ip"); !errors.Is(e, content.ErrUploadAuth) {
		t.Fatalf("tampered body: %v", e)
	}
	wrong := c
	wrong.Message = strings.Replace(c.Message, "46630", "4663", 1)
	if e = a.Consume(ctx, c.Nonce, sign(wrong), digest, "ip"); !errors.Is(e, content.ErrUploadAuth) {
		t.Fatalf("wrong chain: %v", e)
	}
	other := a
	other.Origin = "https://evil.example"
	if e = other.Consume(ctx, c.Nonce, sign(c), digest, "ip"); !errors.Is(e, content.ErrUploadAuth) {
		t.Fatalf("wrong origin: %v", e)
	}
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if a.Consume(ctx, c.Nonce, sign(c), digest, "ip") == nil {
				successes.Add(1)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 1 {
		t.Fatalf("replay accepted %d times", successes.Load())
	}
	if e = a.Consume(ctx, c.Nonce, sign(c), digest, "ip"); !errors.Is(e, content.ErrUploadAuth) {
		t.Fatalf("replay: %v", e)
	}
	expired, e := a.Challenge(ctx, wallet, digest, "ip")
	if e != nil {
		t.Fatal(e)
	}
	_, e = pool.Exec(ctx, `UPDATE tickergarden.content_upload_challenges SET expires_at=now()-interval '1 second' WHERE nonce=$1`, expired.Nonce)
	if e != nil {
		t.Fatal(e)
	}
	if e = a.Consume(ctx, expired.Nonce, sign(expired), digest, "ip"); !errors.Is(e, content.ErrUploadAuth) {
		t.Fatalf("expired: %v", e)
	}
	c, e = a.Challenge(ctx, wallet, digest, "ip")
	if e != nil {
		t.Fatal(e)
	}
	accepted := 0
	secured := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { accepted++; w.WriteHeader(201) }))
	request := httptest.NewRequest("POST", "/launch-metadata", strings.NewReader(`{"name":"Token"}`))
	request.Header.Set("Origin", a.Origin)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Upload-Nonce", c.Nonce)
	request.Header.Set("X-Upload-Signature", sign(c))
	response := httptest.NewRecorder()
	secured.ServeHTTP(response, request)
	if response.Code != 201 || accepted != 1 {
		t.Fatalf("authorized upload failed %d %s", response.Code, response.Body.String())
	}
	for i := 0; i < 3; i++ {
		c, e = a.Challenge(ctx, wallet, digest, "ip")
		if e != nil {
			t.Fatal(e)
		}
		if e = a.Consume(ctx, c.Nonce, sign(c), digest, "ip"); e != nil {
			t.Fatal(e)
		}
	}
	c, e = a.Challenge(ctx, wallet, digest, "ip")
	if e != nil {
		t.Fatal(e)
	}
	if e = a.Consume(ctx, c.Nonce, sign(c), digest, "new-ip"); !errors.Is(e, content.ErrUploadLimited) {
		t.Fatalf("wallet limit: %v", e)
	}
	var calls int
	handler := a.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(201) }))
	r := httptest.NewRequest("POST", "/launch-metadata", strings.NewReader(`{}`))
	r.Header.Set("Origin", a.Origin)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if w.Code != 401 || calls != 0 {
		t.Fatalf("unsigned forged-origin upload reached publisher %d/%d", w.Code, calls)
	}
}
