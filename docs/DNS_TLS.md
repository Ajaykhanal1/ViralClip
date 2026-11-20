# DNS and TLS

## DNS

Create an `A` record for `DOMAIN` pointing to the host IPv4 address (and `AAAA` if applicable).
All public origins in `.env` must use the same hostname:

```dotenv
DOMAIN=example.com
CORS_ORIGINS=https://example.com
APP_URL=https://example.com
NEXT_PUBLIC_API_URL=https://example.com
GOOGLE_REDIRECT_URI=https://example.com/api/v1/youtube/oauth/callback
```

`NEXT_PUBLIC_API_URL` is inlined into the web bundle at image build time. If you change it, rebuild
the web image.

## Certificates

nginx expects two files in `TLS_CERT_DIR` (default `./deploy/certs`):

- `fullchain.pem`
- `privkey.pem`

With Certbot installed on the host, obtain the first certificate before starting nginx (port 80 must
be free):

```bash
sudo certbot certonly --standalone -d "$DOMAIN"
sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" deploy/certs/fullchain.pem
sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" deploy/certs/privkey.pem
sudo chown "$USER" deploy/certs/*.pem
chmod 600 deploy/certs/privkey.pem
```

The HTTP server in `deploy/nginx/default.conf` also serves `/.well-known/acme-challenge/` from the
shared `certbot-www` volume if you later switch renewal to a containerized webroot flow. Copy renewed
files into `deploy/certs` and reload nginx:

```bash
docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
```

## HTTPS policy

- Port 80 redirects to HTTPS; only the ACME challenge path is served over HTTP.
- TLS 1.2+ only, HSTS enabled with `includeSubDomains` (remove `includeSubDomains` only if a
  subdomain must stay on HTTP).
- MySQL, Redis, AI, API, worker, and web are on an internal Docker bridge network. Only nginx
  publishes ports.
- If TLS terminates at a cloud load balancer instead, remove the nginx HTTPS server and forward
  `X-Forwarded-Proto` from the trusted proxy; the API trusts exactly one proxy hop.

## Renewal automation

Add a monthly cron entry that renews, copies the files, and reloads nginx:

A simple monthly renewal (brief nginx downtime while port 80 is used by Certbot):

```cron
0 4 1 * * cd /srv/viralclip && docker compose -f docker-compose.prod.yml stop nginx && sudo certbot renew --standalone --quiet && sudo cp /etc/letsencrypt/live/example.com/fullchain.pem deploy/certs/fullchain.pem && sudo cp /etc/letsencrypt/live/example.com/privkey.pem deploy/certs/privkey.pem && docker compose -f docker-compose.prod.yml start nginx
```

Replace `example.com` with your domain and verify the certificate expiry after the first run.
