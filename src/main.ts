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

type Label = 'TO_REVIEW' | 'TO_CHANGE' | 'TO_MERGE' | 'TO_REBASE'

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
        state,
        draft,
        mergeable_state: mergeableState,
        requested_reviewers: requestedReviewers,
        head: {ref}
      } = pushPayload.pull_request

      const content = `${number} ${title} ${body} ${ref}`
      core.info(content)
      core.info(extractStoryIds(content).join(','))

      core.info('Fetching PR')
      const {data: reviews} = await octokit.pulls.listReviews({
        owner,
        repo,
        pull_number: number
      })

      // const {
      //   repository: {
      //     pullRequest: {
      //       reviewDecision,
      //       state,
      //       isDraft,
      //       mergeable,
      //       reviewRequests: {nodes: requestedReviewers},
      //       reviews: {nodes: existingReviews}
      //     }
      //   }
      // } = await octokit.graphql(
      //   `
      //   query getReviewDecision($owner: String!, $repo: String!, $number: Int!) {
      //     repository(owner: $owner, name: $repo) {
      //       id
      //       pullRequest(number: $number) {
      //         state
      //         isDraft
      //         mergeable
      //         reviewRequests(last: 50) {
      //           nodes {
      //             requestedReviewer {
      //               ... on User {
      //                 login
      //               }
      //             }
      //           }
      //         }
      //         reviews(first: 100) {
      //           nodes {
      //             state
      //             author {
      //               login
      //             }
      //           }
      //         }
      //         reviewDecision
      //       }
      //     }
      //   }
      //   `,
      //   {
      //     owner,
      //     repo,
      //     number
      //   }
      // )
      // core.info(`reviewDecision: ${reviewDecision}`)

      core.info(
        `data : ${JSON.stringify({
          draft,
          mergeableState,
          state,
          requestedReviewers,
          reviews
        })}`
      )
      const reviewLabel = ((): Label | null => {
        if (draft || state !== 'open') {
          return null
        }

        if (
          reviews.find(review => {
            return (
              review.state === 'CHANGE_REQUESTED' &&
              !requestedReviewers.find(
                ({login}) => login === review.user?.login
              )
            )
          })
        ) {
          return 'TO_CHANGE'
        }

        if (requestedReviewers.length > 0) {
          return 'TO_REVIEW'
        }

        if (reviews.find(review => review.state === 'APPROVED')) {
          return 'TO_MERGE'
        }
        return null
      })()

      const mergeLabel = mergeableState === 'CONFLICTING' ? 'TO_REBASE' : null

      const labels = [reviewLabel, mergeLabel].filter(Boolean)

      core.info(`labels : ${JSON.stringify(labels)}`)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
