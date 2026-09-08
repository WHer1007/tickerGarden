package content

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const maxImportFiles = 1000
const maxImportBytes = 128 << 20

type ImportEntry struct {
	Key    string `json:"key"`
	Bytes  int    `json:"bytes"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}
type ImportReport struct {
	Origin     string        `json:"origin"`
	Entries    []ImportEntry `json:"entries"`
	TotalBytes int           `json:"totalBytes"`
}
type ImportPlan struct {
	report  ImportReport
	objects []Object
}

func (p ImportPlan) Report() ImportReport {
	r := p.report
	r.Entries = append([]ImportEntry(nil), r.Entries...)
	return r
}
func (p ImportPlan) Digest() string { raw, _ := json.Marshal(p.report); return Digest(raw) }

// ScanImport reads a bounded flat export. It retains exact original bytes;
// validation must never rewrite URLs, field order, whitespace or escapes.
func ScanImport(ctx context.Context, directory, origin string) (ImportPlan, error) {
	fail := func(e error) (ImportPlan, error) { return ImportPlan{}, e }
	if !Origin(origin) {
		return fail(errors.New("invalid import public origin"))
	}
	root, e := os.OpenRoot(directory)
	if e != nil {
		return fail(errors.New("cannot open import directory"))
	}
	defer root.Close()
	dir, e := root.Open(".")
	if e != nil {
		return fail(e)
	}
	entries, e := dir.ReadDir(maxImportFiles + 1)
	dir.Close()
	if e != nil && e != io.EOF {
		return fail(e)
	}
	if len(entries) == 0 || len(entries) > maxImportFiles {
		return fail(errors.New("import requires 1..1000 files"))
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	p := ImportPlan{report: ImportReport{Origin: origin, Entries: []ImportEntry{}}}
	for _, entry := range entries {
		if e = ctx.Err(); e != nil {
			return fail(e)
		}
		name := entry.Name()
		if !keyRE.MatchString(name) {
			return fail(fmt.Errorf("unexpected import entry: %s", name))
		}
		info, e := root.Lstat(name)
		if e != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > MaxImage {
			return fail(fmt.Errorf("invalid import file: %s", name))
		}
		f, e := root.Open(name)
		if e != nil {
			return fail(e)
		}
		opened, e := f.Stat()
		if e != nil || !os.SameFile(info, opened) || !opened.Mode().IsRegular() {
			f.Close()
			return fail(errors.New("import file changed"))
		}
		raw, e := io.ReadAll(io.LimitReader(f, MaxImage+1))
		f.Close()
		if e != nil || len(raw) > MaxImage || !strings.HasPrefix(name, Digest(raw)+".") {
			return fail(fmt.Errorf("import hash or size mismatch: %s", name))
		}
		p.report.TotalBytes += len(raw)
		if p.report.TotalBytes > maxImportBytes {
			return fail(errors.New("import exceeds 128 MiB"))
		}
		o := Object{Key: name, Data: raw}
		if !strings.HasSuffix(name, ".json") {
			format := strings.Split(name, ".")[1]
			if format == "jpg" {
				format = "jpeg"
			}
			decoded, e := decodeImage("data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(raw))
			if e != nil {
				return fail(fmt.Errorf("invalid import image: %s", name))
			}
			o = *decoded
		}
		p.objects = append(p.objects, o)
		p.report.Entries = append(p.report.Entries, ImportEntry{o.Key, len(o.Data), o.Width, o.Height})
	}
	if e = validateImport(p); e != nil {
		return fail(e)
	}
	return p, nil
}
func validateImport(p ImportPlan) error {
	objects := map[string]Object{}
	for _, o := range p.objects {
		objects[o.Key] = o
	}
	for _, o := range p.objects {
		if !strings.HasSuffix(o.Key, ".json") {
			continue
		}
		// Reconstruct the input and compare semantic output, while storing the original
		// byte representation. This accepts legacy JSON ordering and escaped strings.
		var legacy struct {
			Name        string  `json:"name"`
			Symbol      string  `json:"symbol"`
			Description string  `json:"description"`
			Image       string  `json:"image"`
			External    *string `json:"external_url"`
			Properties  struct {
				X       *string `json:"x"`
				Website *string `json:"website"`
				Launch  struct {
					Holders bool `json:"creatorFeesToHolders"`
					Tax     int  `json:"creatorTaxBps"`
				} `json:"launch"`
			} `json:"properties"`
		}
		// Duplicate keys at any depth are ambiguous even when decoded values agree.
		if e := uniqueJSON(o.Data); e != nil {
			return e
		}
		d := json.NewDecoder(bytes.NewReader(o.Data))
		d.DisallowUnknownFields()
		if e := d.Decode(&legacy); e != nil {
			return fmt.Errorf("invalid legacy metadata: %s", o.Key)
		}
		in := input{Name: legacy.Name, Symbol: legacy.Symbol, Description: legacy.Description, X: legacy.Properties.X, Website: legacy.Properties.Website, CreatorFeesToHolders: legacy.Properties.Launch.Holders, CreatorTaxBps: legacy.Properties.Launch.Tax}
		if legacy.Image != "" {
			prefix := p.report.Origin + "/launch-metadata/"
			if !strings.HasPrefix(legacy.Image, prefix) {
				return errors.New("legacy image origin mismatch")
			}
			key := strings.TrimPrefix(legacy.Image, prefix)
			image, ok := objects[key]
			if !ok || strings.HasSuffix(key, ".json") {
				return errors.New("legacy image reference missing from import")
			}
			format := strings.Split(key, ".")[1]
			if format == "jpg" {
				format = "jpeg"
			}
			in.Image = "data:image/" + format + ";base64," + base64.StdEncoding.EncodeToString(image.Data)
		}
		raw, _ := json.Marshal(in)
		built, e := Build(raw, p.report.Origin)
		if e != nil {
			return fmt.Errorf("invalid legacy metadata fields: %s", o.Key)
		}
		var a, b any
		if json.Unmarshal(o.Data, &a) != nil || json.Unmarshal(built.Metadata.Data, &b) != nil {
			return errors.New("invalid legacy JSON")
		}
		aa, _ := json.Marshal(a)
		bb, _ := json.Marshal(b)
		if !bytes.Equal(aa, bb) {
			return fmt.Errorf("legacy metadata schema or normalized value mismatch: %s", o.Key)
		}
	}
	return nil
}
func uniqueJSON(raw []byte) error {
	if !utf8.Valid(raw) {
		return errors.New("invalid UTF-8 metadata")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	var value func(int) error
	value = func(depth int) error {
		if depth > 16 {
			return errors.New("metadata nesting too deep")
		}
		tok, e := d.Token()
		if e != nil {
			return e
		}
		switch tok {
		case json.Delim('{'):
			seen := map[string]bool{}
			for d.More() {
				key, e := d.Token()
				if e != nil {
					return e
				}
				s, ok := key.(string)
				if !ok || seen[strings.ToLower(s)] {
					return errors.New("duplicate metadata key")
				}
				seen[strings.ToLower(s)] = true
				if e = value(depth + 1); e != nil {
					return e
				}
			}
			end, e := d.Token()
			if e != nil || end != json.Delim('}') {
				return errors.New("invalid object")
			}
		case json.Delim('['):
			for d.More() {
				if e = value(depth + 1); e != nil {
					return e
				}
			}
			end, e := d.Token()
			if e != nil || end != json.Delim(']') {
				return errors.New("invalid array")
			}
		}
		return nil
	}
	if e := value(0); e != nil {
		return e
	}
	if _, e := d.Token(); e != io.EOF {
		return errors.New("trailing metadata data")
	}
	return nil
}

// ApplyImport atomically writes the reviewed inventory and an immutable audit.
// Retrying the same digest is safe after an uncertain commit or process failure.
func (s Store) ApplyImport(ctx context.Context, p ImportPlan, expected string) error {
	if len(p.objects) == 0 || p.Digest() != expected {
		return errors.New("import inventory digest mismatch")
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{})
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	// Serialize before taking object row locks: imports and uploads can otherwise
	// acquire the shared quota row and deduplicated image rows in opposite order.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('tickergarden:content-write',0))`); e != nil {
		return e
	}
	for _, o := range p.objects {
		if e = saveObject(ctx, tx, o); e != nil {
			return e
		}
	}
	raw, _ := json.Marshal(p.report)
	_, e = tx.Exec(ctx, `INSERT INTO tickergarden.content_imports(digest,report) VALUES($1,$2) ON CONFLICT(digest) DO NOTHING`, expected, raw)
	if e != nil {
		return e
	}
	var stored []byte
	if e = tx.QueryRow(ctx, `SELECT report FROM tickergarden.content_imports WHERE digest=$1`, expected).Scan(&stored); e != nil || !bytes.Equal(raw, stored) {
		return errors.New("import audit mismatch")
	}
	if e = tx.Commit(ctx); e != nil {
		return errors.New("import commit uncertain; retry the same inventory digest")
	}
	return nil
}
