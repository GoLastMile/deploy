# LastMile Deploy Action

Deploy to production with automatic error fixing.

## Usage

```yaml
name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: write  # Required to commit fixes
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # Needed to read retry metadata from commits

      - uses: lastmile-code/deploy@v1
        with:
          api-key: ${{ secrets.LASTMILE_API_KEY }}
          max-attempts: 5
```

## How It Works

1. **Deploy**: Triggers deployment to Railway (via Railway's GitHub integration)
2. **On failure**: Calls LastMile API to analyze logs and generate a fix
3. **Apply fix**: Commits the fix and pushes
4. **Retry**: The push triggers a new workflow run automatically
5. **Repeat**: Until success or max attempts reached

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | - | Your LastMile API key |
| `max-attempts` | No | `5` | Maximum retry attempts |
| `railway-token` | No | - | Railway API token (optional, for status checking) |

## Outputs

| Output | Description |
|--------|-------------|
| `url` | Deployed application URL (on success) |
| `status` | Final status: `success`, `failed`, or `retrying` |
| `attempt` | Number of attempts made |

## Retry Tracking

The action tracks retry attempts via commit message metadata:

```
fix: add missing lodash dependency

[lastmile:attempt=2,max=5]
```

This prevents infinite loops if a fix doesn't work.

## Setup

1. Get your API key from [lastmile.sh/settings](https://lastmile.sh/settings)
2. Add `LASTMILE_API_KEY` to your repository secrets
3. Add the workflow file to `.github/workflows/deploy.yml`
4. Push to main to trigger deployment

## Requirements

- Railway GitHub integration configured (auto-deploys on push)
- LastMile account with API key
- Repository write permissions (for committing fixes)

## License

MIT
