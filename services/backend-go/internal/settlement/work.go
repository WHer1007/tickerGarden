package settlement

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"tickergarden/backend/internal/deployment"
	"time"
)

var ErrWork = errors.New("settlement work unavailable or inconsistent")

type WorkSpec struct {
	RunID           string              `json:"runId"`
	DeadlineSeconds int64               `json:"deadlineSeconds"`
	Selection       ObservedInput       `json:"selection"`
	Manifest        deployment.Manifest `json:"manifest"`
	Policy          ReferencePolicy     `json:"policy"`
}
type WorkScope struct {
	ChainID     uint64 `json:"chainId"`
	GenesisHash string `json:"genesisHash"`
	Operator    string `json:"operator"`
}
type WorkResult struct {
	JobKey        string `json:"jobKey,omitempty"`
	Status        string `json:"status"`
	CheckSequence *int64 `json:"checkSequence,omitempty"`
}
type workClaim struct {
	key        string
	generation int64
	attempts   int
	spec       WorkSpec
}

func workPayload(spec WorkSpec) ([]byte, string, error) {
	in := spec.Selection
	p := spec.Policy
	raw, err := json.Marshal(spec.Manifest)
	if err != nil {
		return nil, "", ErrWork
	}
	if _, err = deployment.Parse(raw); err != nil {
		return nil, "", ErrWork
	}
	if !referenceSourceIDPattern.MatchString(spec.RunID) || spec.DeadlineSeconds < 30 || spec.DeadlineSeconds > 120 || in.Deadline != 0 || in.Quote != nil || len(in.References) != 0 || in.PoolManager == nil || !validAddress(in.Operator) || !validAddress(in.PoolManager.Address) || !hashPattern.MatchString(in.PoolManager.RuntimeCodeHash) || in.SlippageBps < 0 || in.SlippageBps > 100 || p.ChainID != spec.Manifest.ChainID || p.GenesisHash != spec.Manifest.GenesisHash || p.MarketID != in.MarketID || !validAddress(p.MemeToken) || !addressPattern.MatchString(p.QuoteAsset) || p.MemeToken == p.QuoteAsset {
		return nil, "", ErrWork
	}
	if _, err = configuredReferenceKeys(p); err != nil {
		return nil, "", ErrWork
	}
	endpoints := map[string]bool{}
	for _, source := range p.Sources {
		if source.Endpoint == "" || endpoints[source.Endpoint] {
			return nil, "", ErrWork
		}
		endpoints[source.Endpoint] = true
	}
	if len(in.Participants) == 0 || len(in.Participants) > 32 {
		return nil, "", ErrWork
	}
	seen := map[deployment.ConversionParticipant]bool{}
	positive := false
	for _, item := range in.Participants {
		n, e := amount(item.MaximumMeme)
		key := deployment.ConversionParticipant{User: item.User, CreatorEpoch: item.CreatorEpoch}
		if e != nil || !validAddress(item.User) || seen[key] {
			return nil, "", ErrWork
		}
		seen[key] = true
		positive = positive || n.Sign() > 0
	}
	cap, e := amount(in.PerBatchCap)
	if e != nil || cap.Sign() == 0 {
		return nil, "", ErrWork
	}
	cap, e = amount(in.TotalMeme)
	if e != nil || cap.Sign() == 0 || !positive {
		return nil, "", ErrWork
	}
	raw, err = json.Marshal(spec)
	if err != nil || len(raw) > 1<<20 {
		return nil, "", ErrWork
	}
	sum := sha256.Sum256(raw)
	return raw, hex.EncodeToString(sum[:]), nil
}

