package content

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

var cidRE = regexp.MustCompile(`^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58})$`)

type Publisher interface {
	Publish(context.Context, Bundle) (Bundle, string, error)
}

// Pinata publishes validated content on public IPFS. Credentials never leave the server.
// The bounded cache coalesces identical requests within this process; CIDs are immutable.
type Pinata struct {
	JWT      string
	CacheDir string
	GroupID  string
	objects  map[string]string
	Client   *http.Client
	endpoint string
	mu       sync.Mutex
	cache    map[string]struct {
		bundle Bundle
		uri    string
	}
}

func NewPinata(jwt string) *Pinata {
	return &Pinata{JWT: jwt, Client: &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, endpoint: "https://uploads.pinata.cloud/v3/files"}
}
func (p *Pinata) upload(ctx context.Context, o Object) (string, error) {
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, e := form.CreateFormFile("file", o.Key)
	if e != nil {
		return "", e
	}
	if _, e = part.Write(o.Data); e != nil {
		return "", e
	}
	if e = form.WriteField("network", "public"); e != nil {
		return "", e
	}
	if p.GroupID != "" {
		if e = form.WriteField("group_id", p.GroupID); e != nil {
			return "", e
		}
	}
	if e = form.Close(); e != nil {
		return "", e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, &body)
	if e != nil {
		return "", e
	}
	req.Header.Set("Authorization", "Bearer "+p.JWT)
	req.Header.Set("Content-Type", form.FormDataContentType())
	res, e := p.Client.Do(req)
	if e != nil {
		return "", errors.New("IPFS upload unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return "", errors.New("IPFS upload rejected")
	}
	var result struct {
		Data struct {
			CID     string `json:"cid"`
			GroupID string `json:"group_id"`
		} `json:"data"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(&result); e != nil || !cidRE.MatchString(result.Data.CID) {
		return "", errors.New("invalid IPFS upload response")
	}
	if p.GroupID != "" && result.Data.GroupID != p.GroupID {
		return "", errors.New("IPFS upload group mismatch")
	}
	return "ipfs://" + result.Data.CID, nil
}
func (p *Pinata) Publish(ctx context.Context, b Bundle) (Bundle, string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if e := ctx.Err(); e != nil {
		return Bundle{}, "", e
	}
	key := b.Metadata.Key
	if v, ok := p.cache[key]; ok {
		return v.bundle, v.uri, nil
	}
	var metadata map[string]json.RawMessage
	if e := json.Unmarshal(b.Metadata.Data, &metadata); e != nil {
		return Bundle{}, "", e
	}
	if b.Image != nil {
		uri, e := p.uploadOnce(ctx, *b.Image)
		if e != nil {
			return Bundle{}, "", e
		}
		metadata["image"], _ = json.Marshal(uri)
	}
	data, e := json.Marshal(metadata)
	if e != nil {
		return Bundle{}, "", e
	}
	b.Metadata = Object{Key: Digest(data) + ".json", Data: data}
	uri, e := p.uploadOnce(ctx, b.Metadata)
	if e != nil {
		return Bundle{}, "", e
	}
	if len(p.cache) >= 16 {
		p.cache = nil
	}
	if p.cache == nil {
		p.cache = make(map[string]struct {
			bundle Bundle
			uri    string
		})
	}
	p.cache[key] = struct {
		bundle Bundle
		uri    string
	}{b, uri}
	return b, uri, nil
}

// Cache each object as soon as its upload succeeds. A later JSON failure or
// process restart must not upload an already recorded logo again.
func (p *Pinata) uploadOnce(ctx context.Context, o Object) (string, error) {
	key := Digest(o.Data)
	if uri := p.objects[key]; uri != "" {
		return uri, nil
	}
	var path string
	if p.CacheDir != "" {
		path = filepath.Join(p.CacheDir, key+".json")
		raw, e := os.ReadFile(path)
		if e == nil {
			var record struct {
				Digest string `json:"digest"`
				URI    string `json:"uri"`
			}
			if json.Unmarshal(raw, &record) != nil || record.Digest != key || !strings.HasPrefix(record.URI, "ipfs://") || !cidRE.MatchString(strings.TrimPrefix(record.URI, "ipfs://")) {
				return "", errors.New("invalid publication cache record")
			}
			return record.URI, nil
		}
		if !errors.Is(e, os.ErrNotExist) {
			return "", errors.New("publication cache unavailable")
		}
	}
	uri, e := p.upload(ctx, o)
	if e != nil {
		return "", e
	}
	if path != "" {
		raw, _ := json.Marshal(map[string]string{"digest": key, "uri": uri})
		f, e := os.CreateTemp(p.CacheDir, ".publication-*")
		if e != nil {
			return "", errors.New("cannot persist publication")
		}
		temp := f.Name()
		defer os.Remove(temp)
		_, e = f.Write(raw)
		if e == nil {
			e = f.Sync()
		}
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		if e == nil {
			e = os.Rename(temp, path)
		}
		if e != nil {
			return "", errors.New("cannot persist publication")
		}
	}
	if len(p.objects) >= 512 {
		p.objects = nil
	}
	if p.objects == nil {
		p.objects = make(map[string]string)
	}
	p.objects[key] = uri
	return uri, nil
}
