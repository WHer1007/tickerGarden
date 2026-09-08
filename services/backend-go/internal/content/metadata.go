// Package content validates and stores immutable launch metadata. Metadata never
// authorizes protocol economics, which remain controlled by the Factory.
package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	_ "golang.org/x/image/webp"
)

const MaxBody = 3 << 20
const MaxImage = 2 << 20
const MaxPixels = 4096 * 4096

var symbolRE = regexp.MustCompile(`^[A-Z0-9]{1,16}$`)
var handleRE = regexp.MustCompile(`^[A-Za-z0-9_]{1,64}$`)
var keyRE = regexp.MustCompile(`^[a-f0-9]{64}\.(json|png|jpg|webp)$`)

type Object struct {
	Key           string
	Data          []byte
	Width, Height int
}
type Bundle struct {
	Metadata Object
	Image    *Object
}
type input struct {
	Name                 string  `json:"name"`
	Symbol               string  `json:"symbol"`
	Description          string  `json:"description"`
	Image                string  `json:"image"`
	X                    *string `json:"x"`
	Website              *string `json:"website"`
	CreatorFeesToHolders bool    `json:"creatorFeesToHolders"`
	CreatorTaxBps        int     `json:"creatorTaxBps"`
}

func Digest(data []byte) string { v := sha256.Sum256(data); return hex.EncodeToString(v[:]) }
func Origin(s string) bool {
	u, e := url.Parse(s)
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Path != "" || u.Opaque != "" {
		return false
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return false
	}
	return u.String() == s
}
func validText(s string, max int, optional bool) bool {
	return utf8.ValidString(s) && strings.TrimSpace(s) == s && (optional || s != "") && len(utf16.Encode([]rune(s))) <= max
}
func link(value *string, social bool) (*string, error) {
	if value == nil || *value == "" {
		return nil, nil
	}
	s := *value
	max := 512
	if social {
		max = 200
	}
	if !validText(s, max, false) {
		return nil, errors.New("invalid link")
	}
	if social {
		bare := strings.TrimPrefix(s, "@")
		if handleRE.MatchString(bare) {
			v := "https://x.com/" + bare
			return &v, nil
		}
		lower := strings.ToLower(s)
		if strings.HasPrefix(lower, "x.com/") || strings.HasPrefix(lower, "twitter.com/") {
			s = "https://" + s
		}
	}
	u, e := url.Parse(s)
	if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return nil, errors.New("invalid link")
	}
	if social {
		host := strings.ToLower(u.Hostname())
		path := strings.TrimSuffix(strings.TrimPrefix(u.Path, "/"), "/")
		if u.Scheme != "https" || (host != "x.com" && host != "twitter.com") || u.Port() != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.RawPath != "" || !handleRE.MatchString(path) {
			return nil, errors.New("invalid social URL")
		}
		s = "https://" + host + "/" + path
	} else {
		u.Host = strings.ToLower(u.Host)
		if u.Path == "" {
			u.Path = "/"
		}
		s = u.String()
	}
	return &s, nil
}
func parseInput(raw []byte) (input, error) {
	var in input
	if len(raw) > MaxBody || !utf8.Valid(raw) {
		return in, errors.New("invalid metadata body")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, e := d.Token()
	if e != nil || token != json.Delim('{') {
		return in, errors.New("expected metadata object")
	}
	seen := map[string]bool{}
	for d.More() {
		k, e := d.Token()
		if e != nil {
			return in, e
		}
		key, ok := k.(string)
		if !ok || seen[key] {
			return in, errors.New("duplicate metadata field")
		}
		seen[key] = true
		var value json.RawMessage
		if e = d.Decode(&value); e != nil {
			return in, e
		}
		switch key {
		case "name", "symbol", "description", "image", "creatorFeesToHolders", "creatorTaxBps":
			if bytes.Equal(value, []byte("null")) {
				return in, errors.New("null metadata field")
			}
		case "x", "website":
		default:
			return in, errors.New("unknown metadata field")
		}
	}
	if _, e = d.Token(); e != nil {
		return in, e
	}
	if _, e = d.Token(); e != io.EOF {
		return in, errors.New("trailing metadata data")
	}
	e = json.Unmarshal(raw, &in)
	return in, e
}
func decodeImage(s string) (*Object, error) {
	if s == "" {
		return nil, nil
	}
	parts := strings.SplitN(s, ",", 2)
	if len(parts) != 2 {
		return nil, errors.New("invalid image data URI")
	}
	formats := map[string]string{"data:image/png;base64": "png", "data:image/jpeg;base64": "jpeg", "data:image/webp;base64": "webp"}
	format, ok := formats[strings.ToLower(parts[0])]
	if !ok {
		return nil, errors.New("unsupported image")
	}
	raw, e := base64.StdEncoding.Strict().DecodeString(parts[1])
	if e != nil || len(raw) == 0 || len(raw) > MaxImage || base64.StdEncoding.EncodeToString(raw) != parts[1] {
		return nil, errors.New("invalid image base64 or size")
	}
	cfg, actual, e := image.DecodeConfig(bytes.NewReader(raw))
	if e != nil || actual != format || cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width > 4096 || cfg.Height > 4096 || int64(cfg.Width)*int64(cfg.Height) > MaxPixels {
		return nil, errors.New("invalid image dimensions or type")
	}
	decoded, actual, e := image.Decode(bytes.NewReader(raw))
	if e != nil || actual != format || decoded.Bounds().Dx() != cfg.Width || decoded.Bounds().Dy() != cfg.Height {
		return nil, errors.New("invalid image payload")
	}
	ext := format
	if ext == "jpeg" {
		ext = "jpg"
	}
	return &Object{Key: Digest(raw) + "." + ext, Data: raw, Width: cfg.Width, Height: cfg.Height}, nil
}
func Build(raw []byte, origin string) (Bundle, error) {
	fail := func(e error) (Bundle, error) { return Bundle{}, e }
	if !Origin(origin) {
		return fail(errors.New("invalid public origin"))
	}
	in, e := parseInput(raw)
	if e != nil {
		return fail(e)
	}
	if !validText(in.Name, 64, false) || !symbolRE.MatchString(in.Symbol) || !validText(in.Description, 1000, true) || in.CreatorTaxBps < 0 || in.CreatorTaxBps > 500 {
		return fail(errors.New("invalid launch metadata fields"))
	}
	x, e := link(in.X, true)
	if e != nil {
		return fail(e)
	}
	site, e := link(in.Website, false)
	if e != nil {
		return fail(e)
	}
	img, e := decodeImage(in.Image)
	if e != nil {
		return fail(e)
	}
	type launch struct {
		Holders bool `json:"creatorFeesToHolders"`
		Tax     int  `json:"creatorTaxBps"`
	}
	type properties struct {
		X       *string `json:"x"`
		Website *string `json:"website"`
		Launch  launch  `json:"launch"`
	}
	metadata := struct {
		Name        string     `json:"name"`
		Symbol      string     `json:"symbol"`
		Description string     `json:"description"`
		Image       string     `json:"image,omitempty"`
		External    *string    `json:"external_url,omitempty"`
		Properties  properties `json:"properties"`
	}{Name: in.Name, Symbol: in.Symbol, Description: in.Description, External: site, Properties: properties{x, site, launch{in.CreatorFeesToHolders, in.CreatorTaxBps}}}
	if img != nil {
		metadata.Image = origin + "/launch-metadata/" + img.Key
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if e = enc.Encode(metadata); e != nil {
		return fail(e)
	}
	payload := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	return Bundle{Metadata: Object{Key: Digest(payload) + ".json", Data: payload}, Image: img}, nil
}
