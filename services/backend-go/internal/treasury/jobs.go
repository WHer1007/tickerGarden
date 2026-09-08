package treasury

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"reflect"
	"sort"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"tickergarden/backend/internal/deployment"
)

var ErrNoJob = errors.New("no Treasury job available")
var ErrLeaseLost = errors.New("Treasury job lease lost")

// JobSpec freezes operator-reviewed request inputs and deployment identity. It
// contains no Transfer data, signing material or authority to publish a root.
type JobSpec struct {
	Input    Input               `json:"input"`
	Manifest deployment.Manifest `json:"manifest"`
}
type Job struct {
	RecoveryCount int     `json:"recoveryCount"`
	ID            string  `json:"id"`
	State         string  `json:"state"`
	Attempts      int     `json:"attempts"`
	CandidateID   *string `json:"candidateId"`
	ErrorCode     string  `json:"errorCode"`
	Spec          JobSpec `json:"-"`
	Token         string  `json:"-"`
}
type JobQueue struct{ Pool *pgxpool.Pool }

func canonicalJob(spec JobSpec) (JobSpec, []byte, string, error) {
	fail := func(e error) (JobSpec, []byte, string, error) { return JobSpec{}, nil, "", e }
	in := spec.Input
	in.Context = normalizedContext(in.Context)
	if in.Transfers == nil || len(in.Transfers) != 0 || in.ExcludedAccounts == nil {
		return fail(errors.New("queued job requires empty Transfers and explicit exclusions"))
	}
	if err := validateContext(in.Context); err != nil {
		return fail(err)
	}
	if in.EmptyEpochPolicy != "" && in.EmptyEpochPolicy != "reviewed-rollover" {
		return fail(errors.New("invalid empty epoch policy"))
	}
	source, e := integer(in.SourceBlockTimestamp, 64)
	if e != nil {
		return fail(e)
	}
	end, _ := integer(in.WindowEnd, 64)
	if source.Cmp(end) < 0 {
		return fail(errors.New("source precedes epoch end"))
	}
	amount, e := integer(in.QuoteAmount, 256)
	if e != nil || amount.Sign() == 0 {
		return fail(errors.New("queued request must be funded"))
	}
	excluded, e := normalizeAddresses(in.ExcludedAccounts)
	if e != nil {
		return fail(e)
	}
	in.ExcludedAccounts = excluded
	policy, e := PolicyHash(in.ChainID, in.MarketID, excluded)
	if e != nil || policy != in.EligibilityPolicyHash {
		return fail(errors.New("queued policy mismatch"))
	}
	m, manifestHash, e := jobManifest(spec.Manifest)
	if e != nil {
		return fail(e)
	}
	if strconv.FormatUint(m.ChainID, 10) != in.ChainID {
		return fail(errors.New("queued chain mismatch"))
	}
	for _, c := range m.Contracts {
		if c.Module == "TreasuryDistributorV1" && c.Address != in.Distributor {
			return fail(errors.New("queued distributor mismatch"))
		}
	}
	spec = JobSpec{Input: in, Manifest: m}
	payload, e := json.Marshal(spec)
	if e != nil || len(payload) > 17<<20 {
		return fail(errors.New("queued payload exceeds budget"))
	}
	return spec, payload, manifestHash, nil
}
func (q JobQueue) Enqueue(ctx context.Context, spec JobSpec) (string, error) {
	return enqueueJob(ctx, q.Pool, spec)
}

type jobInserter interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func enqueueJob(ctx context.Context, db jobInserter, spec JobSpec) (string, error) {
	spec, payload, mh, e := canonicalJob(spec)
	if e != nil {
		return "", e
	}
	id := hash(payload)
	// The no-op update locks an existing ID without resetting attempts or state.
	var stored []byte
	var chain uint64
	var manifest string
	e = db.QueryRow(ctx, `INSERT INTO tickergarden.treasury_jobs(id,chain_id,manifest_hash,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET id=EXCLUDED.id RETURNING payload,chain_id,manifest_hash`, id, spec.Manifest.ChainID, mh, payload).Scan(&stored, &chain, &manifest)
	if e != nil {
		return "", errors.New("cannot enqueue Treasury job")
	}
	if string(stored) != string(payload) || chain != spec.Manifest.ChainID || manifest != mh {
		return "", errors.New("Treasury job digest or index corruption")
	}
	return id, nil
}
func (q JobQueue) Status(ctx context.Context, id string) (Job, error) {
	var job Job
	if !hashRE.MatchString(id) {
		return job, errors.New("invalid Treasury job id")
	}
	err := q.Pool.QueryRow(ctx, `SELECT id,state,attempts,candidate_id,error_code,recovery_count FROM tickergarden.treasury_jobs WHERE id=$1`, id).Scan(&job.ID, &job.State, &job.Attempts, &job.CandidateID, &job.ErrorCode, &job.RecoveryCount)
	if err != nil {
		return Job{}, errors.New("Treasury job unavailable")
	}
	return job, nil
}

