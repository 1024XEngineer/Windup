const assert = require('node:assert/strict')
const test = require('node:test')

const checkPullRequestIssue = require('./check-pr-issue.cjs')
const { WARNING_MARKER } = checkPullRequestIssue

function createContext() {
  return {
    repo: { owner: 'owner', repo: 'repo' },
    payload: {
      pull_request: {
        number: 42,
        user: { login: 'octocat' },
      },
    },
  }
}

test('does not comment when the pull request closes an issue', async () => {
  const github = {
    graphql: async () => ({
      repository: {
        pullRequest: { closingIssuesReferences: { totalCount: 1 } },
      },
    }),
    paginate: async () => {
      throw new Error('comments should not be queried')
    },
    rest: {
      issues: {
        listComments: () => {},
        createComment: async () => {
          throw new Error('comment should not be created')
        },
      },
    },
  }

  await checkPullRequestIssue({
    github,
    context: createContext(),
    core: { info: () => {}, warning: () => {} },
  })
})

test('warns and mentions the author when no issue is linked', async () => {
  const calls = []
  const github = {
    graphql: async (query, variables) => {
      assert.match(query, /closingIssuesReferences/)
      assert.deepEqual(variables, { owner: 'owner', repo: 'repo', number: 42 })
      return {
        repository: {
          pullRequest: { closingIssuesReferences: { totalCount: 0 } },
        },
      }
    },
    paginate: async (method, input) => {
      assert.equal(method, github.rest.issues.listComments)
      assert.deepEqual(input, {
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        per_page: 100,
      })
      return []
    },
    rest: {
      issues: {
        listComments: () => {},
        createComment: async (input) => calls.push(input),
      },
    },
  }

  await checkPullRequestIssue({
    github,
    context: createContext(),
    core: { info: () => {}, warning: () => {} },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    owner: 'owner',
    repo: 'repo',
    issue_number: 42,
    body: `${WARNING_MARKER}\n⚠️ @octocat，此 PR 尚未关联 issue。请在 PR 描述中使用 \`Closes #123\` 等关闭关键字，或通过 Development 侧栏关联对应 issue。`,
  })
})

test('does not post a duplicate warning', async () => {
  const github = {
    graphql: async () => ({
      repository: {
        pullRequest: { closingIssuesReferences: { totalCount: 0 } },
      },
    }),
    paginate: async () => [{ body: `${WARNING_MARKER}\nExisting warning` }],
    rest: {
      issues: {
        listComments: () => {},
        createComment: async () => {
          throw new Error('duplicate comment should not be created')
        },
      },
    },
  }

  await checkPullRequestIssue({
    github,
    context: createContext(),
    core: { info: () => {}, warning: () => {} },
  })
})
