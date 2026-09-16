package config

import (
	"log/slog"
	"strings"
	"testing"
	"time"
)

func env(values map[string]string) func(string) string {
	return func(k string) string { return values[k] }
}

func TestParseDefaults(t *testing.T) {
	c, err := Parse(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if c.Environment != "development" || c.HTTPAddr != "127.0.0.1:8790" || c.ChainID != 46630 || c.LogLevel != slog.LevelInfo || c.ShutdownTimeout != 10*time.Second || c.ProbeTimeout != 2*time.Second || c.DBMaxConns != 10 {
		t.Fatalf("unexpected defaults: %+v", c)
	}
}

func TestParseRejectsInvalidValues(t *testing.T) {
	cases := []map[string]string{{"TG_ENV": "staging"}, {"TG_HTTP_ADDR": "localhost:0"}, {"TG_HTTP_ADDR": "127.0.0.1:99999"}, {"TG_CHAIN_ID": "1"}, {"TG_WEB_ORIGIN": "https://user:pass@example.com/x"}, {"TG_WEB_ORIGIN": "https://example.com/"}, {"TG_WEB_ORIGIN": "https://example.com?"}, {"TG_WEB_ORIGIN": "https://example.com#"}, {"TG_WEB_ORIGIN": "https://example.com:0"}, {"TG_DB_MAX_CONNS": "101"}, {"TG_SHUTDOWN_TIMEOUT": "0s"}, {"TG_PROBE_TIMEOUT": "3s", "TG_SHUTDOWN_TIMEOUT": "2s"}, {"TG_PROBE_TIMEOUT": "nonsense"}}
	for _, values := range cases {
		if _, err := Parse(env(values)); err == nil {
			t.Errorf("expected error for %#v", values)
		}
	}
}

func TestDatabaseErrorsRedactCredentials(t *testing.T) {
	secret := "postgres://user:super-secret@"
	_, err := Parse(env(map[string]string{"TG_DATABASE_URL": secret + "[bad"}))
	if err == nil || strings.Contains(err.Error(), "super-secret") || strings.Contains(err.Error(), secret) {
		t.Fatalf("error leaked DSN: %v", err)
	}
}

func TestParseConfiguredValues(t *testing.T) {
	c, err := Parse(env(map[string]string{"TG_ENV": "test", "TG_HTTP_ADDR": "[::1]:8080", "TG_CHAIN_ID": "4663", "TG_DATABASE_URL": "postgresql://db/app", "TG_LOG_LEVEL": "debug", "TG_WEB_ORIGIN": "https://example.com", "TG_SHUTDOWN_TIMEOUT": "30s", "TG_PROBE_TIMEOUT": "5s", "TG_DB_MAX_CONNS": "20"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.ChainID != 4663 || c.LogLevel != slog.LevelDebug || c.DBMaxConns != 20 || c.AllowedOrigin != "https://example.com" {
		t.Fatalf("unexpected config: %+v", c)
	}
}

func TestParseArbitrumSepoliaChainID(t *testing.T) {
	c, err := Parse(env(map[string]string{"TG_CHAIN_ID": "421614"}))
	if err != nil {
		t.Fatal(err)
	}
	if c.ChainID != 421614 {
		t.Fatalf("unexpected chain id: %d", c.ChainID)
	}
}

func TestParseNilGetter(t *testing.T) {
	if _, err := Parse(nil); err == nil {
		t.Fatal("expected nil getter error")
	}
}

func TestDatabaseURLRequiresDatabaseAndValidPort(t *testing.T) {
	for _, v := range []string{"postgres://db", "postgres://db/", "postgres://db:0/app", "postgres://db:65536/app", "postgres://db/app#fragment"} {
		if _, err := Parse(env(map[string]string{"TG_DATABASE_URL": v})); err == nil {
			t.Errorf("expected rejection for %q", v)
		}
	}
}
