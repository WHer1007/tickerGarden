package content

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"io"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var authAddress = regexp.MustCompile(`^0x[0-9a-f]{40}$`)
var authDigest = regexp.MustCompile(`^[0-9a-f]{64}$`)
var ErrUploadLimited = errors.New("upload rate limited")
var ErrUploadAuth = errors.New("invalid upload authorization")

type UploadChallenge struct {
	Nonce   string `json:"nonce"`
	Account string `json:"account"`
	Digest  string `json:"digest"`
	Expires int64  `json:"expires"`
	ChainID uint64 `json:"chainId"`
	Message string `json:"message"`
}

func UploadMessage(origin string, chain uint64, c UploadChallenge) string {
	return fmt.Sprintf("TickerGarden Metadata Upload\nOrigin: %s\nChain ID: %d\nWallet: %s\nContent SHA-256: %s\nNonce: %s\nExpires: %d\nAuthorize one metadata upload. No transaction or token approval.", origin, chain, c.Account, c.Digest, c.Nonce, c.Expires)
}
func verifyUploadSignature(c UploadChallenge, sig string) bool {
	raw, e := hex.DecodeString(strings.TrimPrefix(sig, "0x"))
	if e != nil || len(raw) != 65 {
		return false
	}
	if raw[64] >= 27 {
		raw[64] -= 27
	}
	if raw[64] > 1 {
		return false
	}
	pub, e := crypto.SigToPub(accounts.TextHash([]byte(c.Message)), raw)
	return e == nil && strings.EqualFold(crypto.PubkeyToAddress(*pub).Hex(), c.Account)
}

type UploadAuthorizer struct {
	Pool    *pgxpool.Pool
	Origin  string
	ChainID uint64
}

