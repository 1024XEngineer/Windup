const TITLE_RULES = [
  {
    pattern: /^\s*(?:\[bug\]|bug(?:fix)?|fix)(?:\([^)]*\))?\s*[:：-]/i,
    label: 'bug',
    issueType: 'Bug',
  },
  {
    pattern: /^\s*(?:\[feature\]|feat(?:ure)?)(?:\([^)]*\))?\s*[:：-]/i,
    label: 'enhancement',
    issueType: 'Feature',
  },
]

function classifyIssue(title, labelNames = []) {
  const normalizedLabels = new Set(labelNames.map((label) => label.toLowerCase()))

  if (normalizedLabels.has('bug')) {
    return { label: null, issueType: 'Bug' }
  }

  if (normalizedLabels.has('enhancement')) {
    return { label: null, issueType: 'Feature' }
  }

  const rule = TITLE_RULES.find(({ pattern }) => pattern.test(title))
  if (rule) {
    return {
      label: normalizedLabels.has(rule.label) ? null : rule.label,
      issueType: rule.issueType,
    }
  }

  return { label: null, issueType: 'Task' }
}

function selectMilestone(milestones, createdAt) {
  const createdDate = createdAt.slice(0, 10)

  return [...milestones]
    .filter((milestone) => !milestone.due_on || milestone.due_on.slice(0, 10) >= createdDate)
    .sort((left, right) => {
      if (!left.due_on && !right.due_on) {
        return Date.parse(right.created_at) - Date.parse(left.created_at)
      }
      if (!left.due_on) return 1
      if (!right.due_on) return -1
      return Date.parse(left.due_on) - Date.parse(right.due_on)
    })[0]
}

async function triageIssue({ github, context, core }) {
  const issue = context.payload.issue
  const { owner, repo } = context.repo
  const labelNames = issue.labels.map((label) => (typeof label === 'string' ? label : label.name))
  const classification = classifyIssue(issue.title, labelNames)
  const updates = []

  if (!issue.milestone) {
    const milestones = await github.paginate(github.rest.issues.listMilestones, {
      owner,
      repo,
      state: 'open',
      per_page: 100,
    })
    const milestone = selectMilestone(milestones, issue.created_at)

    if (milestone) {
      await github.rest.issues.update({
        owner,
        repo,
        issue_number: issue.number,
        milestone: milestone.number,
      })
      updates.push(`milestone=${milestone.title}`)
    } else {
      core.info('No current open milestone found; leaving milestone unchanged.')
    }
  }

  if (classification.label) {
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issue.number,
      labels: [classification.label],
    })
    updates.push(`label=${classification.label}`)
  }

  const metadata = await github.graphql(
    `query IssueTriageMetadata($owner: String!, $repo: String!, $number: Int!) {
      repository(owner: $owner, name: $repo) {
        issue(number: $number) {
          id
          issueType { id name }
        }
        issueTypes(first: 20) {
          nodes { id name isEnabled }
        }
      }
    }`,
    { owner, repo, number: issue.number },
  )

  const repository = metadata.repository
  if (!repository.issue.issueType) {
    const desiredType = repository.issueTypes.nodes.find(
      (issueType) =>
        issueType.isEnabled && issueType.name.toLowerCase() === classification.issueType.toLowerCase(),
    )

    if (desiredType) {
      await github.graphql(
        `mutation SetIssueType($issueId: ID!, $issueTypeId: ID!) {
          updateIssue(input: { id: $issueId, issueTypeId: $issueTypeId }) {
            issue { id }
          }
        }`,
        { issueId: repository.issue.id, issueTypeId: desiredType.id },
      )
      updates.push(`type=${desiredType.name}`)
    } else {
      core.warning(`Enabled issue type "${classification.issueType}" is unavailable.`)
    }
  }

  core.info(updates.length > 0 ? `Applied ${updates.join(', ')}.` : 'Issue metadata is already set.')
}

module.exports = triageIssue
module.exports.classifyIssue = classifyIssue
module.exports.selectMilestone = selectMilestone
