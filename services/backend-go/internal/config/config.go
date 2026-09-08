package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Environment     string
	HTTPAddr        string
	ChainID         uint64
	DatabaseURL     string
	LogLevel        slog.Level
	AllowedOrigin   string
	ShutdownTimeout time.Duration
	ProbeTimeout    time.Duration
	DBMaxConns      int32
}

func Load() (Config, error) { return Parse(os.Getenv) }

func Parse(getenv func(string) string) (Config, error) {
	if getenv == nil {
		return Config{}, errors.New("config: nil environment function")
	}
	c := Config{Environment: "development", HTTPAddr: "127.0.0.1:8790", ChainID: 46630,
		LogLevel: slog.LevelInfo, ShutdownTimeout: 10 * time.Second, ProbeTimeout: 2 * time.Second, DBMaxConns: 10}
	var err error
	if v := getenv("TG_ENV"); v != "" {
		c.Environment = v
	}
	if c.Environment != "development" && c.Environment != "test" && c.Environment != "production" {
		return Config{}, errors.New("config: invalid TG_ENV")
	}
	if v := getenv("TG_HTTP_ADDR"); v != "" {
		c.HTTPAddr = v
	}
	if err = validAddr(c.HTTPAddr); err != nil {
		return Config{}, fmt.Errorf("config: invalid TG_HTTP_ADDR: %w", err)
	}
	if v := getenv("TG_CHAIN_ID"); v != "" {
		c.ChainID, err = strconv.ParseUint(v, 10, 64)
		if err != nil || (c.ChainID != 4663 && c.ChainID != 46630 && c.ChainID != 421614) {
			return Config{}, errors.New("config: invalid TG_CHAIN_ID")
		}
	}
	if v := getenv("TG_DATABASE_URL"); v != "" {
		if err = validDBURL(v); err != nil {
			return Config{}, fmt.Errorf("config: invalid TG_DATABASE_URL")
		}
		c.DatabaseURL = v
	}
	if v := getenv("TG_LOG_LEVEL"); v != "" {
		switch strings.ToLower(v) {
		case "debug":
			c.LogLevel = slog.LevelDebug
		case "info":
			c.LogLevel = slog.LevelInfo
		case "warn":
			c.LogLevel = slog.LevelWarn
		case "error":
			c.LogLevel = slog.LevelError
		default:
			return Config{}, errors.New("config: invalid TG_LOG_LEVEL")
		}
	}
	if v := getenv("TG_WEB_ORIGIN"); v != "" {
		if err = validOrigin(v); err != nil {
			return Config{}, errors.New("config: invalid TG_WEB_ORIGIN")
		}
		c.AllowedOrigin = v
	}
	if v := getenv("TG_SHUTDOWN_TIMEOUT"); v != "" {
		c.ShutdownTimeout, err = validTimeout(v)
		if err != nil {
			return Config{}, errors.New("config: invalid TG_SHUTDOWN_TIMEOUT")
		}
	}
	if v := getenv("TG_PROBE_TIMEOUT"); v != "" {
		c.ProbeTimeout, err = validTimeout(v)
		if err != nil {
			return Config{}, errors.New("config: invalid TG_PROBE_TIMEOUT")
		}
	}
	if c.ProbeTimeout >= c.ShutdownTimeout {
		return Config{}, errors.New("config: probe timeout must be less than shutdown timeout")
	}
	if v := getenv("TG_DB_MAX_CONNS"); v != "" {
		n, e := strconv.ParseInt(v, 10, 32)
		if e != nil || n < 1 || n > 100 {
			return Config{}, errors.New("config: invalid TG_DB_MAX_CONNS")
		}
		c.DBMaxConns = int32(n)
	}
	return c, nil
}

func validAddr(s string) error {
	h, p, err := net.SplitHostPort(s)
	if err != nil || h == "" {
		return errors.New("address must be host:port")
	}
	n, err := strconv.Atoi(p)
	if err != nil || n < 1 || n > 65535 {
		return errors.New("port out of range")
	}
	return nil
}
func validDBURL(s string) error {
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() == "" || u.Path == "" || u.Path == "/" || u.Fragment != "" || u.ForceQuery {
		return errors.New("invalid postgres URL")
	}
	if u.Port() != "" {
		p, e := strconv.Atoi(u.Port())
		if e != nil || p < 1 || p > 65535 {
			return errors.New("invalid postgres URL")
		}
	}
	return nil
}
func validOrigin(s string) error {
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.ForceQuery || s != u.Scheme+"://"+u.Host {
		return errors.New("invalid origin")
	}
	if u.Port() != "" {
		p, e := strconv.Atoi(u.Port())
		if e != nil || p < 1 || p > 65535 {
			return errors.New("invalid origin")
		}
	}
	return nil
}
func validTimeout(s string) (time.Duration, error) {
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 || d > time.Minute {
		return 0, errors.New("timeout out of range")
	}
	return d, nil
}
