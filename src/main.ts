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

//type Label = 'TO_REVIEW' | 'TO_CHANGE' | 'TO_MERGE' | 'TO_REBASE'

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
        data: {draft, mergeable, state}
      } = await octokit.pulls.get({owner, repo, pull_number: number})
      const {data: reviewRequests} = await octokit.pulls.listRequestedReviewers(
        {
          owner,
          repo,
          pull_number: number
        }
      )
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

      // const validLabels: Label[] = (() => {
      //   if (isDraft || state !== 'OPEN') {
      //     return []
      //   }
      //   const labels: Label[] = []
      //   if (mergeable === 'CONFLICTING') {
      //     labels.push('TO_REBASE')
      //   }

      //   if (reviewDecision === 'REVIEW_REQUIRED') {
      //     if (reviewRequests.length > O) {
      //       labels.push('TO_REVIEW')
      //     }
      //   } else if (reviewDecision === 'CHANGES_REQUESTED') {
      //     if (existingReviews.find(review => )
      //   } else if (reviewDecision === 'APPROVED') {
      //   }
      //   return labels
      // })()
      //core.info(`validLabels : ${JSON.stringify(validLabels)}`)
      core.info(
        `data : ${JSON.stringify({
          draft,
          mergeable,
          state,
          reviewRequests,
          reviews
        })}`
      )
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()

// CHANGES_REQUESTED
//   reviews(CHANGES_REQUESTED).filter(hasNoReviewRequests) > 0 : changeRequested : waitingReview

// APPROVED
//   reviewRequests.length > O ? waitingReview : readyToMerge
