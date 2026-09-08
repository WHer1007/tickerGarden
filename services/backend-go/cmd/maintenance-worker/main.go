package main

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"tickergarden/backend/internal/chainrpc"
	"tickergarden/backend/internal/config"
	"tickergarden/backend/internal/deployment"
	"tickergarden/backend/internal/maintenance"
	"tickergarden/backend/internal/postgres"
)

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run(args []string, out io.Writer) error {
	flags := flag.NewFlagSet("maintenance-worker", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	importSignature := flags.String("import-signature", "", "import recovered signer hex result without renewing or attaching")
	recoverAuth := flags.Bool("recover-authorization", false, "explicit fresh recovery of an expired fixed-intent authorization")
	recoveryID := flags.String("recovery-id", "", "unique authorization recovery identifier")
	signWith := flags.String("sign-with", "", "absolute external signer executable; signs fixed intent without broadcast")
	prepareAtomic := flags.Bool("prepare-atomic", false, "atomically persist preview, lease, nonce and unsigned intent")
	discoverWork := flags.Bool("discover-work", false, "detect and deduplicate one explicit market operation scope")
	verifyPoststate := flags.String("verify-poststate", "", "verify finalized transaction block-end conditions by job")
	rebroadcast := flags.Bool("rebroadcast", false, "explicit recovery: resend the exact stored signed transaction")
	rebroadcastKey := flags.String("rebroadcast-attempt", "", "inspect one recovery attempt by job")
	attemptID := flags.String("attempt-id", "", "idempotency bytes32 for recovery")
	observeReceipt := flags.String("observe-receipt", "", "query and persist fresh receipt evidence for a submitted job")
	receiptHistory := flags.String("receipt-history", "", "read historical receipt evidence")
	submit := flags.Bool("submit", false, "validate fresh deployment state and submit the fixed signed transaction once")
	submissionKey := flags.String("submission", "", "inspect durable submission state")
	expectedHash := flags.String("transaction-hash", "", "expected signed transaction hash required for submit")
	attach := flags.String("attach-signed", "", "hex file from external signer; validate and persist without broadcast")
	signedKey := flags.String("signed", "", "inspect saved signed transaction")
	expectedIntent := flags.String("intent-digest", "", "fixed intent digest required when attaching signed bytes")
	prepare := flags.Bool("prepare-intent", false, "persist one exact unsigned EIP-1559 intent under a current lease")
	intentKey := flags.String("intent", "", "inspect an unsigned intent")
	gasLimit := flags.String("gas-limit", "", "explicit decimal gas limit")
	maxFee := flags.String("max-fee-per-gas", "", "explicit decimal fee cap in wei")
	priorityFee := flags.String("priority-fee-per-gas", "", "explicit decimal priority cap in wei")
	reserve := flags.Bool("reserve-nonce", false, "record preview and reserve nonce under a current lease")
	reservationKey := flags.String("reservation", "", "inspect an existing nonce reservation")
	leaseMode := flags.String("lease", "", "acquire/renew/release a preparation lease")
	leaseJob := flags.String("job", "", "job key for lease operation")
	owner := flags.String("owner", "", "worker identity for lease")
	token := flags.String("token", "", "unique acquisition bytes32 token; retain for retry")
	ttl := flags.Int("ttl", 60, "acquisition duration in seconds, 10..300")
	generation := flags.Int64("generation", 0, "fence required for renew/release")
	record := flags.Bool("record", false, "persist a successful preview; requires --preview")
	history := flags.String("history", "", "inspect up to 100 saved simulations by job key")
	after := flags.Int64("after", 0, "exclusive sequence cursor for --history")
	describe := flags.Bool("describe", false, "describe current capabilities")
	preview := flags.Bool("preview", false, "authenticate and simulate one fixed maintenance request without submission")
	manifestPath := flags.String("manifest", "", "deployment manifest including the target runtime")
	operation := flags.String("operation", "", "sweep/checkpoint/flush-forfeiture/settle-rage-quit/treasury-activate")
	market := flags.String("market", "", "canonical market bytes32")
	trigger := flags.String("trigger", "", "canonical trigger bytes32")
	user := flags.String("user", "", "user only for settle-rage-quit")
	from := flags.String("from", "", "explicit simulation sender")
	if e := flags.Parse(args); e != nil {
		return errors.New("invalid maintenance arguments")
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected maintenance arguments")
	}
	if *describe {
		if flags.NFlag() != 1 {
			return errors.New("describe cannot be combined with execution arguments")
		}
		return json.NewEncoder(out).Encode(map[string]any{"service": "maintenance-worker", "stage": "submission", "simulationImplemented": true, "simulationPersistence": true, "preparationLeases": true, "nonceReservations": true, "unsignedIntents": true, "signedTransactionValidation": true, "submissionImplemented": true, "receiptObservations": true, "rebroadcastRecovery": true, "poststateVerification": true, "workDiscovery": true, "atomicPreparation": true, "externalSigner": true, "authorizationRecovery": true, "signatureImport": true, "transactionSubmission": false, "executionComplete": false, "signerConfigured": false, "operations": []string{"sweep", "checkpoint", "flush-forfeiture", "settle-rage-quit", "treasury-activate"}})
	}

	if *importSignature != "" {
		allowed := *leaseJob != "" && *expectedIntent != "" && *expectedHash != "" && *owner != "" && *token != "" && *generation > 0
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "import-signature", "job", "intent-digest", "transaction-hash", "owner", "token", "generation":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("signature import requires job, intent digest, transaction hash and original lease fence")
		}
		return runSignatureImport(out, *importSignature, *leaseJob, *expectedIntent, *expectedHash, *owner, *token, *generation)
	}
	if *recoverAuth || *recoveryID != "" {
		allowed := *recoverAuth && *recoveryID != "" && *manifestPath != "" && *from != "" && *market != "" && *operation != "" && *trigger != "" && *expectedIntent != "" && *owner != "" && *token != "" && *generation > 0
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "recover-authorization", "recovery-id", "manifest", "from", "market", "operation", "trigger", "user", "intent-digest", "owner", "token", "generation":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("authorization recovery requires fixed request, intent digest, lease fence and recovery ID")
		}
		return runAuthorization(out, *manifestPath, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, TriggerID: *trigger, User: *user}, *expectedIntent, *owner, *token, *generation, *recoveryID)
	}
	if *signWith != "" {
		allowed := *leaseJob != "" && *expectedIntent != "" && *owner != "" && *token != "" && *generation > 0
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "sign-with", "job", "intent-digest", "owner", "token", "generation":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("signer requires job, intent digest and lease fence only")
		}
		return runSigner(out, *signWith, *leaseJob, *expectedIntent, *owner, *token, *generation)
	}
	if *prepareAtomic {
		allowed := *manifestPath != "" && *from != "" && *operation != "" && *market != "" && *trigger != "" && *owner != "" && *token != "" && *gasLimit != "" && *maxFee != "" && *priorityFee != ""
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "prepare-atomic", "manifest", "from", "operation", "market", "trigger", "user", "owner", "token", "ttl", "gas-limit", "max-fee-per-gas", "priority-fee-per-gas":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("atomic preparation requires request, owner/token and explicit fees; incompatible execution flags")
		}
		return runAtomicPreparation(out, *manifestPath, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, TriggerID: *trigger, User: *user}, maintenance.Fees{GasLimit: *gasLimit, MaxFeePerGas: *maxFee, MaxPriorityFeePerGas: *priorityFee}, *owner, *token, *ttl)
	}
	if *discoverWork {
		allowed := *manifestPath != "" && *from != "" && *market != "" && *operation != ""
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "discover-work", "manifest", "from", "market", "operation", "user":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("discovery requires manifest, from, market and operation; no trigger or execution flags")
		}
		return runDiscovery(out, *manifestPath, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, User: *user})
	}

	if *verifyPoststate != "" {
		allowed := *manifestPath != ""
		flags.Visit(func(f *flag.Flag) {
			if f.Name != "verify-poststate" && f.Name != "manifest" {
				allowed = false
			}
		})
		if !allowed {
			return errors.New("poststate verification requires only job and manifest")
		}
		return runPoststate(out, *verifyPoststate, *manifestPath)
	}

	if *rebroadcast || *rebroadcastKey != "" || *attemptID != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			if *rebroadcastKey != "" {
				if f.Name != "rebroadcast-attempt" && f.Name != "attempt-id" {
					allowed = false
				}
				return
			}
			switch f.Name {
			case "rebroadcast", "manifest", "operation", "market", "trigger", "user", "from", "transaction-hash", "attempt-id":
			default:
				allowed = false
			}
		})
		if !allowed || *attemptID == "" || (*rebroadcastKey == "" && (!*rebroadcast || *manifestPath == "" || *expectedHash == "")) {
			return errors.New("invalid rebroadcast mode arguments")
		}
		return runSubmission(out, *rebroadcastKey, *manifestPath, *expectedHash, "", "", 0, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, TriggerID: *trigger, User: *user}, true, *attemptID)
	}

	if *observeReceipt != "" || *receiptHistory != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			if *observeReceipt != "" {
				if f.Name != "observe-receipt" {
					allowed = false
				}
			} else if f.Name != "receipt-history" && f.Name != "after" {
				allowed = false
			}
		})
		if !allowed || *after < 0 {
			return errors.New("invalid receipt mode arguments")
		}
		return runReceipt(out, *observeReceipt, *receiptHistory, *after)
	}

	if *submit || *submissionKey != "" || *expectedHash != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			if *submissionKey != "" {
				if f.Name != "submission" {
					allowed = false
				}
				return
			}
			switch f.Name {
			case "submit", "manifest", "operation", "market", "trigger", "user", "from", "transaction-hash", "owner", "token", "generation":
			default:
				allowed = false
			}
		})
		if !allowed || (*submissionKey == "" && (!*submit || *manifestPath == "" || *expectedHash == "" || *owner == "" || *token == "" || *generation < 1)) {
			return errors.New("invalid submission mode arguments")
		}
		return runSubmission(out, *submissionKey, *manifestPath, *expectedHash, *owner, *token, *generation, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, TriggerID: *trigger, User: *user}, false, "")
	}

	if *attach != "" || *signedKey != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			if *signedKey != "" {
				if f.Name != "signed" {
					allowed = false
				}
				return
			}
			switch f.Name {
			case "attach-signed", "job", "owner", "token", "generation", "intent-digest":
			default:
				allowed = false
			}
		})
		if !allowed {
			return errors.New("invalid signed transaction mode arguments")
		}
		cfg, e := config.Load()
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		store := maintenance.Store{Pool: pool, ChainID: cfg.ChainID}
		var result maintenance.SignedTransaction
		if *signedKey != "" {
			result, e = store.Signed(ctx, *signedKey)
		} else {
			file, err := os.Open(*attach)
			if err != nil {
				return errors.New("cannot open signed transaction file")
			}
			defer file.Close()
			data, err := io.ReadAll(io.LimitReader(file, 32773))
			if err != nil || len(data) > 32772 {
				return errors.New("signed transaction file exceeds limit")
			}
			value := strings.TrimSpace(string(data))
			if !strings.HasPrefix(value, "0x") {
				return errors.New("signed transaction file must contain 0x-prefixed hex")
			}
			raw, err := hex.DecodeString(value[2:])
			if err != nil {
				return errors.New("invalid signed transaction hex")
			}
			result, e = store.AttachSigned(ctx, *leaseJob, *expectedIntent, *owner, *token, *generation, raw)
		}
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"signed": result, "transactionSubmission": false, "executionComplete": false})
	}
	if *expectedIntent != "" {
		return errors.New("intent-digest requires attach-signed")
	}
	if *intentKey != "" {
		if flags.NFlag() != 1 {
			return errors.New("intent inspection accepts only --intent")
		}
		cfg, e := config.Load()
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		result, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).Intent(ctx, *intentKey)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"record": result, "transactionSubmission": false, "executionComplete": false})
	}
	if *reservationKey != "" {
		if flags.NFlag() != 1 {
			return errors.New("reservation inspection accepts only --reservation")
		}
		cfg, e := config.Load()
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		result, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).Reservation(ctx, *reservationKey)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"reservation": result, "transactionSubmission": false, "executionComplete": false})
	}
	if *leaseMode != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			switch f.Name {
			case "lease", "job", "owner", "token":
			case "ttl":
				if *leaseMode != "acquire" {
					allowed = false
				}
			case "generation":
				if *leaseMode == "acquire" {
					allowed = false
				}
			default:
				allowed = false
			}
		})
		if !allowed || (*leaseMode != "acquire" && *leaseMode != "renew" && *leaseMode != "release") {
			return errors.New("invalid lease mode or arguments")
		}
		cfg, e := config.Load()
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		store := maintenance.Store{Pool: pool, ChainID: cfg.ChainID}
		var result maintenance.Lease
		if *leaseMode == "acquire" {
			result, e = store.AcquireLease(ctx, *leaseJob, *owner, *token, *ttl)
		} else {
			result, e = store.ChangeLease(ctx, *leaseJob, *owner, *token, *generation, *leaseMode == "release")
		}
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"lease": result, "transactionSubmission": false, "executionComplete": false})
	}
	leaseArgs := false
	flags.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "job", "owner", "token", "ttl", "generation":
			leaseArgs = true
		}
	})
	if leaseArgs && !*reserve && !*prepare {
		return errors.New("lease arguments require --lease")
	}
	if *history != "" {
		allowed := true
		flags.Visit(func(f *flag.Flag) {
			if f.Name != "history" && f.Name != "after" {
				allowed = false
			}
		})
		if !allowed || *after < 0 {
			return errors.New("history only accepts --after")
		}
		cfg, e := config.Load()
		if e != nil {
			return e
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		records, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).History(ctx, *history, *after)
		if e != nil {
			return e
		}
		return json.NewEncoder(out).Encode(map[string]any{"records": records, "transactionSubmission": false, "executionComplete": false})
	}

	feeArgs := false
	flags.Visit(func(f *flag.Flag) {
		switch f.Name {
		case "gas-limit", "max-fee-per-gas", "priority-fee-per-gas":
			feeArgs = true
		}
	})
	if feeArgs && !*prepare {
		return errors.New("fee arguments require prepare-intent")
	}
	if *prepare {
		invalid := !*preview || *reserve || *owner == "" || *token == "" || *generation < 1 || *gasLimit == "" || *maxFee == "" || *priorityFee == ""
		flags.Visit(func(f *flag.Flag) {
			if f.Name == "job" || f.Name == "ttl" {
				invalid = true
			}
		})
		if invalid {
			return errors.New("prepare-intent requires preview, fees and current lease; cannot reserve nonce simultaneously")
		}
	}
	if *reserve {
		invalid := !*preview || *owner == "" || *token == "" || *generation < 1
		flags.Visit(func(f *flag.Flag) {
			if f.Name == "job" || f.Name == "ttl" {
				invalid = true
			}
		})
		if invalid {
			return errors.New("reserve-nonce requires preview, owner, token and generation; no job/ttl")
		}
	}
	if *after != 0 {
		return errors.New("after requires history")
	}
	if !*preview || *manifestPath == "" {
		return errors.New("use --preview --manifest FILE --operation OP --market ID --trigger ID --from ADDRESS [--user ADDRESS]; use --submit for explicit signed transaction submission")
	}
	cfg, e := config.Load()
	if e != nil {
		return e
	}
	file, e := os.Open(*manifestPath)
	if e != nil {
		return errors.New("cannot open maintenance manifest")
	}
	defer file.Close()
	raw, e := io.ReadAll(io.LimitReader(file, (1<<20)+1))
	if e != nil {
		return errors.New("cannot read maintenance manifest")
	}
	manifest, e := deployment.Parse(raw)
	if e != nil {
		return e
	}
	if manifest.ChainID != cfg.ChainID {
		return errors.New("maintenance manifest and configured chain differ")
	}
	rpc, e := chainrpc.New(os.Getenv("TG_RPC_URL"))
	if e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	block, e := rpc.Header(ctx, "latest")
	if e != nil {
		return e
	}
	result, e := deployment.PreviewMaintenance(ctx, rpc, manifest, block, *from, deployment.MaintenanceRequest{Operation: *operation, MarketID: *market, TriggerID: *trigger, User: *user})
	if e != nil {
		return e
	}
	if *record || *reserve || *prepare {
		dsn := os.Getenv("TG_MAINTENANCE_DATABASE_URL")
		if dsn == "" {
			return errors.New("TG_MAINTENANCE_DATABASE_URL is required")
		}
		pool, e := postgres.Open(ctx, dsn, 2)
		if e != nil {
			return e
		}
		defer pool.Close()
		saved, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).Record(ctx, result)
		if e != nil {
			return e
		}

		if *prepare {
			intent, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).PrepareIntent(ctx, rpc, result, maintenance.Fees{GasLimit: *gasLimit, MaxFeePerGas: *maxFee, MaxPriorityFeePerGas: *priorityFee}, *owner, *token, *generation)
			if e != nil {
				return e
			}
			return json.NewEncoder(out).Encode(map[string]any{"record": intent, "transactionSubmission": false, "executionComplete": false})
		}
		if *reserve {
			reserved, e := (maintenance.Store{Pool: pool, ChainID: cfg.ChainID}).ReserveNonce(ctx, rpc, result, *owner, *token, *generation)
			if e != nil {
				return e
			}
			return json.NewEncoder(out).Encode(map[string]any{"reservation": reserved, "transactionSubmission": false, "executionComplete": false})
		}
		return json.NewEncoder(out).Encode(saved)
	}
	return json.NewEncoder(out).Encode(result)
}