// Claim uses database time and SKIP LOCKED. Every acquisition has a fresh token;
// an expired worker can neither complete nor reschedule the new owner's work.
func (q JobQueue) Claim(ctx context.Context, scope deployment.Manifest) (Job, error) {
	scope, mh, e := jobManifest(scope)
	if e != nil {
		return Job{}, e
	}
	tokenBytes := make([]byte, 16)
	if _, e = rand.Read(tokenBytes); e != nil {
		return Job{}, e
	}
	token := hex.EncodeToString(tokenBytes)
	tx, e := q.Pool.Begin(ctx)
	if e != nil {
		return Job{}, errors.New("cannot open Treasury queue")
	}
	defer tx.Rollback(ctx)
	_, e = tx.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state='dead',lease_token=NULL,lease_until=NULL,error_code='lease_exhausted',updated_at=now() WHERE chain_id=$1 AND manifest_hash=$2 AND state='running' AND lease_until<=now() AND attempts=5`, scope.ChainID, mh)
	if e != nil {
		return Job{}, errors.New("cannot recover Treasury leases")
	}
	var j Job
	var payload []byte
	e = tx.QueryRow(ctx, `WITH picked AS (SELECT id FROM tickergarden.treasury_jobs WHERE chain_id=$1 AND manifest_hash=$2 AND attempts<5 AND ((state='ready' AND available_at<=now()) OR (state='running' AND lease_until<=now())) ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE tickergarden.treasury_jobs j SET state='running',attempts=j.attempts+1,lease_token=$3,lease_until=now()+interval '120 seconds',updated_at=now() FROM picked WHERE j.id=picked.id RETURNING j.id,j.state,j.attempts,j.payload,j.recovery_count`, scope.ChainID, mh, token).Scan(&j.ID, &j.State, &j.Attempts, &payload, &j.RecoveryCount)
	if errors.Is(e, pgx.ErrNoRows) {
		if e = tx.Commit(ctx); e != nil {
			return Job{}, e
		}
		return Job{}, ErrNoJob
	}
	if e != nil {
		return Job{}, errors.New("cannot claim Treasury job")
	}
	j.Token = token
	var spec JobSpec
	valid := hash(payload) == j.ID && json.Unmarshal(payload, &spec) == nil
	if valid {
		canonical, b, gotHash, err := canonicalJob(spec)
		valid = err == nil && string(b) == string(payload) && gotHash == mh && canonical.Manifest.ChainID == scope.ChainID
		j.Spec = canonical
	}
	if !valid {
		_, e = tx.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state='dead',lease_token=NULL,lease_until=NULL,error_code='invalid_payload',updated_at=now() WHERE id=$1`, j.ID)
		if e != nil {
			return Job{}, e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return Job{}, errors.New("cannot commit Treasury lease")
	}
	if !valid {
		return Job{}, errors.New("Treasury job payload invalid; moved to dead state")
	}
	return j, nil
}
func (q JobQueue) Fail(ctx context.Context, j Job) error {
	delay := time.Duration(1<<min(max(j.Attempts, 1), 5)) * 15 * time.Second
	tag, e := q.Pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state=CASE WHEN attempts>=5 THEN 'dead' ELSE 'ready' END,available_at=now()+$3::bigint*interval '1 second',lease_token=NULL,lease_until=NULL,error_code='processing_failed',updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now()`, j.ID, j.Token, int64(delay/time.Second))
	if e != nil {
		return errors.New("cannot reschedule Treasury job")
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}
func (q JobQueue) Complete(ctx context.Context, j Job, candidateID string) error {
	_, payload, _, err := canonicalJob(j.Spec)
	if err != nil || hash(payload) != j.ID {
		return errors.New("leased job identity mismatch")
	}
	c, e := ReadCandidate(ctx, q.Pool, candidateID)
	if e != nil {
		return e
	}
	input := c.Input
	input.Transfers = []Transfer{}
	canonical, _, _, e := canonicalJob(JobSpec{Input: input, Manifest: j.Spec.Manifest})
	if e != nil || !reflect.DeepEqual(canonical.Input, j.Spec.Input) {
		return errors.New("candidate does not belong to leased request")
	}
	tag, e := q.Pool.Exec(ctx, `UPDATE tickergarden.treasury_jobs SET state='succeeded',candidate_id=$3,lease_token=NULL,lease_until=NULL,error_code='',updated_at=now() WHERE id=$1 AND state='running' AND lease_token=$2 AND lease_until>now()`, j.ID, j.Token, candidateID)
	if e != nil {
		return errors.New("cannot complete Treasury job")
	}
	if tag.RowsAffected() != 1 {
		return ErrLeaseLost
	}
	return nil
}

func jobManifest(m deployment.Manifest) (deployment.Manifest, string, error) {
	fail := func(err error) (deployment.Manifest, string, error) { return deployment.Manifest{}, "", err }
	raw, err := json.Marshal(m)
	if err != nil {
		return fail(err)
	}
	m, err = deployment.Parse(raw)
	if err != nil {
		return fail(err)
	}
	required := map[string]bool{"TickerGardenFactoryV1": false, "OfficialStockRegistryV1": false, "ApprovedQuoteRegistry": false, "TickerGardenBaselineRegistry": false, "LaunchTemplateRegistry": false, "MarketRegistryV1": false, "ProtocolFeeVault": false, "AllocationManager": false, "LaunchAndBuyRouter": false, "TreasuryDistributorV1": false}
	seen := map[string]bool{}
	for _, c := range m.Contracts {
		if seen[c.Module] {
			return fail(errors.New("ambiguous manifest module"))
		}
		seen[c.Module] = true
		if _, ok := required[c.Module]; ok {
			required[c.Module] = true
		}
	}
	for _, present := range required {
		if !present {
			return fail(errors.New("queued manifest requires complete core and Treasury pins"))
		}
	}
	sort.Slice(m.Contracts, func(i, j int) bool { return m.Contracts[i].Module < m.Contracts[j].Module })
	raw, _ = json.Marshal(m)
	return m, hash(raw), nil
}
