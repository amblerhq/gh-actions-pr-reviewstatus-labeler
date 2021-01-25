# Pull Request Review Status Labeler

A Github Action to add/remove labels on Pull Request based on its review status

[![CI status](https://github.com/actions/typescript-action/workflows/build-test/badge.svg)](https://github.com/actions/gh-actions-pr-reviewstatus-labeler/actions)
[![Conventional Commits](https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg)](https://conventionalcommits.org)

## Usage

### Create Workflow

Create a workflow (eg: `.github/workflows/labeler.yml` see [Creating a Workflow file](https://help.github.com/en/articles/configuring-a-workflow#creating-a-workflow-file)) to utilize the labeler action with content:

```
name: "Pull Request Review Status Labeler"
on:
  pull_request:
    types:
      [
        opened,
        synchronize,
        reopened,
        ready_for_review,
        review_requested,
        review_request_removed,
        closed
      ]
  pull_request_review:

jobs:
  build:
    strategy:
      max-parallel: 1
    runs-on: ubuntu-latest
    steps:
      - uses: amblerhq/gh-actions-pr-reviewstatus-labeler@v1
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

_Note: This grants access to the `GITHUB_TOKEN` so the action can make calls to GitHub's rest API_
