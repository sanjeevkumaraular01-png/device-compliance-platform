# TLS certificates for Nginx

Nginx expects two PEM files in this directory (or in the directory set by
`TLS_CERT_DIR` in `.env`), mounted read-only at `/etc/nginx/certs`:

| File            | Content                                                          |
|-----------------|------------------------------------------------------------------|
| `fullchain.pem` | Server certificate followed by the intermediate chain            |
| `privkey.pem`   | Private key (RSA 2048+ or ECDSA P-256), `chmod 600`, never commit |
| `agent-ca.pem`  | *Optional* — internal device CA, only when enabling agent mTLS   |

`*.pem` files are git-ignored.

## Option 1 — Local / lab: self-signed

```bash
./scripts/gen-self-signed-cert.sh            # CN/SAN = localhost + 127.0.0.1
DOMAIN=sem.lab.local ./scripts/gen-self-signed-cert.sh
```

Browsers will warn, and endpoints running the agent must trust the certificate
(import `fullchain.pem` into the OS trust store before installing the agent).
Do not use self-signed certificates in production.

## Option 2 — Corporate / public CA

Concatenate server certificate and intermediates into `fullchain.pem`:

```bash
cat server.crt intermediate.crt > fullchain.pem
cp server.key privkey.pem && chmod 600 privkey.pem
docker compose restart nginx
```

## Option 3 — Let's Encrypt (certbot)

The HTTP server block serves `/.well-known/acme-challenge/` from
`/var/www/certbot`. Mount a webroot and run certbot next to the stack:

```bash
# 1. add to the nginx service in a compose override:
#      volumes: [ "./deploy/nginx/acme:/var/www/certbot:ro" ]
# 2. obtain the certificate (port 80 must be reachable from the internet)
docker run --rm \
  -v "$PWD/deploy/nginx/acme:/var/www/certbot" \
  -v "$PWD/deploy/nginx/letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly --webroot -w /var/www/certbot \
  -d sem.example.com --email secops@example.com --agree-tos --non-interactive
# 3. point TLS_CERT_DIR at the live directory (contains fullchain.pem + privkey.pem)
#      TLS_CERT_DIR=./deploy/nginx/letsencrypt/live/sem.example.com
#    (the live/ files are symlinks into ../../archive — mount the whole
#     letsencrypt dir if your Docker version does not follow them)
# 4. renew from cron (twice daily) and reload nginx
0 3,15 * * * cd /opt/secureendpoint && docker run --rm -v "$PWD/deploy/nginx/acme:/var/www/certbot" -v "$PWD/deploy/nginx/letsencrypt:/etc/letsencrypt" certbot/certbot renew --quiet && docker compose exec nginx nginx -s reload
```

On Kubernetes, TLS is handled by cert-manager on the Ingress instead
(see `deploy/k8s/README.md`).

## Agent mTLS CA

```bash
curl -fsS https://sem.example.com/api/v1/enrollment/ca.pem -o agent-ca.pem
```

then follow the instructions at the top of `conf.d/secureendpoint.conf`.
