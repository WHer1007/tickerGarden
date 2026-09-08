package httpapi

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/treasury"
)

type TreasuryProofReader interface {
	ClaimProof(context.Context, string, uint32, string) (treasury.ClaimProof, error)
}

var treasuryPath = regexp.MustCompile(`^/v1/treasury/markets/(0x[0-9a-fA-F]{64})/epochs/([1-9][0-9]{0,9})/claims/(0x[0-9a-fA-F]{40})$`)

func treasuryProofs(opts Options) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET, OPTIONS")
			writeError(w, r, 405, "read_only", "this API does not accept write methods")
			return
		}
		path := treasuryPath.FindStringSubmatch(r.URL.Path)
		if path == nil || r.URL.RawQuery != "" {
			writeError(w, r, 400, "invalid_request", "invalid Treasury proof path or query")
			return
		}
		epoch, err := strconv.ParseUint(path[2], 10, 32)
		if err != nil || strings.EqualFold(path[1], "0x"+strings.Repeat("0", 64)) || strings.EqualFold(path[3], "0x"+strings.Repeat("0", 40)) {
			writeError(w, r, 400, "invalid_request", "invalid Treasury proof identity")
			return
		}
		if opts.TreasuryProofs == nil {
			writeError(w, r, 503, "proof_unavailable", "Treasury proof service is not configured")
			return
		}
		proof, err := opts.TreasuryProofs.ClaimProof(r.Context(), strings.ToLower(path[1]), uint32(epoch), strings.ToLower(path[3]))
		if err == nil && proof.ChainID == opts.ChainID {
			writeJSON(w, 200, proof)
			return
		}
		status, code, message := 503, "proof_unavailable", "Treasury proof could not be verified"
		switch {
		case errors.Is(err, treasury.ErrProofInput):
			status, code, message = 400, "invalid_request", "invalid Treasury proof identity"
		case errors.Is(err, treasury.ErrProofNotFound):
			status, code, message = 404, "proof_not_found", "no matching claim proof is available"
		case errors.Is(err, deployment.ErrTreasuryNotClaiming):
			status, code, message = 409, "epoch_not_claiming", "Treasury epoch is not open for claims"
		case errors.Is(err, treasury.ErrProofClaimed):
			status, code, message = 409, "already_claimed", "Treasury claim has already been consumed"
		case errors.Is(err, deployment.ErrTreasuryExpired):
			status, code, message = 410, "claim_expired", "Treasury claim window has expired"
		}
		writeError(w, r, status, code, message)
	}
}
