const WARNING_MARKER = '<!-- windup-pr-missing-issue -->'

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

  if (result.repository.pullRequest.closingIssuesReferences.totalCount > 0) {
    core.info('Pull request is linked to an issue.')
    return
  }

  const comments = await github.paginate(github.rest.issues.listComments, {
    owner,
    repo,
    issue_number: pullRequest.number,
    per_page: 100,
  })

  if (comments.some((comment) => comment.body?.includes(WARNING_MARKER))) {
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
