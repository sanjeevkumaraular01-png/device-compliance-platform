# SecureEndpoint Manager — developer & operator shortcuts.
# Requires: docker (compose v2), bash, openssl. On Windows use Git Bash / WSL, or
# run the underlying commands shown by `make -n <target>`.

SHELL          := /usr/bin/env bash
.SHELLFLAGS    := -eu -o pipefail -c
.DEFAULT_GOAL  := help

COMPOSE        ?= docker compose
DC             := $(COMPOSE) -f docker-compose.yml
DC_DEV         := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml
PROFILES       ?=
OVERLAY        ?= production
KUBECTL_IMAGE  ?= registry.k8s.io/kubectl:v1.31.0
SERVICE        ?=

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*?## ' $(MAKEFILE_LIST) | sort | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- setup
.PHONY: secrets
secrets: ## Generate .env with strong random secrets (refuses to overwrite)
	./scripts/generate-secrets.sh

.PHONY: certs
certs: ## Generate a self-signed TLS certificate for local use (DOMAIN=localhost)
	./scripts/gen-self-signed-cert.sh

.env:
	@echo ".env missing — run 'make secrets' first" >&2; exit 1

# ---------------------------------------------------------------- compose stack
.PHONY: up
up: .env ## Start the core stack (add PROFILES="--profile monitoring" for Prometheus/Grafana)
	$(DC) $(PROFILES) up -d --build
	@echo "Console: https://$$(grep -E '^DOMAIN=' .env | cut -d= -f2 || echo localhost)"

.PHONY: up-monitoring
up-monitoring: .env ## Start the stack including Prometheus, Alertmanager and Grafana
	$(DC) --profile monitoring up -d --build

.PHONY: down
down: ## Stop the stack (volumes are kept)
	$(DC) --profile monitoring --profile node-exporter down

.PHONY: dev
dev: .env ## Start stack with dev extras (exposed DB/Redis, Mailpit, OpenLDAP)
	$(DC_DEV) --profile ldap up -d --build
	@echo "Mailpit: http://127.0.0.1:8025   Postgres: 127.0.0.1:5432   Redis: 127.0.0.1:6379   LDAP: 127.0.0.1:389"

.PHONY: dev-down
dev-down: ## Stop the dev stack
	$(DC_DEV) --profile ldap down

.PHONY: logs
logs: ## Follow logs (SERVICE=backend to filter)
	$(DC) logs -f --tail=200 $(SERVICE)

.PHONY: ps
ps: ## Show service status
	$(DC) --profile monitoring ps

.PHONY: build
build: ## Build all container images
	$(DC) build --pull backend worker frontend agent-dist

.PHONY: agent-dist
agent-dist: ## (Re)populate the downloads volume with agent binaries
	$(DC) build agent-dist
	$(DC) run --rm agent-dist

.PHONY: seed
seed: ## Run the database seed again (idempotent) inside the api container
	$(DC) exec backend node dist/prisma/seed.js

.PHONY: migrate
migrate: ## Apply pending Prisma migrations inside the api container
	$(DC) exec backend npx prisma migrate deploy

.PHONY: backup
backup: ## pg_dump the database to ./backups/ (custom format)
	@mkdir -p backups
	$(DC) exec -T postgres sh -c 'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -Fc' > backups/sem-$$(date +%Y%m%d-%H%M%S).dump
	@ls -lh backups | tail -n 3

.PHONY: config
config: .env ## Validate docker compose configuration (all profiles)
	$(DC) config -q
	$(DC) --profile monitoring config -q
	$(DC_DEV) --profile ldap config -q
	@echo "compose config OK"

# ---------------------------------------------------------------- tests
.PHONY: test
test: test-backend test-frontend test-agent ## Run all unit tests / linters

.PHONY: test-backend
test-backend:
	cd backend && npm ci && npx prisma generate && npm run lint && npm test

.PHONY: test-frontend
test-frontend:
	cd frontend && npm ci && npm run lint && npm run typecheck

.PHONY: test-agent
test-agent:
	cd agent && go vet ./... && go test ./...

# ---------------------------------------------------------------- validation / k8s
.PHONY: k8s-render
k8s-render: ## Render a kustomize overlay (OVERLAY=staging|production) to stdout
	docker run --rm -v "$(CURDIR)/deploy/k8s:/k8s:ro" $(KUBECTL_IMAGE) kustomize /k8s/overlays/$(OVERLAY)

.PHONY: k8s-validate
k8s-validate: ## Render both overlays and validate with kubeconform
	@for o in staging production; do \
	  docker run --rm -v "$(CURDIR)/deploy/k8s:/k8s:ro" $(KUBECTL_IMAGE) kustomize /k8s/overlays/$$o > /tmp/sem-$$o.yaml; \
	  docker run --rm -v /tmp:/work:ro ghcr.io/yannh/kubeconform:latest -strict -summary \
	    -ignore-missing-schemas -kubernetes-version 1.31.0 /work/sem-$$o.yaml; \
	done

.PHONY: lint-infra
lint-infra: config k8s-validate ## Validate compose, nginx, prometheus, k8s and workflows
	./scripts/validate-infra.sh

.PHONY: prometheusrule
prometheusrule: ## Regenerate the k8s PrometheusRule from deploy/prometheus/alerts.yml
	./scripts/sync-prometheusrule.sh
