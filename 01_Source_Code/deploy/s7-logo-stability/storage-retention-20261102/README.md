# Reviewed storage maintenance tools

These are root-operated Linux tools for the existing LOGO ECS and private OSS
storage role. They are not frontend assets and must not be run by the application
user or by the FRAME deployment launcher.

The release/image selection scripts are intentionally tied to the reviewed
2026-11-02 inventory. Their commit, image and release-state guards must fail when
the live release changes. Do not remove these guards to reuse a stale selection.
The recurring snapshot tools are independent of the running app version and keep
the existing customer/task/plan formats.

Installed operational directory: `/var/lib/s7-logo-archive`, root-owned `0700`.
It also contains reviewed copies of `logo-data-snapshot.mjs` and
`logo-oss-client.mjs`, and uses the existing application's installed dependencies.
Do not run the application installer or edit provider/ingress settings for these
operations. Secret configuration is read only from its existing protected files.

The established sequence is:

1. Inventory the live release, all containers, actual previous FRAME release,
   backup folders, protected configuration hashes and application PIDs.
2. `prepare.py` retains exact current/previous source archives and records the
   older release selection. Keep the original preparation manifest: it retains
   exact timestamps for legacy manifests whose numeric nanoseconds were rounded.
3. `archive-releases.mjs` encrypts and streams old backups to private OSS, fully
   reads them back, and verifies every archive member. `restore-releases.mjs`
   restores a selected folder into a private new destination; only its final
   authenticated proof can permit `evict-releases.py`.
4. `archive-images.mjs` archives the selected obsolete images. Recovery must
   authenticate into a restricted temporary file before Docker loads it.
   `restore-images.mjs` produces the manifest-bound proof required by
   `evict-images.py`. All live images and the actual previous image stay protected.
5. `cloud-backup.sh` makes and checks isolated database backups, then
   `freeze-data.py` prepares a stable private file snapshot.
   `backup-snapshot.mjs` encrypts databases, verifies cloud decryption, uploads
   content-addressed objects and publishes a verified completion manifest last.
   `cleanup-stage.py` removes only the successful private staging copy.
6. `restore-snapshot.mjs` performs a sampled cloud restore: all task/history JSON,
   real logo and result images, raw/gzip plans, PostgreSQL and SQLite. It uses
   production read functions against private restored copies and never submits a
   generation request. Its report distinguishes sampled restore checks from the
   full backup's file and plan verification.
7. `activate-backup.py` requires the restore proof before replacing only the
   existing backup service's ExecStart via a drop-in. The existing daily timer,
   CPU limit and memory/heap limits remain in use. `finalize.py` requires that
   formal service run to succeed, checks application/container stability and
   health, and cleans only private test staging directories.

AES keys remain in the private server registry. Their RSA-OAEP-SHA256 envelopes
are offsite, while the recovery private key is kept independently on the owner's
computer, outside this repository. Never include that private key in uploads,
source archives or diagnostic output.

See [storage policy](../STORAGE_RETENTION.md) for the retention and restore
requirements. `SHA256SUMS` records the reviewed executable sources; syntax checks
and stream integrity/corruption/concurrent-write tests accompany the tools.
