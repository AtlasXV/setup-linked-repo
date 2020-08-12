import * as core from '@actions/core'
import HTTP from '@actions/http-client'
import * as github from '@actions/github'
import * as gitAuthHelper from './git-auth-helper'
import * as gitCommandManager from './git-command-manager'
import {IGitCommandManager} from './git-command-manager'
import {IGitSourceSettings} from './git-source-settings'
import ifm from '@actions/http-client/interfaces'

interface LinkResult {
  token: string
}

export async function getSource(settings: IGitSourceSettings): Promise<void> {
  // Git command manager
  core.startGroup('Getting Git version info')
  const git = await getGitCommandManager()
  if (!git) {
    return
  }
  core.endGroup()
  core.startGroup('Setting up auth')

  const http = new HTTP.HttpClient()
  const linkedResp: ifm.ITypedResponse<LinkResult> = await http.postJson(
    `${settings.grantEndpoint}/${github.context.repo.owner}/${github.context.repo.repo}`,
    {
      owner: settings.linkedrepoOwner,
      repo: settings.linkedrepoName
    },
    {['authorization']: settings.repositoryToken}
  )
  let linkedToken
  if (linkedResp.result) {
    linkedToken = linkedResp.result.token
  } else {
    throw new Error('Empty Token')
  }

  // const linkedResp = await got.post(
  //   `${settings.grantEndpoint}/${github.context.repo.owner}/${github.context.repo.repo}`,
  //   {
  //     headers: {
  //       authorization: settings.repositoryToken
  //     },
  //     json: {
  //       owner: settings.linkedrepoOwner,
  //       repo: settings.linkedrepoName
  //     }
  //   }
  // )
  // const linkedToken = linkedResp.body
  core.setSecret(linkedToken)
  settings.linkedToken = linkedToken
  const authHelper = gitAuthHelper.createAuthHelper(git, settings)
  await authHelper.configureAuth()
  core.endGroup()
}

export async function cleanup(): Promise<void> {
  let git: IGitCommandManager
  try {
    git = await gitCommandManager.createCommandManager()
    const authHelper = gitAuthHelper.createAuthHelper(git)
    await authHelper.removeAuth()
  } catch {
    return
  }
}

async function getGitCommandManager(): Promise<IGitCommandManager | undefined> {
  try {
    return await gitCommandManager.createCommandManager()
  } catch (err) {
    // Otherwise fallback to REST API
    return undefined
  }
}
