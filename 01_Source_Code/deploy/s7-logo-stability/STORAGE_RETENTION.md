# LOGO storage retention

Operational policy established on 2026-11-02. Inspect live release and container
state before applying it; old inventories are not an authorization to remove new
releases.

## Releases and container images

- Keep complete local source recovery archives for the running LOGO release and
  its immediately previous release. Record the exact commit and archive SHA256.
- Archive older LOGO release backup directories to the existing private OSS
  storage prefix before local eviction. Historical configuration copies must be
  encrypted with AES-256-GCM. Store only an RSA-OAEP-SHA256 key envelope in OSS;
  keep the recovery private key separately from the ECS and OSS role.
- A successful upload is insufficient. Fully read back and authenticate the
  archive, compare every member's content, size, type, mode, UID and GID, and run
  a restore into a private new directory. The final restore proof must bind the
  archive and manifest digests, and be published only after all authentication
  and subprocess checks pass.
- Recheck source files, release identities, protected configuration hashes,
  service PIDs and container start times immediately before local eviction.
- Protect every image referenced by any container and the actual previous
  release image in `/srv/frame/releases/state`. Do not infer the previous image
  from an old ledger or image age. Archive selected obsolete images and verify
  authenticated recovery before removing their local image references.
- Authenticate a downloaded image archive into a restricted temporary file
  before passing it to Docker. Do not stream unauthenticated plaintext into the
  daemon. Do not prune volumes or change running containers.

## Customer and scheduler data

The image generation and customer task formats remain unchanged. Working images
and small task indexes remain local; snapshots replicate them to private OSS.
Existing generated originals and previews also retain their generation storage
objects. No lossy recompression is applied to original logos or output images.

The root-only tools live under `/var/lib/s7-logo-archive`. The incremental data
snapshot includes customer task/history JSON and images, shared uploads,
scheduler results, raw plans, archived gzip plans, and consistent PostgreSQL and
SQLite backups. Immutable file contents are deduplicated by SHA256 under
`s7-logo/scheduler-backups/v1/blobs/`; completion manifests are published last.

Prepare a private snapshot by copying mutable metadata and linking immutable
image/plan files. Compare the full source tree before and after preparation and
fail on traversal/read errors. SQLite's online backup and integrity check provide
its transaction-consistent database snapshot; session WAL timestamp changes do
not invalidate it. Hash and upload through the same no-follow file handle.
Verify every cloud object in full and every plan referenced by the restored
scheduler database, including gzip archives. Encrypt database backups and check
their cloud decryption against the original plaintext SHA256.

Before enabling the scheduled replacement, verify an OSS restore into private
new directories, restore PostgreSQL into an isolated database, run SQLite's
integrity check, and exercise customer task asset, history and result image reads
against restored copies. Distinguish full backup verification from sampled
restore verification in reports. The live app, FRAME/GitLab containers and
provider settings must remain unchanged. Never test paid generation as part of
storage maintenance.

Local operational evidence:

- `/var/lib/s7-logo-archive/release-verified.json`
- `/var/lib/s7-logo-archive/release-retention-result.json`
- `/var/lib/s7-logo-archive/image-verified.json`
- `/var/lib/s7-logo-archive/image-authenticated-restore.json`
- `/var/lib/s7-logo-archive/image-retention-result.json`
- `/var/lib/s7-logo-archive/snapshot-success.json`
- `/var/lib/s7-logo-archive/snapshot-restore-verified.json`

The independent recovery private key is held locally outside this repository.
Do not copy it into source, diagnostic bundles, the server, or the OSS prefix.
