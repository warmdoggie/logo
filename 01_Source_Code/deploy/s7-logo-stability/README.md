# S7 Logo Stability deployment assets

These files are for the isolated logo workspace on the shared ECS. They must not be
installed through the FRAME deployment launcher.

## Isolation contract

- Domain: `logo.heciai.net`
- Workspace listener: `127.0.0.1:3210`
- S7 is mounted at `/s7/` by the workspace listener on `127.0.0.1:3210`
- Service: `s7-workspace.service` (one process serves the workspace and S7)
- Linux user: `s7-logo`
- Application directory: `/srv/s7-logo`
- Protected configuration: `/etc/s7-logo`
- Logs: `/var/log/s7-logo` and `/var/log/nginx/s7-logo-*.log`
- FRAME paths, port 3000, Docker containers, PostgreSQL, and `frame-operations`
  are outside this module's deployment boundary.

## Required server-side preparation

1. Create the `s7-logo` user and the isolated directories.
2. Deploy one reviewed merged-workspace commit to `/srv/s7-logo`.
3. Copy `production.env.example` to `/etc/s7-logo/production.env`.
4. Create `/etc/s7-logo/ai-provider.json` from the example and enter the
   APIMart key only in the protected server file.
5. Set `/etc/s7-logo` to `root:root 0700`, its JSON and env files to
   `root:root 0600`, and `/srv/s7-logo` to `s7-logo:s7-logo` ownership.
6. Create `/etc/nginx/.htpasswd-s7-logo` before enabling the Nginx template.
7. Confirm the DNS record and certificate for `logo.heciai.net`.

## Safe activation order

1. Restart `s7-workspace.service` and verify `curl http://127.0.0.1:3210/api/health` and `curl http://127.0.0.1:3210/s7/healthz`.
2. Run `nginx -t`.
3. Reload Nginx and verify the workspace and S7 module through the public domain.
4. After verification, disable the retired `s7-logo.service` with `systemctl disable --now s7-logo.service`.
   Do not restart FRAME, GitLab, Docker, or
   PostgreSQL.

The deployment assets do not contain a real credential, certificate key, or
server address.

## Updating a workspace that uses the durable scheduler

Read each service's live `WorkingDirectory` before updating code; an existing
installation may serve the workspace from `/srv/ai-logo/01_Source_Code`.
The right-hand print combinations use local composition. Only the explicit
Logo “AI 精细化处理” button invokes the AI Logo processor.

The `logo-scheduler-images.service` process imports application rendering modules
and caches them until it exits. When changing print versions, finishes, masks or
rendering modules, wait for active jobs to finish and restart this image worker
after updating the application files. Restarting only the workspace leaves the
worker using the previous rules and can make new combinations fail locally.
Restart `logo-scheduler-api.service` as well when changing the plan upload
protocol. Preserve the deployed OSS plan reader and protected configuration.

After activation, confirm the image worker started after the code update and
verify a mixed local print plan through the worker, including rose-gold and laser
masks. An application health response alone does not verify the image worker.
