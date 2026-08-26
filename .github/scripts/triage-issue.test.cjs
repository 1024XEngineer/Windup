const assert = require('node:assert/strict')
const test = require('node:test')

const triageIssue = require('./triage-issue.cjs')
const { classifyIssue, selectMilestone } = triageIssue

test('classifies conventional bug and feature titles', () => {
  assert.deepEqual(classifyIssue('[Bug]: broken login'), { label: 'bug', issueType: 'Bug' })
  assert.deepEqual(classifyIssue('feat(editor): add onion skinning'), {
    label: 'enhancement',
    issueType: 'Feature',
  })
})

test('uses existing classification labels without adding another label', () => {
  assert.deepEqual(classifyIssue('login is broken', ['P0', 'bug']), {
    label: null,
    issueType: 'Bug',
  })
})

test('adds the classification label while preserving unrelated labels', () => {
  assert.deepEqual(classifyIssue('[Bug]: broken login', ['P0', 'MiniSpec']), {
    label: 'bug',
    issueType: 'Bug',
  })
})

test('defaults unclassified issues to Task', () => {
  assert.deepEqual(classifyIssue('issue 关联 milestone'), { label: null, issueType: 'Task' })
})

test('selects the nearest open milestone whose due date includes the issue date', () => {
  const milestone = selectMilestone(
    [
      { number: 5, due_on: '2026-09-01T00:00:00Z', created_at: '2026-08-10T00:00:00Z' },
      { number: 4, due_on: '2026-08-14T00:00:00Z', created_at: '2026-08-04T00:00:00Z' },
      { number: 3, due_on: '2026-08-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' },
    ],
    '2026-08-13T12:00:00Z',
  )

  assert.equal(milestone.number, 4)
})

test('leaves fields already associated untouched', async () => {
  const calls = []
  const github = {
    paginate: async () => {
      throw new Error('milestones should not be queried')
    },
    rest: {
      issues: {
        listMilestones: () => {},
        update: async () => calls.push('update'),
        addLabels: async () => calls.push('addLabels'),
      },
    },
    graphql: async () => ({
      repository: {
        issue: { id: 'issue-id', issueType: { id: 'type-id', name: 'Bug' } },
        issueTypes: { nodes: [] },
      },
    }),
  }

  await triageIssue({
    github,
    context: {
      repo: { owner: 'owner', repo: 'repo' },
      payload: {
        issue: {
          number: 1,
          title: '[Bug]: broken',
          created_at: '2026-08-13T00:00:00Z',
          labels: [{ name: 'bug' }],
          milestone: { number: 4 },
        },
      },
    },
    core: { info: () => {}, warning: () => {} },
  })

  assert.deepEqual(calls, [])
})

test('associates every missing field for a classified issue', async () => {
  const calls = []
  const github = {
    paginate: async () => [
      {
        number: 4,
        title: 'MS3',
        due_on: '2026-08-14T00:00:00Z',
        created_at: '2026-08-04T00:00:00Z',
      },
    ],
    rest: {
      issues: {
        listMilestones: () => {},
        update: async (input) => calls.push(['update', input]),
        addLabels: async (input) => calls.push(['addLabels', input]),
      },
    },
    graphql: async (query, variables) => {
      if (query.includes('query IssueTriageMetadata')) {
        return {
          repository: {
            issue: { id: 'issue-id', issueType: null },
            issueTypes: {
              nodes: [{ id: 'bug-type-id', name: 'Bug', isEnabled: true }],
            },
          },
        }
      }
      calls.push(['setIssueType', variables])
      return { updateIssue: { issue: { id: 'issue-id' } } }
    },
  }

  await triageIssue({
    github,
    context: {
      repo: { owner: 'owner', repo: 'repo' },
      payload: {
        issue: {
          number: 7,
          title: '[Bug]: broken',
          created_at: '2026-08-13T00:00:00Z',
          labels: [],
          milestone: null,
        },
      },
    },
    core: { info: () => {}, warning: () => {} },
  })

  assert.deepEqual(calls, [
    [
      'update',
      { owner: 'owner', repo: 'repo', issue_number: 7, milestone: 4 },
    ],
    [
      'addLabels',
      { owner: 'owner', repo: 'repo', issue_number: 7, labels: ['bug'] },
    ],
    ['setIssueType', { issueId: 'issue-id', issueTypeId: 'bug-type-id' }],
  ])
})
