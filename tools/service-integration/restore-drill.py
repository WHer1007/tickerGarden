#!/usr/bin/env python3
"""Restore the captured service database into a disposable local PostgreSQL cluster.

No network, application credentials, or source database are used. The cluster is
created under a temporary directory, stopped, and preserved after verification.
"""
import argparse, hashlib, json, os, pathlib, socket, subprocess, tempfile, time

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "outputs/reviews/formal-clock-service-integration-2026-09-06/service-live"

def run(cmd, env=None, check=True):
    return subprocess.run(cmd, text=True, capture_output=True, env=env, check=check)

def normalized(value):
    if isinstance(value, dict): return {k: normalized(v) for k, v in value.items()}
    if isinstance(value, list): return [normalized(v) for v in value]
    return value.lower() if isinstance(value, str) and value.startswith('0x') else value

def verify_content(sql, journal, job):
    rows = sql("SELECT json_build_object('chain',chain_id,'tip',tip_number,'tipHash',tip_hash,'finalized',finalized_number,'finalizedHash',finalized_hash) FROM tickergarden.chain_journal WHERE chain_id=421614")
    assert len(rows) == 1
    restored = json.loads(rows[0])
    assert restored == {k: journal[k] for k in restored}, 'exact journal mismatch'
    rows = sql("SELECT json_build_object('tip',d.tip_number,'hash',d.tip_hash) FROM tickergarden.discovery_checkpoints d JOIN tickergarden.chain_blocks b ON b.chain_id=d.chain_id AND b.number=d.tip_number AND b.hash=d.tip_hash AND b.canonical AND b.receipts_verified WHERE d.chain_id=421614")
    assert len(rows) == 1
    discovered = json.loads(rows[0]); assert discovered['tip'] == journal['discovered']
    candidate_id = job['candidateId']
    assert len(candidate_id) == 66 and all(c in '0123456789abcdef' for c in candidate_id[2:])
    candidate = json.loads(sql("SELECT convert_from(payload,'UTF8') FROM tickergarden.treasury_candidates WHERE id='" + candidate_id + "'")[0])
    reference = json.loads((SRC/'attempt-2/independent-typescript.json').read_text())
    assert normalized(candidate['dataset']) == normalized(reference), 'restored candidate differs from independent reference'
    source = json.loads((SRC/'attempt-2/independent-input.json').read_text())
    assert normalized(candidate['input']) == normalized(source), 'restored candidate input differs'
    return {'exactJournal': restored, 'discoveryCanonicalAnchor': discovered, 'candidateId': candidate_id, 'candidateDatasetAndInputMatchIndependentReference': True, 'maxAppliedMigration': int(sql('SELECT max(version_id) FROM public.tickergarden_goose_version WHERE is_applied')[0]), 'permissionsRestored': False, 'scope': 'Data/schema/candidate recovery only; original owners and ACL deliberately omitted. No migration upgrade or new chain action.'}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=pathlib.Path, default=ROOT / "outputs/reviews/backend-stability-capacity-2026-09-06/restore")
    args = ap.parse_args(); args.output.mkdir(parents=True, exist_ok=True)
    dump = SRC / "service-database.dump"
    expected = json.loads((SRC / "FINAL_EVIDENCE_SHA256.json").read_text())
    journal = json.loads((SRC / "final-journal-checkpoint.json").read_text())
    job = json.loads((SRC / "completed-job-after-restart.json").read_text())
    digest = hashlib.sha256(dump.read_bytes()).hexdigest()
    archive_ok = digest == expected["service-database.dump"]["sha256"]
    if not archive_ok: raise SystemExit("archive SHA256 mismatch; refusing restore")
    cluster = pathlib.Path(tempfile.mkdtemp(prefix="tg-restore-drill-")); s=socket.socket(); s.bind(("127.0.0.1",0)); port=s.getsockname()[1]; s.close()
    env = dict(os.environ, PGHOST="127.0.0.1", PGPORT=str(port), PGUSER="postgres")
    report = {"archive": {"sha256": digest, "bytes": dump.stat().st_size, "matches_final_evidence": archive_ok}, "cluster": {"data_directory": str(cluster), "port": port}}
    try:
        run(["initdb", "-D", str(cluster), "-U", "postgres", "--no-locale", "--encoding=UTF8", "--auth=trust"])
        run(["pg_ctl", "-D", str(cluster), "-l", str(cluster / "postgres.log"), "-o", f"-p {port} -h 127.0.0.1", "-w", "start"], env=env)
        for _ in range(30):
            if run(["pg_isready", "-h", "127.0.0.1", "-p", str(port)], env=env, check=False).returncode == 0: break
            time.sleep(1)
        run(["createdb", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "service_restore_drill"], env=env)
        run(["pg_restore", "--no-owner", "--no-acl", "--exit-on-error", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "service_restore_drill", str(dump)], env=env)
        def sql(q): return run(["psql", "-X", "-At", "-F", "\t", "-h", "127.0.0.1", "-p", str(port), "-U", "postgres", "-d", "service_restore_drill", "-c", q]).stdout.strip().splitlines()
        tables = sql("select schemaname||'.'||tablename from pg_tables where schemaname in ('public','tickergarden') order by 1")
        counts = {}
        for t in tables:
            counts[t] = int(sql(f'select count(*) from "{t.split(".")[0]}"."{t.split(".")[1]}"')[0])
        report["tables"] = counts
        report["constraints"] = int(sql("select count(*) from pg_constraint where connamespace in ('public'::regnamespace,'tickergarden'::regnamespace)")[0])
        # Checkpoint evidence is compared against restored rows by the stable chain fields.
        chain = sql("select chain_id,tip_number,tip_hash,finalized_number,finalized_hash from tickergarden.chain_journal where chain_id=421614")
        disc = sql("select chain_id,tip_number,tip_hash from tickergarden.discovery_checkpoints where chain_id=421614")
        report["journal_checkpoint"] = {"evidence": journal, "restored_rows": chain, "matches": any(r.startswith(f'421614\t{journal["tip"]}\t{journal["tipHash"]}\t{journal["finalized"]}\t{journal["finalizedHash"]}') for r in chain)}
        report["discovery_checkpoint"] = {"restored_rows": disc, "matches_tip": any(r.startswith(f'421614\t{journal["discovered"]}\t') for r in disc)}
        jobrows = sql("select id,state,attempts,candidate_id,coalesce(error_code,''),recovery_count from tickergarden.treasury_jobs where id='" + job["id"] + "'")
        report["completed_job"] = {"evidence": job, "restored_row": jobrows, "matches": any(r == f'{job["id"]}\t{job["state"]}\t{job["attempts"]}\t{job["candidateId"]}\t{job["errorCode"]}\t{job["recoveryCount"]}' for r in jobrows)}
        report["contentVerification"] = verify_content(sql, journal, job)
        report["status"] = "PASS" if report["journal_checkpoint"]["matches"] and report["discovery_checkpoint"]["matches_tip"] and report["completed_job"]["matches"] else "INCOMPLETE"
    finally:
        stop = run(["pg_ctl", "-D", str(cluster), "-m", "fast", "-w", "stop"], check=False)
        report["cluster"]["stopped"] = stop.returncode == 0
        report["cluster"]["restoration_directory_preserved"] = cluster.exists()
    (args.output / "restore-drill.json").write_text(json.dumps(report, indent=2) + "\n")
    (args.output / "REPORT.md").write_text("# PostgreSQL restore drill\n\n" + "Status: **%s**\n\n" % report["status"] + "The captured custom-format dump was SHA256-verified, restored into a temporary local PostgreSQL cluster, inspected, and the cluster was stopped and preserved. Ownership/ACL and migration upgrades are outside this drill. See `restore-drill.json` for counts and checkpoint/job observations.\n")
    print(json.dumps(report, indent=2))

if __name__ == "__main__": main()
