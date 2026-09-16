#!/usr/bin/env python3
"""Require certificates for external app roles; preserve authenticated local workers.
Run on VPS only AFTER all deployments send the matching client certificate.
"""
import argparse,ipaddress,json,pathlib,subprocess
p=argparse.ArgumentParser();p.add_argument('environment',choices=['test','production']);p.add_argument('--apply',action='store_true');args=p.parse_args()
stage='prod' if args.environment=='production' else 'test'
container=f'tickergarden-postgres-{stage}-1'
def run(*cmd):return subprocess.check_output(cmd,text=True).strip()
info=json.loads(run('docker','inspect',container))[0]
networks=list(info['NetworkSettings']['Networks'])
subnets=[]
for network in networks:
 for x in json.loads(run('docker','network','inspect',network))[0]['IPAM']['Config']:
  subnet=x.get('Subnet')
  if subnet:subnets.append(str(ipaddress.ip_network(subnet)))
# VPS resident workers connect to the host's published DB address.
local_ips=run('hostname','-I').split()
trusted=subnets+[str(ipaddress.ip_network(ip+'/32' if ':' not in ip else ip+'/128',strict=False)) for ip in local_ips]
lines=['# Managed by enforce-db-client-certs.py','local all all trust','local replication all trust']
for net in ['127.0.0.1/32','::1/128']+trusted:
 lines.append(f'host all all {net} scram-sha-256')
for net in ['0.0.0.0/0','::/0']:
 lines.extend([f'hostnossl all all {net} reject',f'hostssl tickergarden tg_read_api,tg_pipeline,tg_content {net} scram-sha-256 clientcert=verify-full',f'host all all {net} reject'])
text='\n'.join(lines)+'\n'
print(text)
if not args.apply:raise SystemExit(0)
base=pathlib.Path('/etc/tickergarden/security')/args.environment
base.mkdir(parents=True,exist_ok=True,mode=0o700)
backup=base/'pg_hba.before.conf'
if not backup.exists():backup.write_text(run('docker','exec',container,'cat','/var/lib/postgresql/data/pg_hba.conf')+'\n');backup.chmod(0o600)
new=base/'pg_hba.conf';new.write_text(text);new.chmod(0o600)
subprocess.run(['docker','cp',str(base/'ca.crt'),container+':/var/lib/postgresql/data/client-ca.crt'],check=True)
subprocess.run(['docker','exec',container,'chown','postgres:postgres','/var/lib/postgresql/data/client-ca.crt'],check=True)
subprocess.run(['docker','exec',container,'chmod','644','/var/lib/postgresql/data/client-ca.crt'],check=True)
run('docker','exec',container,'psql','-U','tg_admin','-d','tickergarden','-c',"ALTER SYSTEM SET ssl_ca_file='/var/lib/postgresql/data/client-ca.crt'")
subprocess.run(['docker','cp',str(new),container+':/var/lib/postgresql/data/pg_hba.conf'],check=True)
run('docker','exec',container,'chown','postgres:postgres','/var/lib/postgresql/data/pg_hba.conf')
run('docker','exec',container,'psql','-U','tg_admin','-d','tickergarden','-c','SELECT pg_reload_conf()')
errors=run('docker','exec',container,'psql','-U','tg_admin','-d','tickergarden','-Atc','SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL')
if errors:raise RuntimeError(errors)
print('Client certificates required for external application roles.')
