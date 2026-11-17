# OSS-backed immutable scheduler plans

This is a scoped LOGO scheduler patch for the existing cn-heyuan ECS
`i-f8zjczn9o390i523upyd`. Do not run the scheduler installer or deploy the full
dirty application checkout. FRAME, GitLab, databases, ingress, paid-provider
configuration, OSS permissions and the backup timer schedule are outside scope.

## Behavior and evidence

- Preserve exact serialized plan bytes and their existing SHA-256 fingerprints.
  New plans go to private `heci-002/s7-logo/scheduler-backups/v1/plans/<hash>.json.gz`.
  Upload and full decompressed readback verification precede queue creation.
- Local raw plans remain readable. Missing local files are loaded into memory
  from OSS and are not cached back to disk. No image dimensions, masks or paid
  generation requests are changed.
- Fetch a plan before recording the paid-submit marker. A crash during fetching
  safely requeues; an uncertain provider POST still requires manual resolution.
  Temporary plan-read outages preserve image-processing retry attempts.
- Daily snapshots verify all database plan references against either local
  files or the immutable OSS objects; manifests record `remotePlans`. The
  isolated recovery script covers cloud plans through the production reader.
- The migration tool is read-only by default. Publishing and local eviction
  are distinct actions. Raw and gzip sources must match their filename hash,
  cloud data must pass full verification, source identities must remain stable,
  and a durable receipt must exist before local unlinking.

Read-only baseline, 2026-11-04: 71 raw plans (3,690,068,188 bytes), 44 gzip
archives (1,285,803,958 bytes), plus 44 small metadata records. Approximately
4.63 GiB of logical local plan data can be evicted after verification. The three
scheduler processes already have the independent storage role configured.
Production `logo-data-snapshot.mjs` is the root-only registry copy, not the
application-directory copy. Its baseline SHA-256 is
`455fccff93a3e0444393c08801d0f5c08bbc00f5236caf7116cecad0ddc94e7e`.

## Approval scope

Before any live mutation obtain exact candidate-SHA approval for this ECS LOGO
release and OSS `PutObject` approval for the private bucket/prefix above.
Local eviction is limited to the 64-hex `.json` files in
`/var/lib/logo-scheduler/results/plans` and 64-hex `.json.gz` files in
`/var/lib/logo-scheduler/completed-plan-archives` that pass verified migration.
The existing metadata records, images, database data, historical backup objects,
running/rollback container images and Docker volumes remain protected.

## Activation sequence

1. Recheck exact code hashes, healthy services and containers, backup freshness,
   disk reserve, all database plan hashes, and in-flight jobs. Save the old
   versions of the deployed files in a private root-owned release directory.
   Verify the candidate archive against its generated deployment manifest.
2. Extract the candidate into a private directory beneath
   `/var/lib/s7-logo-archive` so its modules can resolve the existing installed
   dependencies. Run `maintain.mjs inventory` there. It must match the fresh
   read-only inventory; stop on unknown files, drift, symlinks or errors.
3. Hold the existing `/var/lib/s7-logo-archive/backup.lock` exclusively throughout
   publishing, activation and eviction. Do not disable or change the timer.
   Run `maintain.mjs publish` and retain its durable receipt. This action uploads
   and verifies every selected plan but removes no local file.
4. Gracefully quiesce the three LOGO scheduler services. Do not proceed while
   a paid POST is in flight. Atomically replace only the manifest targets:
   scheduler `plans.mjs`, `business-api.mjs`, `engine.mjs`, `provider.mjs`,
   `store.mjs`, `plan-maintenance.mjs`; application `logo-plan-storage.mjs`;
   registry `logo-plan-storage.mjs`, `logo-data-snapshot.mjs`,
   `restore-snapshot.mjs`. Preserve directory ownership/modes and readable
   scheduler/app source permissions. Protected environment files stay untouched.
5. Start the same three scheduler services and check scheduler, LOGO, FRAME and
   GitLab health. Run `maintain.mjs verify`; every plan referenced in PostgreSQL
   must pass full cloud verification and the deployed production reader.
6. Under the same backup lock, run `maintain.mjs evict`, then `verify` again.
   A failure stops further eviction and leaves prior receipts and OSS copies.
   Check actual filesystem availability, raw/gzip counts, service PIDs/container
   start times, failed unit states and unchanged task/provider identities.
7. New production plans must leave no raw plan file. Validate this with a
   non-paid isolated request using production modules and disposable directories,
   not by submitting a real generation. Keep the existing nightly backup and
   run a separately approved full backup/recovery drill after migration. An
   actual new backup write and isolated database restore require their named
   independent approvals; local tests are not production restore evidence.

`maintain.mjs` is invoked with the existing `/opt/node-v24.17.0/bin/node`.
It requires root on the exact host and never prints protected values or plan
contents. It does not restart services or change any database record.

## Rollback

Before reverting the new reader, keep the new `maintain.mjs` and storage module
available, gracefully quiesce the LOGO scheduler, and run `maintain.mjs restore`.
It verifies every referenced cloud plan, checks sufficient disk reserve,
materializes raw JSON atomically, and assigns the plan directory's UID/GID to
the files so the old scheduler can read them. Verify all local plan fingerprints,
then restore the private saved source versions and start the same services.
Do not roll back the reader first and do not restore a production database.
OSS objects and old backup manifests are retained throughout.
