# DigitalOcean VPS access

Last verified: 2026-09-11 (Asia/Shanghai)

## Server

| Field | Value |
| --- | --- |
| Provider | DigitalOcean |
| Region | Singapore (`sgp1`) |
| IPv4 | `159.89.207.161` |
| SSH user | `tickergarden` |
| Hostname | `ubuntu-s-2vcpu-4gb-sgp1` |
| Operating system | Ubuntu 24.04 LTS |
| Kernel | Linux 6.8.0-124-generic x86_64 |
| CPU | 2 vCPU |
| Memory | 4 GB |
| Root disk | 80 GB |

## SSH identity

The private key stays on the local workstation and must never be committed to Git or copied into a Vercel environment variable.

| Field | Value |
| --- | --- |
| Private key | `/Users/dear/.ssh/tickergarden_digitalocean_ed25519` |
| Public key | `/Users/dear/.ssh/tickergarden_digitalocean_ed25519.pub` |
| Public key fingerprint | `SHA256:hQ50ixzv7I8NYxcsRjrFooad+E4heFHY96iWqWaAScQ` |
| Dedicated known-hosts file | `/Users/dear/.ssh/tickergarden_digitalocean_known_hosts` |
| Server ED25519 fingerprint | `SHA256:O8Yw/zuDuJwXD+L8nJoTkLnsTjjRnINsvxXVwrYbBgo` |

## Login

Use strict host-key verification with the dedicated known-hosts file:

```bash
ssh \
  -i ~/.ssh/tickergarden_digitalocean_ed25519 \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/tickergarden_digitalocean_known_hosts \
  tickergarden@159.89.207.161
```

Non-interactive connectivity check:

```bash
ssh \
  -i ~/.ssh/tickergarden_digitalocean_ed25519 \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o UserKnownHostsFile=~/.ssh/tickergarden_digitalocean_known_hosts \
  tickergarden@159.89.207.161 'hostname && uname -srm'
```

Direct root login and SSH password authentication are disabled. The `tickergarden` account uses the dedicated key above and has sudo access for operations.

If SSH reports that the server host key changed, stop and compare the new fingerprint in the DigitalOcean control panel before updating the known-hosts file.
