## Summary

<!-- What does this change do and why? Link the issue: Closes #123 -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Security fix
- [ ] Refactor / tech debt
- [ ] Infrastructure / CI
- [ ] Documentation

## Components touched

- [ ] backend (NestJS / Prisma)
- [ ] frontend (Next.js)
- [ ] agent (Go)
- [ ] deploy / CI / docs

## Checklist

- [ ] Tests added or updated; `make test` passes locally
- [ ] API contract changes are reflected in `docs/API.md` (backend, frontend and agent agree)
- [ ] Prisma schema changes ship with a migration (`prisma migrate dev --name ...`) that is backward compatible with the previous release (expand → migrate → contract)
- [ ] New environment variables are added to `.env.example`, `docker-compose.yml`, `deploy/k8s/base/config.env` or `secret.example.yaml`, and `docs/ENVIRONMENT.md`
- [ ] New permissions are added to the RBAC matrix in `docs/API.md`
- [ ] Security-relevant actions write an audit log entry
- [ ] No secrets, tokens or customer data in code, logs, fixtures or screenshots
- [ ] Docs updated (`README.md` / `docs/`)

## Security considerations

<!-- AuthN/AuthZ impact, input validation, data exposure, crypto, agent trust model. "None" is a valid answer. -->

## Deployment notes

<!-- Migrations, config changes, rollout order, feature flags, rollback plan. -->

## Screenshots / evidence

<!-- UI changes, test output, Grafana panels... -->
