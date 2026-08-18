const WARNING_MARKER = '<!-- windup-pr-missing-issue -->'
const RESOLVED_WARNING_MARKER = '<!-- windup-pr-missing-issue-resolved -->'

function isMissingIssueWarning(comment) {
  return comment.body?.includes(WARNING_MARKER) && !comment.body.includes(RESOLVED_WARNING_MARKER)
}

async function checkPullRequestIssue({ github, context, core }) {
  const pullRequest = context.payload.pull_request
  const { owner, repo } = context.repo

  const result = await github.graphql(
    `query PullRequestClosingIssues($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $number) {
          closingIssuesReferences(first: 1) {
            totalCount
          }
        }
      }
    }`,
    { owner, repo, number: pullRequest.number },
  )

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullRequest.number,
    per_page: 100,
  })

  if (result.repository.pullRequest.closingIssuesReferences.totalCount > 0) {
    const warning = comments.find(isMissingIssueWarning)

    if (warning) {
      await github.rest.issues.updateComment({
        owner,
        repo,
        comment_id: warning.id,
        body: `${RESOLVED_WARNING_MARKER}\n✅ 此 PR 已关联 issue，之前的提醒已自动标记为已解决。`,
      })
      core.info('Resolved stale missing-issue warning.')
    }

    core.info('Pull request is linked to an issue.')
    return
  }

  if (comments.some(isMissingIssueWarning)) {
    core.info('Missing-issue warning has already been posted.')
    return
  }

  await github.rest.issues.createComment({
    owner,
    repo,
    issue_number: pullRequest.number,
    body: `${WARNING_MARKER}\n⚠️ @${pullRequest.user.login}，此 PR 尚未关联 issue。请在 PR 描述中使用 \`Closes #123\` 等关闭关键字，或通过 Development 侧栏关联对应 issue。`,
  })

  core.warning('Pull request is not linked to an issue; posted an author warning.')
}

module.exports = checkPullRequestIssue
module.exports.WARNING_MARKER = WARNING_MARKER
module.exports.RESOLVED_WARNING_MARKER = RESOLVED_WARNING_MARKER
