# Deployment

## Supported V1 topology

Use one Node.js process, one persistent local filesystem, and one researcher or tightly controlled evaluation group.

Required runtime properties:

- Node.js 22.19+;
- outbound HTTPS access to NCBI E-utilities;
- a writable persistent directory for `RESEARCH_WORKBENCH_DATA_DIR`;
- TLS termination at the platform or reverse proxy;
- authentication before the application when reachable from the internet.

## Build and start

```bash
npm ci
npm run build
RESEARCH_WORKBENCH_HOST=0.0.0.0 PORT=10000 npm start
```

The server honors `PORT`, which is required by most application hosts.

## Private evaluation authentication

Set both values through the host's secret manager:

```text
RESEARCH_WORKBENCH_AUTH_USERNAME
RESEARCH_WORKBENCH_AUTH_PASSWORD
```

The health endpoint remains unauthenticated for platform checks. All UI, project, decision, and export routes require HTTP Basic Auth.

Basic Auth is only an alpha deployment boundary. Use a TLS-enabled host and never place credentials in Git, build arguments, logs, or screenshots.

## Persistent data

Mount a persistent disk and point the service at it:

```text
RESEARCH_WORKBENCH_DATA_DIR=/var/data/research-workbench
```

Back up the entire directory atomically. It contains project event chains, immutable artifacts, Agent lifecycle logs, and snapshots that must remain mutually consistent.

## Docker

```bash
docker build -t research-workbench:0.1.0 .
docker run --rm -p 5177:5177 \
  -e RESEARCH_WORKBENCH_HOST=0.0.0.0 \
  -e RESEARCH_WORKBENCH_AUTH_USERNAME=researcher \
  -e RESEARCH_WORKBENCH_AUTH_PASSWORD='replace-me' \
  -v research-workbench-data:/app/.research-workbench-data \
  research-workbench:0.1.0
```

## Not supported yet

- anonymous public shared instances;
- multiple application replicas writing one local data directory;
- stateless/serverless filesystems;
- browser-only static hosting such as GitHub Pages;
- unattended production use without backups and access controls.