func (s Store) Enqueue(ctx context.Context, spec WorkSpec) (WorkResult, error) {
	raw, key, err := workPayload(spec)
	if err != nil || s.Pool == nil || s.ChainID != spec.Manifest.ChainID {
		return WorkResult{}, ErrWork
	}
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return WorkResult{}, ErrWork
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `INSERT INTO tickergarden.settlement_work(job_key,chain_id,genesis_hash,operator,market_id,run_id,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, key, s.ChainID, spec.Manifest.GenesisHash, spec.Selection.Operator, spec.Selection.MarketID, spec.RunID, raw)
	if err != nil {
		return WorkResult{}, ErrWork
	}
	var r WorkResult
	var saved []byte
	err = tx.QueryRow(ctx, `SELECT job_key,status,check_sequence,payload FROM tickergarden.settlement_work WHERE chain_id=$1 AND genesis_hash=$2 AND operator=$3 AND market_id=$4 AND run_id=$5`, s.ChainID, spec.Manifest.GenesisHash, spec.Selection.Operator, spec.Selection.MarketID, spec.RunID).Scan(&r.JobKey, &r.Status, &r.CheckSequence, &saved)
	if err != nil || r.JobKey != key || !bytes.Equal(raw, saved) {
		return WorkResult{}, ErrWork
	}
	if tx.Commit(ctx) != nil {
		return WorkResult{}, ErrWork
	}
	return r, nil
}

type Worker struct {
	Store Store
	RPC   ConversionPreviewObserver
	Scope WorkScope
}

func (w Worker) valid() bool {
	return w.Store.Pool != nil && w.Store.ChainID == w.Scope.ChainID && (w.Scope.ChainID == 4663 || w.Scope.ChainID == 46630 || w.Scope.ChainID == 421614) && hashPattern.MatchString(w.Scope.GenesisHash) && validAddress(w.Scope.Operator)
}

func (w Worker) claim(ctx context.Context) (workClaim, error) {
	if !w.valid() {
		return workClaim{}, ErrWork
	}
	tx, err := w.Store.Pool.Begin(ctx)
	if err != nil {
		return workClaim{}, ErrWork
	}
	defer tx.Rollback(ctx)
	// Crashed fifth attempts become terminal instead of remaining stuck forever.
	_, err = tx.Exec(ctx, `UPDATE tickergarden.settlement_work SET status='failed',updated_at=clock_timestamp() WHERE sequence IN (SELECT sequence FROM tickergarden.settlement_work WHERE chain_id=$1 AND genesis_hash=$2 AND operator=$3 AND status='checking' AND attempts=5 AND claim_until<=clock_timestamp() ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 100)`, w.Scope.ChainID, w.Scope.GenesisHash, w.Scope.Operator)
	if err != nil {
		return workClaim{}, ErrWork
	}
	var c workClaim
	var raw []byte
	var market, runID string
	err = tx.QueryRow(ctx, `SELECT job_key,generation,attempts,payload,market_id,run_id FROM tickergarden.settlement_work WHERE chain_id=$1 AND genesis_hash=$2 AND operator=$3 AND status IN ('queued','retry','checking') AND attempts<5 AND due_at<=clock_timestamp() AND claim_until<=clock_timestamp() ORDER BY due_at,sequence FOR UPDATE SKIP LOCKED LIMIT 1`, w.Scope.ChainID, w.Scope.GenesisHash, w.Scope.Operator).Scan(&c.key, &c.generation, &c.attempts, &raw, &market, &runID)
	if errors.Is(err, pgx.ErrNoRows) {
		if tx.Commit(ctx) != nil {
			return workClaim{}, ErrWork
		}
		return c, nil
	}
	if err != nil || c.generation == 1<<63-1 || json.Unmarshal(raw, &c.spec) != nil {
		return workClaim{}, ErrWork
	}
	canonical, key, err := workPayload(c.spec)
	if err != nil || key != c.key || !bytes.Equal(canonical, raw) || c.spec.Manifest.ChainID != w.Scope.ChainID || c.spec.Manifest.GenesisHash != w.Scope.GenesisHash || c.spec.Selection.Operator != w.Scope.Operator || c.spec.Selection.MarketID != market || c.spec.RunID != runID {
		return workClaim{}, ErrWork
	}
	c.generation++
	c.attempts++
	_, err = tx.Exec(ctx, `UPDATE tickergarden.settlement_work SET status='checking',generation=$2,attempts=$3,claim_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE job_key=$1`, c.key, c.generation, c.attempts)
	if err != nil || tx.Commit(ctx) != nil {
		return workClaim{}, ErrWork
	}
	return c, nil
}

func (w Worker) finish(ctx context.Context, c workClaim, v VerifiedConversion, checkErr error) (WorkResult, error) {
	tx, err := w.Store.Pool.Begin(ctx)
	if err != nil {
		return WorkResult{}, ErrWork
	}
	defer tx.Rollback(ctx)
	var current bool
	err = tx.QueryRow(ctx, `SELECT true FROM tickergarden.settlement_work WHERE job_key=$1 AND generation=$2 AND status='checking' AND claim_until>clock_timestamp() FOR UPDATE`, c.key, c.generation).Scan(&current)
	if err != nil || !current {
		return WorkResult{}, ErrWork
	}
	r := WorkResult{JobKey: c.key, Status: "retry"}
	if checkErr == nil {
		if v.chainID != w.Scope.ChainID || v.genesis != w.Scope.GenesisHash || v.market != c.spec.Selection.MarketID {
			return WorkResult{}, ErrWork
		}
		record, e := w.Store.recordIn(ctx, tx, v)
		if e != nil {
			return WorkResult{}, e
		}
		r.Status = "checked_unsigned"
		r.CheckSequence = &record.Sequence
	} else if c.attempts >= 5 {
		r.Status = "failed"
	}
	delay := int64(5) * (1 << uint(c.attempts-1))
	tag, err := tx.Exec(ctx, `UPDATE tickergarden.settlement_work SET status=$3,check_sequence=$4,claim_until='-infinity',due_at=clock_timestamp()+$5*interval '1 second',updated_at=clock_timestamp() WHERE job_key=$1 AND generation=$2 AND claim_until>clock_timestamp()`, c.key, c.generation, r.Status, r.CheckSequence, delay)
	if err != nil || tag.RowsAffected() != 1 || tx.Commit(ctx) != nil {
		return WorkResult{}, ErrWork
	}
	return r, nil
}

func (w Worker) Tick(ctx context.Context) (WorkResult, error) {
	if w.RPC == nil {
		return WorkResult{}, ErrWork
	}
	c, err := w.claim(ctx)
	if err != nil {
		return WorkResult{}, err
	}
	if c.key == "" {
		return WorkResult{Status: "idle"}, nil
	}
	in := c.spec.Selection
	in.Deadline = time.Now().Unix() + c.spec.DeadlineSeconds
	checked, err := VerifyAutoConversion(ctx, w.RPC, c.spec.Manifest, in, c.spec.Policy)
	if ctx.Err() != nil {
		return WorkResult{}, ctx.Err()
	}
	return w.finish(ctx, c, checked, err)
}
