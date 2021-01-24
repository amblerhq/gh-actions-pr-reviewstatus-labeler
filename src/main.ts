import * as core from '@actions/core'
import * as github from '@actions/github'
import {GetResponseDataTypeFromEndpointMethod} from '@octokit/types'

type PullRequest = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.get
>
type Reviews = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.listReviews
>
type RequestedReviewers = GetResponseDataTypeFromEndpointMethod<
  typeof octokit.pulls.listRequestedReviewers
>
type PRStatus = 'TO_REVIEW' | 'TO_CHANGE' | 'TO_MERGE' | 'TO_REBASE'
type Label = {name: string; color?: string}

const DEFAULT_LABEL_MAP: Record<PRStatus, Label> = {
  TO_REVIEW: {name: '🚦status:to-review', color: 'FBCA04'},
  TO_CHANGE: {name: '🚦status:to-change', color: 'C2E0C6'},
  TO_MERGE: {name: '🚦status:to-merge', color: '0E8A16'},
  TO_REBASE: {name: '🚦status:to-rebase', color: 'FBCA04'}
}

type LabelMap = typeof DEFAULT_LABEL_MAP

const token = core.getInput('GITHUB_TOKEN', {required: true})

if (!token) {
  core.setFailed('Missing GITHUB_TOKEN')
  process.exit(1)
}
const octokit = github.getOctokit(token)

const {owner, repo} = github.context.repo

async function run(): Promise<void> {
  try {
    const labelMap = DEFAULT_LABEL_MAP //TODO permit to override

    const pullRequest: PullRequest = await getPullRequest()

    const {
      number,
      state,
      draft,
      mergeable_state: mergeableState,
      labels: currentLabels
    } = pullRequest

    core.info('Fetching PR reviews and requestedReviewers')
    const reviews = await getUniqueReviews(number)
    const requestedReviewers = await getRequestReviewers(number)

    const computedLabels = getComputedLabels({
      draft,
      mergeableState,
      state,
      reviews,
      requestedReviewers,
      labelMap
    })

    const toAddLabels = getLabelsToAdd(currentLabels as Label[], computedLabels)

    const toRemoveLabels = getLabelsToRemove(
      currentLabels as Label[],
      computedLabels,
      labelMap
    )

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

async function getPullRequest(): Promise<PullRequest> {
  const {
    payload: {pull_request}
  } = github.context

  if (!pull_request) {
    throw new Error('Pull Request not found')
  }

  const pullRequestNumber = pull_request.number
  //* We can't use the event payload because some fields are missing for the pull_request_review event
  const {data: pullRequest} = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullRequestNumber
  })

  return pullRequest
}

async function getUniqueReviews(pullRequestNumber: number): Promise<Reviews> {
  const {data: reviews} = await octokit.pulls.listReviews({
    owner,
    repo,
    pull_number: pullRequestNumber
  })
  const uniqueByUserReviews: Reviews = []
  for (const review of reviews.reverse()) {
    if (
      !uniqueByUserReviews.find(
        uniqueReview =>
          review.user && uniqueReview.user?.login === review.user.login
      )
    ) {
      uniqueByUserReviews.push(review)
    }
  }
  return uniqueByUserReviews
}

async function getRequestReviewers(
  pullRequestNumber: number
): Promise<RequestedReviewers> {
  const {data: requestedReviewers} = await octokit.pulls.listRequestedReviewers(
    {
      owner,
      repo,
      pull_number: pullRequestNumber
    }
  )
  return requestedReviewers
}

function getComputedLabels({
  reviews,
  requestedReviewers,
  draft,
  state,
  mergeableState,
  labelMap
}: {
  reviews: Reviews
  requestedReviewers: RequestedReviewers
  draft?: boolean
  state: string
  mergeableState: string
  labelMap: LabelMap
}): Label[] {
  const reviewStatus = ((): PRStatus | null => {
    if (draft || state !== 'open') {
      return null
    }

    if (
      reviews.find(review => {
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

    if (reviews.find(review => review.state === 'APPROVED')) {
      return 'TO_MERGE'
    }
    return null
  })()

  const mergeStatus: PRStatus | null =
    mergeableState === 'CONFLICTING' ? 'TO_REBASE' : null

  const computedStatuses: PRStatus[] = [reviewStatus, mergeStatus].filter(
    status => status !== null
  ) as PRStatus[]
  core.info(`Computed statuses : ${computedStatuses.join(',')}`)

  const computedLabels = computedStatuses
    .map(status => labelMap[status])
    .filter(Boolean)

  return computedLabels
}

function getLabelsToAdd(
  currentLabels: Label[],
  computedLabels: Label[]
): Label[] {
  const toAddLabels = []
  for (const computedLabel of computedLabels) {
    if (!computedLabel) {
      continue
    }
    if (!currentLabels.find(label_ => label_.name === computedLabel.name)) {
      toAddLabels.push(computedLabel)
    }
  }
  return toAddLabels
}

function getLabelsToRemove(
  currentLabels: Label[],
  computedLabels: Label[],
  labelMap: LabelMap
): Label[] {
  const toRemoveLabels: Label[] = []
  const mappedLabels = Object.values(labelMap)
  const currentSyncedLabels = currentLabels.filter(currentLabel =>
    mappedLabels.find(mappedLabel => mappedLabel?.name === currentLabel.name)
  )
  for (const currentLabel of currentSyncedLabels) {
    if (!computedLabels.find(label_ => label_?.name === currentLabel.name)) {
      toRemoveLabels.push(currentLabel) // name property is optional
    }
  }
  return toRemoveLabels
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

run()
