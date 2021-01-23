import * as core from '@actions/core'
import * as github from '@actions/github'

const token = core.getInput('GITHUB_TOKEN', {required: true})

if (!token) {
  core.setFailed('Missing GITHUB_TOKEN')
  process.exit(1)
}
const octokit = github.getOctokit(token)

const {owner, repo} = github.context.repo

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

type PRStatus = 'TO_REVIEW' | 'TO_CHANGE' | 'TO_MERGE' | 'TO_REBASE' | 'OTHER'
type Label = {name: string; color?: string}

const defaultLabelMap: Record<PRStatus, Label | null> = {
  TO_REVIEW: {name: '🚦status:to-review', color: 'FBCA04'},
  TO_CHANGE: {name: '🚦status:to-change', color: 'C2E0C6'},
  TO_MERGE: {name: '🚦status:to-merge', color: '0E8A16'},
  TO_REBASE: {name: '🚦status:to-rebase', color: 'FBCA04'},
  OTHER: null
}

async function addLabels(prNumber: number, labels: Label[]): Promise<void> {
  //* Create label if needed
  const {data: existingLabels} = await octokit.issues.listLabelsForRepo({
    owner,
    repo
  })
  for (const label of labels) {
    const remoteLabel = existingLabels.find(
      label_ => label.name === label_.name
    )
    if (!remoteLabel) {
      const response = await octokit.issues.createLabel({
        owner,
        repo,
        name: label.name,
        color: label.color
      })
      core.info(JSON.stringify(response))
    }
  }

  await octokit.issues.addLabels({
    owner,
    repo,
    issue_number: prNumber,
    labels: labels.map(label => label.name)
  })
}

async function removeLabels(prNumber: number, labels: Label[]): Promise<void> {
  await Promise.all(
    labels.map(async label =>
      octokit.issues.removeLabel({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: prNumber,
        name: label.name
      })
    )
  )
}

async function run(): Promise<void> {
  try {
    const {
      payload: {pull_request}
    } = github.context

    if (!pull_request) {
      return
    }

    const pullRequestNumber = pull_request.number
    //* We can't use the event payload because some fields are missing for the pull_request_review event
    const {data: pullRequest} = await octokit.pulls.get({
      owner,
      repo,
      pull_number: pullRequestNumber
    })

    const {
      number,
      title,
      body,
      state,
      draft,
      mergeable_state: mergeableState,
      labels: currentLabels,
      head: {ref}
    } = pullRequest

    const content = `${number} ${title} ${body} ${ref}`
    core.info(content)
    core.info(extractStoryIds(content).join(','))

    core.info('Fetching PR reviews and requestedReviewers')
    const {data: reviews} = await octokit.pulls.listReviews({
      owner,
      repo,
      pull_number: number
    })
    const uniqueByUserReviews: typeof reviews = []
    for (const review of reviews.reverse()) {
      if (
        !uniqueByUserReviews.find(
          uniqueReview => uniqueReview.user?.login === review.user?.login
        )
      ) {
        uniqueByUserReviews.push(review)
      }
    }

    const {
      data: requestedReviewers
    } = await octokit.pulls.listRequestedReviewers({
      owner,
      repo,
      pull_number: number
    })

    core.info(
      `data : ${JSON.stringify({
        draft,
        mergeableState,
        state,
        requestedReviewers,
        reviews,
        uniqueByUserReviews
      })}`
    )
    const reviewStatus: PRStatus = ((): PRStatus => {
      if (draft || state !== 'open') {
        return 'OTHER'
      }

      if (
        uniqueByUserReviews.find(review => {
          return (
            review.state === 'CHANGES_REQUESTED' &&
            !requestedReviewers.users.find(
              ({login}) => login === review.user?.login
            )
          )
        })
      ) {
        return 'TO_CHANGE'
      }

      if (
        requestedReviewers.users.length > 0 ||
        requestedReviewers.teams.length > 0
      ) {
        return 'TO_REVIEW'
      }

      if (uniqueByUserReviews.find(review => review.state === 'APPROVED')) {
        return 'TO_MERGE'
      }
      return 'OTHER'
    })()

    const mergeStatus: PRStatus =
      mergeableState === 'CONFLICTING' ? 'TO_REBASE' : 'OTHER'

    const computedStatuses: PRStatus[] = [reviewStatus, mergeStatus].filter(
      status => status !== 'OTHER'
    )
    core.info(`Computed statuses : ${computedStatuses.join(',')}`)

    const labelMap = defaultLabelMap
    const computedLabels = computedStatuses
      .map(status => labelMap[status])
      .filter(Boolean)

    const toAddLabels: Label[] = []
    for (const computedLabel of computedLabels) {
      if (!computedLabel) {
        continue
      }
      if (!currentLabels.find(label_ => label_.name === computedLabel.name)) {
        toAddLabels.push(computedLabel)
      }
    }

    core.info(
      `Current labels : ${
        currentLabels.map(label => label.name).join(',') || 'none'
      }`
    )
    const toRemoveLabels: Label[] = []
    const mappedLabels = Object.values(labelMap)
    const currentSyncedLabels = currentLabels.filter(currentLabel =>
      mappedLabels.find(mappedLabel => mappedLabel?.name === currentLabel.name)
    )
    for (const currentLabel of currentSyncedLabels) {
      if (!computedLabels.find(label_ => label_?.name === currentLabel.name)) {
        toRemoveLabels.push(currentLabel as Label) // name property is optional
      }
    }

    if (toAddLabels.length > 0) {
      core.info(
        `Adding labels : ${toAddLabels.map(label => label.name).join(',')}`
      )
      await addLabels(number, toAddLabels)
    }

    if (toRemoveLabels.length > 0) {
      core.info(
        `Removing labels : ${toRemoveLabels.map(label => label.name).join(',')}`
      )
      await removeLabels(number, toRemoveLabels)
    }
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
