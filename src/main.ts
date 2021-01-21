import * as core from '@actions/core'
import * as github from '@actions/github'
import * as Webhooks from '@octokit/webhooks'
import {Octokit} from '@octokit/action'

const octokit = new Octokit()

if (!process.env.GITHUB_REPOSITORY) {
  process.exit(1)
}

const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

// const Clubhouse = require('clubhouse-lib');

// const clubhouseToken = process.env.INPUT_CLUBHOUSETOKEN;
// const client = Clubhouse.create(clubhouseToken);

/**
 * Finds all clubhouse story IDs in some string content.
 *
 * @param {string} content - content that may contain story IDs.
 * @return {Array} - Clubhouse story IDs 1-7 digit strings.
 */

function extractStoryIds(content: string): string[] {
  const regex = /(?<=ch)\d{1,7}/g
  const all = content.match(regex)
  const unique = [...new Set(all)]
  return unique
}

async function run(): Promise<void> {
  try {
    const {eventName} = github.context

    if (eventName === 'pull_request') {
      const pushPayload = github.context
        .payload as Webhooks.EventPayloads.WebhookPayloadPullRequest
      const {
        number,
        title,
        body,
        head: {ref}
      } = pushPayload.pull_request

      const content = `${number} ${title} ${body} ${ref}`
      core.info(content)
      core.info(extractStoryIds(content).join(','))

      core.info('Fetching PR reviewDecision')
      const {
        repository: {
          pullRequest: {reviewDecision}
        }
      } = await octokit.graphql(
        `
        query getReviewDecision($owner: String!, $repo: String!, $number: Int!) {
          repository(owner: $owner, name: $repo) {
            id
            pullRequest(number: $number) {
              reviewDecision
            }
          }
        }
        `,
        {
          owner,
          repo,
          number
        }
      )
      core.info(`reviewDecision: ${reviewDecision}`)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
