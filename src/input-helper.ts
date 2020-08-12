import * as core from '@actions/core'
import {IGitSourceSettings} from './git-source-settings'

export function getInputs(): IGitSourceSettings {
  const result = ({} as unknown) as IGitSourceSettings

  // GitHub workspace
  const githubWorkspacePath = process.env['GITHUB_WORKSPACE']
  if (!githubWorkspacePath) {
    throw new Error('GITHUB_WORKSPACE not defined')
  }
  // Qualified repository
  const qualifiedRepository = core.getInput('linked_repository')
  core.debug(`qualified repository = '${qualifiedRepository}'`)
  const splitRepository = qualifiedRepository.split('/')
  if (
    splitRepository.length !== 2 ||
    !splitRepository[0] ||
    !splitRepository[1]
  ) {
    throw new Error(
      `Invalid repository '${qualifiedRepository}'. Expected format {owner}/{repo}.`
    )
  }
  result.linkedrepoOwner = splitRepository[0]
  result.linkedrepoName = splitRepository[1]
  result.repositoryToken = core.getInput('token', {required: true})
  result.grantEndpoint = core.getInput('grant_endpoint', {required: true})
  return result
}
