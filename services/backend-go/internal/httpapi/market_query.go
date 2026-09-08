package httpapi

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"tickergarden/backend/internal/readmodel"
)

var ErrMarketIdentityUnavailable = errors.New("market identity catalog incomplete")
var tokenPattern = regexp.MustCompile(`^0x[0-9a-f]{40}$`)

func queryMarkets(items []readmodel.MarketReadModel, q url.Values) ([]readmodel.MarketReadModel, string, func(readmodel.MarketReadModel) string, error) {
	identity := func(m readmodel.MarketReadModel) string { return m.MarketID }
	fail := func(message string) ([]readmodel.MarketReadModel, string, func(readmodel.MarketReadModel) string, error) {
		return nil, "", identity, errors.New(message)
	}
	for key, values := range q {
		switch key {
		case "assetUid", "marketId", "memeToken", "launchPhase", "sort", "search", "createdFrom", "createdTo", "limit", "cursor", "revision":
		default:
			return fail("unsupported market query parameter")
		}
		if len(values) != 1 {
			return fail("duplicate query parameter")
		}
	}
	asset := "all"
	if q.Has("assetUid") {
		asset = strings.ToLower(q.Get("assetUid"))
		if !assetPattern.MatchString(asset) {
			return fail("assetUid must be canonical bytes32")
		}
	}
	market := strings.ToLower(q.Get("marketId"))
	if q.Has("marketId") && !assetPattern.MatchString(market) {
		return fail("marketId must be canonical bytes32")
	}
	token := strings.ToLower(q.Get("memeToken"))
	if q.Has("memeToken") && !tokenPattern.MatchString(token) {
		return fail("memeToken must be canonical address")
	}
	phase := q.Get("launchPhase")
	if q.Has("launchPhase") && phase != "0" && phase != "1" {
		return fail("launchPhase must be 0 or 1")
	}
	order := "marketId_asc"
	if q.Has("sort") {
		order = q.Get("sort")
		if order != "marketId_asc" && order != "marketId_desc" && order != "createdAt_asc" && order != "createdAt_desc" && order != "name_asc" && order != "launchPhase_asc" && order != "volume24hUsd_desc" && order != "marketCapUsd_desc" {
			return fail("unsupported market sort")
		}
	}
	search := asciiLower(q.Get("search"))
	if q.Has("search") && (search == "" || len(search) > 128 || !utf8.ValidString(search)) {
		return fail("search must contain 1..128 UTF-8 bytes")
	}
	searchAddress := tokenPattern.MatchString(search)
	if strings.HasPrefix(search, "0x") && !searchAddress {
		return fail("search must be a market name or canonical Meme Token address")
	}
	from, to := q.Get("createdFrom"), q.Get("createdTo")
	for _, key := range []string{"createdFrom", "createdTo"} {
		if q.Has(key) {
			value := q.Get(key)
			n, e := strconv.ParseUint(value, 10, 63)
			if e != nil || fmt.Sprint(n) != value {
				return fail("invalid creation time bound")
			}
		}
	}
	if from != "" && to != "" {
		a, _ := strconv.ParseUint(from, 10, 63)
		b, _ := strconv.ParseUint(to, 10, 63)
		if a > b {
			return fail("creation time bounds reversed")
		}
	}
	if (search != "" && !searchAddress) || from != "" || to != "" || (strings.HasPrefix(order, "createdAt_") || order == "name_asc") {
		for _, m := range items {
			if m.Identity == nil {
				return nil, "", identity, ErrMarketIdentityUnavailable
			}
		}
	}
	filter := asset
	if market != "" || token != "" || phase != "" || order != "marketId_asc" {
		raw, _ := json.Marshal([]string{asset, market, token, phase, order})
		filter = string(raw)
	}
	if search != "" || from != "" || to != "" {
		raw, _ := json.Marshal([]string{asset, market, token, phase, order, base64.RawURLEncoding.EncodeToString([]byte(search)), from, to})
		filter = string(raw)
	}
	out := items
	if asset != "all" || market != "" || token != "" || phase != "" || search != "" || from != "" || to != "" {
		out = []readmodel.MarketReadModel{}
		for _, m := range items {
			if asset != "all" && m.AssetUID != asset || market != "" && m.MarketID != market || token != "" && m.MemeToken != token || phase == "0" && m.LaunchPhase != 0 || phase == "1" && m.LaunchPhase != 1 {
				continue
			}
			if search != "" {
				if searchAddress {
					if m.MemeToken != search {
						continue
					}
				} else if m.Identity == nil || !strings.Contains(asciiLower(m.Identity.Name), search) {
					continue
				}
			}
			if from != "" || to != "" {
				at, _ := strconv.ParseUint(m.Identity.DeployedAt, 10, 63)
				if from != "" {
					v, _ := strconv.ParseUint(from, 10, 63)
					if at < v {
						continue
					}
				}
				if to != "" {
					v, _ := strconv.ParseUint(to, 10, 63)
					if at > v {
						continue
					}
				}
			}
			out = append(out, m)
		}
	}
	if order == "marketId_desc" {
		identity = func(m readmodel.MarketReadModel) string { return reverseMarketID(m.MarketID) }
	}
	if strings.HasPrefix(order, "createdAt_") {
		identity = func(m readmodel.MarketReadModel) string {
			time := fmt.Sprintf("%019s", m.Identity.DeployedAt)
			if order == "createdAt_desc" {
				raw := []byte(time)
				for i, c := range raw {
					raw[i] = '9' - (c - '0')
				}
				time = string(raw)
			}
			return time + ":" + m.MarketID
		}
	}
	if order == "name_asc" {
		identity = func(m readmodel.MarketReadModel) string {
			// Hex preserves UTF-8 byte order and keeps cursor delimiters unambiguous.
			// '/' sorts before every hex digit, so a name prefix precedes its extension.
			return hex.EncodeToString([]byte(asciiLower(m.Identity.Name))) + "/" + m.MarketID
		}
	}
	if order == "launchPhase_asc" {
		identity = func(m readmodel.MarketReadModel) string { return fmt.Sprintf("%020d:%s", m.LaunchPhase, m.MarketID) }
	}
	if order == "volume24hUsd_desc" {
		identity = func(m readmodel.MarketReadModel) string {
			if m.Metrics == nil || m.Metrics.Volume24hUSD == nil {
				return "1:" + m.MarketID
			}
			return "0:" + descendingUSDKey(*m.Metrics.Volume24hUSD) + ":" + m.MarketID
		}
	}
	if order == "marketCapUsd_desc" {
		identity = func(m readmodel.MarketReadModel) string {
			if m.Metrics == nil || m.Metrics.MarketCapUSD == nil {
				return "1:" + m.MarketID
			}
			return "0:" + descendingUSDKey(*m.Metrics.MarketCapUSD) + ":" + m.MarketID
		}
	}
	return out, filter, identity, nil
}

func descendingUSDKey(value string) string {
	parts := strings.Split(value, ".")
	if len(parts) > 2 || len(parts[0]) == 0 || len(parts[0]) > 180 {
		return strings.Repeat("9", 198)
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > 18 {
		return strings.Repeat("9", 198)
	}
	raw := strings.Repeat("0", 180-len(parts[0])) + parts[0] + fraction + strings.Repeat("0", 18-len(fraction))
	out := []byte(raw)
	for i, digit := range out {
		if digit < '0' || digit > '9' {
			return strings.Repeat("9", 198)
		}
		out[i] = '9' - (digit - '0')
	}
	return string(out)
}
func reverseMarketID(id string) string {
	const digits = "0123456789abcdef"
	b := []byte(id)
	for i := 2; i < len(b); i++ {
		n := strings.IndexByte(digits, b[i])
		if n >= 0 {
			b[i] = digits[15-n]
		}
	}
	return string(b)
}

func asciiLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}
