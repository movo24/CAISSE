.PHONY: install dev-backend dev-pos dev-backoffice docker-up docker-down test lint format clean

install:
	npm install

dev-backend:
	npm run dev:backend

dev-pos:
	npm run dev:pos

dev-backoffice:
	npm run dev:backoffice

docker-up:
	npm run docker:up

docker-down:
	npm run docker:down

test:
	npm run test

test-backend:
	npm run test:backend

lint:
	npm run lint

format:
	npm run format

clean:
	rm -rf node_modules packages/*/node_modules packages/*/dist packages/*/build shared/node_modules

setup: install docker-up
	@echo "Setup complete. Run 'make dev-backend' to start the API."
