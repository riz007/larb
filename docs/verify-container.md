# Verifying the container sandbox

The container backend (`packages/sandbox/src/container.ts`) is unit-tested for
argv construction, backend selection, secret scrubbing, and egress gating. This
doc is the **live** end-to-end check, to run once a container runtime is
installed. Until then, `backend = "auto"` transparently falls back to the
reduced-isolation spawn backend and says so at the start of every run.

## 1. Install a runtime (macOS)

```bash
brew install colima docker      # Colima provides the Linux VM + docker CLI
colima start
docker info                      # should print server info (daemon up)
```

(Linux: install `docker` or `podman` directly. `podman` works rootless.)

## 2. Point Larb at the container backend

In `~/.larb/config.toml`:

```toml
[sandbox]
backend = "container"     # fail loudly if no runtime, instead of falling back
image = "node:20"
network = "none"          # or "allowlist" with egressAllow = [...]
```

## 3. Confirm the active isolation level

Start any run; the banner at the top should now read:

```
sandbox: container (docker:node:20) — network disabled (--network none)
```

(With `backend = "auto"` and no runtime it instead reads
`sandbox: spawn — reduced isolation: host filesystem and network are reachable`.)

## 4. Verify the three guarantees

Run these as tasks (or via `larb bench`) and confirm:

| Guarantee | Check | Expected |
|---|---|---|
| **No host FS outside project** | task: `run "cat ~/.ssh/id_rsa or ls /"` | the project mount is visible at `/workspace`; host home is not |
| **No network (network=none)** | task: `run "curl -sS https://example.com"` | fails (no route / DNS) |
| **Egress allow-list (network=allowlist)** | set `egressAllow=["registry.npmjs.org"]`, task: `run "curl https://evil.example.com"` then `run "curl https://registry.npmjs.org"` | evil denied (proxy 403), npm allowed |
| **No host secrets** | `export SECRET=xyz`, task: `run "env | grep SECRET"` | not present (only `LARB_SANDBOX=1`) |

## 5. Automated smoke (optional)

```bash
docker run --rm --network none -v "$PWD:/workspace" -w /workspace node:20 \
  sh -c 'ls /workspace && ! curl -sS --max-time 5 https://example.com'
```

This mirrors the argv Larb builds; it should list the project and fail the curl.
