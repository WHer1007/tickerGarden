package httpapi

import (
	"net/http"
	"tickergarden/backend/internal/displayprice"
	"time"
)

type DisplayPriceReader interface {
	Read(time.Time) []displayprice.Reference
}

func displayPrices(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "method_not_allowed", "method not allowed")
			return
		}
		if r.URL.RawQuery != "" {
			writeError(w, r, 400, "invalid_query", "display references do not accept query parameters")
			return
		}
		refs := []displayprice.Reference{}
		status := "not_configured"
		if opts.DisplayPrices != nil {
			refs = opts.DisplayPrices.Read(time.Now().UTC())
			status = "configured"
		}
		writeJSON(w, 200, map[string]any{"chainId": opts.ChainID, "displayOnly": true, "confidence": "provider_reported", "status": status, "references": refs})
	}
}
