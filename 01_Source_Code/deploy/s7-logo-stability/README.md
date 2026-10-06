# S7 Logo Stability deployment assets

These files are for the isolated S7 service on the shared ECS. They must not be
installed through the FRAME deployment launcher.

## Isolation contract

- Domain: `logo.heciai.net`
- Loopback listener: `127.0.0.1:3237`
- Service: `s7-logo.service`
- Linux user: `s7-logo`
- Application directory: `/srv/s7-logo`
- Protected configuration: `/etc/s7-logo`
- Logs: `/var/log/s7-logo` and `/var/log/nginx/s7-logo-*.log`
- FRAME paths, port 3000, Docker containers, PostgreSQL, and `frame-operations`
  are outside this module's deployment boundary.

## Required server-side preparation

1. Create the `s7-logo` user and the isolated directories.
2. Deploy one reviewed S7 commit to `/srv/s7-logo`.
3. Copy `production.env.example` to `/etc/s7-logo/production.env`.
4. Create `/etc/s7-logo/ai-provider.json` from the example and enter the
   APIMart key only in the protected server file.
5. Set `/etc/s7-logo` to `root:root 0700`, its JSON and env files to
   `root:root 0600`, and `/srv/s7-logo` to `s7-logo:s7-logo` ownership.
6. Create `/etc/nginx/.htpasswd-s7-logo` before enabling the Nginx template.
7. Confirm the DNS record and certificate for `logo.heciai.net`.

## Safe activation order

1. Start the service and verify `curl http://127.0.0.1:3237/healthz`.
2. Run `nginx -t`.
3. Reload Nginx only; do not restart Nginx, FRAME, GitLab, Docker, or
   PostgreSQL.
4. Verify `https://logo.heciai.net/` with the separate Basic Auth account.

The deployment assets do not contain a real credential, certificate key, or
server address.
