# Mnemo task runner. `just` lists recipes.

default:
    @just --list

# Install dependencies
install:
    npm ci

# Dev server at http://localhost:5173
dev:
    npx vite --host

# Unit tests
test:
    npx vitest run

# Rerun unit tests on save
watch:
    npx vitest

# Typecheck
typecheck:
    npx tsc --noEmit -p .

# Production build into dist/
build:
    npx tsc --noEmit -p . && npx vite build

# Serve the production build locally
preview: build
    npx vite preview --host

# Live end-to-end run against Gemini; prints tokens and cost per call. Needs GEMINI_API_KEY (or .env).
smoke:
    set -a; [ -f .env ] && . ./.env; set +a; SMOKE=1 npx vitest run --reporter=verbose
