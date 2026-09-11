package content

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func metadataJSON(extra string) []byte {
	return []byte(`{"name":"Garden","symbol":"GRDN","description":"A token"` + extra + `,"creatorFeesToHolders":true,"creatorTaxBps":25}`)
}

func encodedImage(t *testing.T, format string, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 20, G: 40, B: 60, A: 255})
	var b bytes.Buffer
	var err error
	if format == "png" {
		err = png.Encode(&b, img)
	} else {
		err = jpeg.Encode(&b, img, &jpeg.Options{Quality: 90})
	}
	if err != nil {
		t.Fatal(err)
	}
	mime := "png"
	if format == "jpeg" {
		mime = "jpeg"
	}
	return "data:image/" + mime + ";base64," + base64.StdEncoding.EncodeToString(b.Bytes())
}

func TestBuildValidOptionalAndDeterministic(t *testing.T) {
	raw := metadataJSON(`,"image":""`)
	a, err := Build(raw, "https://example.com")
	if err != nil {
		t.Fatal(err)
	}
	if a.Image != nil || a.Metadata.Key != Digest(a.Metadata.Data)+".json" {
		t.Fatalf("bad no-image bundle: %+v", a)
	}
	b, err := Build(raw, "https://example.com")
	if err != nil || !bytes.Equal(a.Metadata.Data, b.Metadata.Data) || a.Metadata.Key != b.Metadata.Key {
		t.Fatalf("non-deterministic build: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(a.Metadata.Data, &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out["image"]; ok {
		t.Error("empty image should be omitted")
	}
	if out["properties"].(map[string]any)["launch"].(map[string]any)["creatorTaxBps"] != float64(25) {
		t.Error("launch preferences missing")
	}
}

func TestBuildPNGAndJPEG(t *testing.T) {
	for _, tc := range []struct{ format, ext string }{{"png", "png"}, {"jpeg", "jpg"}} {
		raw := metadataJSON(`,"image":"` + encodedImage(t, tc.format, 1, 1) + `"`)
		b, err := Build(raw, "https://example.com")
		if err != nil {
			t.Fatalf("%s: %v", tc.format, err)
		}
		if b.Image == nil || b.Image.Width != 1 || b.Image.Height != 1 || !strings.HasSuffix(b.Image.Key, "."+tc.ext) {
			t.Fatalf("bad %s image: %+v", tc.format, b.Image)
		}
		want := sha256.Sum256(b.Image.Data)
		if b.Image.Key != hex.EncodeToString(want[:])+"."+tc.ext {
			t.Error("image hash mismatch")
		}
		if !strings.Contains(string(b.Metadata.Data), "https://example.com/launch-metadata/"+b.Image.Key) {
			t.Error("image URI mismatch")
		}
	}
}

func TestBuildRejectsMalformedFields(t *testing.T) {
	cases := []string{
		`{"name":"Garden","symbol":"GRDN","description":"","creatorFeesToHolders":true,"creatorTaxBps":0,"name":"Again"}`,
		`{"name":"Garden","symbol":"GRDN","description":"","creatorFeesToHolders":true,"creatorTaxBps":0,"wat":1}`,
		`{"name":"Garden","symbol":"GRDN","description":"","creatorFeesToHolders":true,"creatorTaxBps":0,"image":null}`,
		string(metadataJSON(`,"x":"https://evil.com/user"`)), string(metadataJSON(`,"website":" javascript:alert(1)"`)),
		`{"name":"Garden","symbol":"GRDN","creatorFeesToHolders":"yes"}`, `{"name":"Garden","symbol":"GRDN","creatorTaxBps":501}`,
		`{"name":"Garden","symbol":"lower"}`,
		`{"Name":"Garden","symbol":"GRDN"}`,
	}
	for _, raw := range cases {
		if _, err := Build([]byte(raw), "https://example.com"); err == nil {
			t.Errorf("accepted malformed metadata: %s", raw)
		}
	}
}

func TestBuildRejectsImagePayloadAndDimensions(t *testing.T) {
	validMagic := "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{137, 80, 78, 71, 13, 10, 26, 10})
	for _, imageURI := range []string{validMagic, "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte("not png")), "data:image/png;base64," + base64.StdEncoding.EncodeToString([]byte{1, 2, 3})} {
		if _, err := Build(metadataJSON(`,"image":"`+imageURI+`"`), "https://example.com"); err == nil {
			t.Error("accepted invalid/truncated image")
		}
	}
	if _, err := Build(metadataJSON(`,"image":"`+encodedImage(t, "png", 4097, 1)+`"`), "https://example.com"); err == nil {
		t.Error("accepted oversized dimensions")
	}
}

func TestBuildUTF16AndOriginLimits(t *testing.T) {
	if _, err := Build([]byte(`{"name":"`+strings.Repeat("😀", 33)+`","symbol":"GRDN","description":"","creatorTaxBps":0}`), "https://example.com"); err == nil {
		t.Error("accepted name over UTF-16 limit")
	}
	if _, err := Build(metadataJSON(`,"x":"@alice"`), "https://example.com"); err != nil {
		t.Fatal(err)
	}
	if _, err := Build(metadataJSON(`,"website":"https://EXAMPLE.com"`), "https://example.com"); err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"http://example.com", "https://example.com/path", "https://example.com?x=1"} {
		if _, err := Build(metadataJSON(""), origin); err == nil {
			t.Errorf("accepted origin %s", origin)
		}
	}
}

func TestBuildWebPCompleteDecode(t *testing.T) {
	// Locally generated 1x1 RGB(20,40,60) lossless WebP using cwebp.
	const encoded = "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQlFKUp/+BiOh/AAA="
	b, err := Build(metadataJSON(`,"image":"data:image/webp;base64,`+encoded+`"`), "https://example.com")
	if err != nil || b.Image == nil || b.Image.Width != 1 || !strings.HasSuffix(b.Image.Key, ".webp") {
		t.Fatal("WebP decode", b, err)
	}
	raw, _ := base64.StdEncoding.DecodeString(encoded)
	if _, err = Build(metadataJSON(`,"image":"data:image/webp;base64,`+base64.StdEncoding.EncodeToString(raw[:len(raw)-8])+`"`), "https://example.com"); err == nil {
		t.Fatal("truncated WebP accepted")
	}
}

func TestBuildDescriptionLimit(t *testing.T) {
	for _, n := range []int{300, 301} {
		raw := []byte(strings.Replace(string(metadataJSON("")), "A token", strings.Repeat("文", n), 1))
		_, err := Build(raw, "https://example.com")
		if (err != nil) != (n > 300) {
			t.Fatalf("description length %d: %v", n, err)
		}
	}
}
