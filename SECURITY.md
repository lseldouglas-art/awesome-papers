# Security Policy

## Supported versions

Only the latest tagged alpha receives security fixes.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** private reporting flow for this repository. Do not open a public issue containing credentials, private research content, unpublished manuscripts, personal data, or a working exploit.

Please include:

- affected version and deployment topology;
- reproduction steps with synthetic data;
- expected and observed authority boundary;
- possible exposure or mutation of research records;
- any suggested mitigation.

## V1 threat boundary

The local alpha assumes one trusted researcher and one trusted machine. Optional HTTP Basic Auth is suitable only for a TLS-protected private evaluation. It is not multi-user authorization.

Do not deploy V1 as an anonymous shared public service. All visitors would otherwise operate inside one project namespace and could observe or mutate the same research state.

## Sensitive data

Never commit or attach:

- `.env` files or provider credentials;
- the `.research-workbench-data/` directory;
- unpublished manuscripts or identifiable participant data;
- paid or access-controlled full text;
- NCBI, model-provider, or hosting access tokens.

The repository's examples and tests must use public, synthetic, or explicitly redistributable material.
