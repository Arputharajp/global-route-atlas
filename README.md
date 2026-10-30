# Global Route Atlas — production-ready deployment package

React + Vite + MapLibre frontend with animated air/sea route visualization. Sea-routing credentials are now kept on the server: the browser calls `/api/sea/route`, and the Node backend forwards the request to the private `auto-sea-way` service.

## 1. Local development (Windows PowerShell)

Requirements: Node.js 20+ and Docker Desktop.

1. Copy `.env.example` to `.env.local`.
2. Set the same long random key in `.env.local` and in `ASW_API_KEY` when starting the router. For local development the defaults match.
3. Start the sea router:

```powershell
docker compose -f docker-compose.sea-router.yml up -d
```

4. Open a terminal and start the backend:

```powershell
npm install
npm run server
```

5. Open a second terminal and start Vite:

```powershell
npm run dev
```

Vite forwards `/api` calls to `http://localhost:4000`. Open the local URL shown by Vite. The browser never receives the sea-router API key.

To stop the local router: `docker compose -f docker-compose.sea-router.yml down`.

## 2. Production architecture on Railway

Deploy **two separate Railway services from the same project**:

### Service A — `sea-router`

- Create a new Railway service using the Docker image `ghcr.io/auto-sea-way/asw:0.10.0-full`.
- Set the variable `ASW_API_KEY` to a long random secret. Do not add a public domain to this service.
- The service listens on port `3000`. Use Railway private networking for service-to-service access.
- Ensure the service has enough memory and disk for the full global routing graph. Monitor memory during initial graph load and route requests; do not assume a small hobby instance is sufficient.

### Service B — `global-route-atlas` app

- Push this project to your GitHub repository.
- In Railway, create a project and deploy the GitHub repository as a service.
- Railway uses the included `Dockerfile` and `railway.json`.
- Set these variables in the app service:
  - `NODE_ENV=production`
  - `SEA_ROUTER_URL=http://sea-router.railway.internal:3000` (replace `sea-router` with the exact Railway service name if you name it differently)
  - `SEA_ROUTER_KEY` = exactly the same secret value configured as `ASW_API_KEY` on the router service
  - `SEA_RATE_LIMIT_PER_MINUTE=20` (adjust after monitoring)
  - `SEA_ROUTER_TIMEOUT_MS=90000`
- Generate a public domain for the **app service only** and connect your custom domain when ready.
- The app health check is `/api/health`.

If Railway assigns a different private DNS hostname, use the hostname shown in its service networking panel. Keep the router private; only the app service should be public.

## 3. Docker Compose production-like local test

Set `ASW_API_KEY` in your shell, then run:

```powershell
$env:ASW_API_KEY = "replace-with-a-long-random-secret"
docker compose up --build -d
```

Open `http://localhost:4000`. Check `http://localhost:4000/api/health`.

## 4. Security and operations

- Never use `VITE_SEA_ROUTER_KEY` or put the router key in frontend environment variables. `VITE_*` variables are compiled into public browser assets.
- Keep `ASW_API_KEY` and `SEA_ROUTER_KEY` in Railway service variables, not in GitHub.
- The backend validates coordinate ranges, applies a per-IP rate limit and times out slow upstream requests.
- Keep the sea-router service private; do not expose port 3000 publicly.
- Add monitoring and billing alerts. Global routing graph startup can require substantial memory, storage and download time.
- Public Nominatim geocoding and OpenFreeMap tiles are third-party services. Review their current usage policies, attribution requirements and capacity before launch; for production traffic use a provider or self-hosted service suitable for your expected usage.

## 5. Route accuracy limitations

- **Air mode** currently draws a great-circle approximation. It is not a published airway, actual airline route or recorded flight track. Obtain and integrate licensed/current aviation airway data before presenting air paths as operational routes.
- **Sea mode** uses the configured global water-routing engine. It is not a nautical chart and does not guarantee vessel draft/depth clearance, port approach restrictions, traffic separation scheme compliance or an actual carrier route. Do not use it for navigation or operational voyage planning without professional validation.
- The sea router's availability and API response format must be verified against the deployed image version during staging before public launch.

## 6. Health check

`GET /api/health` returns `status: ok` and whether the sea router environment variables are configured. It does not prove that the upstream sea-router has completed its graph initialization; test a known port-to-port route before launch.
