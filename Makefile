.PHONY: install dev build start test typecheck parse debug docker docker-run compose clean

PDF ?= tests/fixtures/anul_i_semestrul_ii-1.pdf
OUT ?= debug

install:
	npm ci

dev:
	npm run dev

build:
	npm run build

start:
	npm run start

test:
	npm test

typecheck:
	npx tsc --noEmit

## Parse a PDF and print schedule.json + statistics
parse:
	npm run parser -- parse $(PDF)

## Write debug artefacts (detected_groups.json, cells.json, lessons.json, page_debug.svg)
debug:
	npm run parser -- debug $(PDF) --output $(OUT)

docker:
	docker build -t fcim-schedule .

docker-run:
	docker run --rm -p 8000:8000 -v fcim-schedule-data:/app/data fcim-schedule

compose:
	docker compose up --build

clean:
	rm -rf .next debug .test-data