// Row updates are serialized by PostgreSQL, across processes and restarts.
func limitUpload(ctx context.Context, tx pgx.Tx, key string, seconds, max int, now time.Time) error {
	bucket := now.Unix() / int64(seconds)
	var count int
	e := tx.QueryRow(ctx, `INSERT INTO tickergarden.content_upload_limits(key,bucket,count,expires_at) VALUES($1,$2,1,$3) ON CONFLICT(key) DO UPDATE SET bucket=excluded.bucket,count=CASE WHEN content_upload_limits.bucket=excluded.bucket THEN content_upload_limits.count+1 ELSE 1 END,expires_at=excluded.expires_at RETURNING count`, key, bucket, now.Add(time.Duration(seconds)*time.Second)).Scan(&count)
	if e != nil {
		return e
	}
	if count > max {
		return ErrUploadLimited
	}
	return nil
}
func (a UploadAuthorizer) Challenge(ctx context.Context, account, digest, ip string) (UploadChallenge, error) {
	c := UploadChallenge{Account: strings.ToLower(account), Digest: digest, ChainID: a.ChainID, Expires: time.Now().Unix() + 300}
	if !authAddress.MatchString(c.Account) || c.Account == "0x"+strings.Repeat("0", 40) || !authDigest.MatchString(digest) {
		return c, ErrUploadAuth
	}
	nonce := make([]byte, 32)
	if _, e := rand.Read(nonce); e != nil {
		return c, e
	}
	c.Nonce = hex.EncodeToString(nonce)
	c.Message = UploadMessage(a.Origin, a.ChainID, c)
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return c, e
	}
	defer tx.Rollback(ctx)
	now := time.Now()
	for _, l := range []struct {
		key          string
		seconds, max int
	}{{"challenge:global", 60, 120}, {"challenge:ip:" + ip, 60, 10}} {
		if e = limitUpload(ctx, tx, l.key, l.seconds, l.max, now); e != nil {
			return c, e
		}
	}
	if _, e = tx.Exec(ctx, `DELETE FROM tickergarden.content_upload_challenges WHERE expires_at<now()-interval '1 day'`); e != nil {
		return c, e
	}
	if _, e = tx.Exec(ctx, `DELETE FROM tickergarden.content_upload_limits WHERE expires_at<now()`); e != nil {
		return c, e
	}
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.content_upload_challenges(nonce,account,digest,expires_at) VALUES($1,$2,$3,to_timestamp($4))`, c.Nonce, c.Account, c.Digest, c.Expires)
	if e != nil {
		return c, e
	}
	return c, tx.Commit(ctx)
}
func (a UploadAuthorizer) Consume(ctx context.Context, nonce, signature, digest, ip string) error {
	if !authDigest.MatchString(nonce) || len(signature) != 132 {
		return ErrUploadAuth
	}
	var c UploadChallenge
	c.Nonce = nonce
	c.ChainID = a.ChainID
	e := a.Pool.QueryRow(ctx, `SELECT account,digest,extract(epoch from expires_at)::bigint FROM tickergarden.content_upload_challenges WHERE nonce=$1 AND NOT used AND expires_at>now()`, nonce).Scan(&c.Account, &c.Digest, &c.Expires)
	if e == pgx.ErrNoRows {
		return ErrUploadAuth
	}
	if e != nil {
		return e
	}
	c.Message = UploadMessage(a.Origin, a.ChainID, c)
	if c.Digest != digest || !verifyUploadSignature(c, signature) {
		return ErrUploadAuth
	}
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	now := time.Now()
	for _, l := range []struct {
		key          string
		seconds, max int
	}{{"upload:global:day", 86400, 200}, {"upload:global:hour", 3600, 50}, {"upload:ip:day:" + ip, 86400, 100}, {"upload:ip:hour:" + ip, 3600, 30}, {"upload:wallet:day:" + c.Account, 86400, 20}, {"upload:wallet:hour:" + c.Account, 3600, 5}} {
		if e = limitUpload(ctx, tx, l.key, l.seconds, l.max, now); e != nil {
			return e
		}
	}
	tag, e := tx.Exec(ctx, `UPDATE tickergarden.content_upload_challenges SET used=true WHERE nonce=$1 AND NOT used AND expires_at>now()`, nonce)
	if e != nil {
		return e
	}
	if tag.RowsAffected() != 1 {
		return ErrUploadAuth
	}
	return tx.Commit(ctx)
}
func (a UploadAuthorizer) Wrap(next http.Handler) http.Handler {
	slots := make(chan struct{}, 4)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			next.ServeHTTP(w, r)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			w.Header().Set("Retry-After", "5")
			http.Error(w, "upload busy", 429)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Vary", "Origin")
		fail := func(code int, message string) {
			w.WriteHeader(code)
			json.NewEncoder(w).Encode(map[string]string{"error": message})
		}
		if r.Header.Get("Origin") != a.Origin {
			fail(403, "origin_not_allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", a.Origin)
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Upload-Nonce, X-Upload-Signature")
			w.WriteHeader(204)
			return
		}
		if r.Method != "POST" {
			fail(405, "method_not_allowed")
			return
		}
		if r.URL.RawQuery != "" {
			fail(400, "query_not_supported")
			return
		}
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
			fail(415, "content_type_required")
			return
		}
		ip, _, e := net.SplitHostPort(r.RemoteAddr)
		if e != nil {
			ip = r.RemoteAddr
		}
		ip = Digest([]byte(ip)) // Never trust caller-supplied forwarded headers.
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		handleError := func(err error) {
			if errors.Is(err, ErrUploadAuth) {
				fail(401, "upload_authorization_required")
			} else if errors.Is(err, ErrUploadLimited) {
				w.Header().Set("Retry-After", strconv.Itoa(60))
				fail(429, "upload_rate_limited")
			} else {
				fail(503, "upload_authorization_unavailable")
			}
		}
		if r.URL.Path == "/launch-metadata/challenge" {
			var body struct {
				Account string `json:"account"`
				Digest  string `json:"digest"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&body) != nil {
				fail(400, "invalid_request")
				return
			}
			c, e := a.Challenge(ctx, body.Account, body.Digest, ip)
			if e != nil {
				handleError(e)
				return
			}
			json.NewEncoder(w).Encode(c)
			return
		}
		if r.URL.Path != "/launch-metadata" {
			fail(404, "not_found")
			return
		}
		if !authDigest.MatchString(r.Header.Get("X-Upload-Nonce")) || len(r.Header.Get("X-Upload-Signature")) != 132 {
			fail(401, "upload_authorization_required")
			return
		}
		raw, e := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxBody))
		if e != nil {
			fail(413, "body_too_large")
			return
		}
		if e = a.Consume(ctx, r.Header.Get("X-Upload-Nonce"), r.Header.Get("X-Upload-Signature"), Digest(raw), ip); e != nil {
			handleError(e)
			return
		}
		r.Body = io.NopCloser(bytes.NewReader(raw))
		next.ServeHTTP(w, r)
	})
}
