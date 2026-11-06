# Single source of truth for which repository paths constitute a release (sourced by ci-upload.sh and install-release.sh).
# CI-OWNED: deleted from the target and replaced on every deploy. Anything NOT listed is VPS-OWNED and never touched:
# .env, the data directory, backups. docs and test are deliberately not shipped.
# RELEASE_SHA is written by the pipeline (or manual-deploy.sh) just before the upload.
#
# RELEASE_PATHS must all exist in the checkout (ci-upload.sh fails otherwise).
RELEASE_PATHS="package.json tsconfig.json src public content Dockerfile .dockerignore docker-compose.prod.yml deploy.sh deploy.env.example scripts RELEASE_SHA"
# OPTIONAL_PATHS are shipped when present and removed from the target when absent (a bun.lock deleted from the repo must not linger).
OPTIONAL_PATHS="bun.lock"
