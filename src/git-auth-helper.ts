import * as assert from 'assert'
import * as core from '@actions/core'
import * as fs from 'fs'
import * as io from '@actions/io'
import * as os from 'os'
import * as path from 'path'
import * as urlHelper from './url-helper'
import {default as uuid} from 'uuid/v4'
import {IGitCommandManager} from './git-command-manager'
import {IGitSourceSettings} from './git-source-settings'

export interface IGitAuthHelper {
  configureAuth(): Promise<void>
  configureGlobalAuth(): Promise<void>
  removeAuth(): Promise<void>
  removeGlobalAuth(): Promise<void>
}

export function createAuthHelper(
  git: IGitCommandManager,
  settings?: IGitSourceSettings
): IGitAuthHelper {
  return new GitAuthHelper(git, settings)
}

class GitAuthHelper {
  private readonly git: IGitCommandManager
  private readonly settings: IGitSourceSettings
  private readonly tokenConfigKey: string
  private readonly tokenConfigValue: string
  private readonly tokenPlaceholderConfigValue: string
  private readonly insteadOfKey: string
  private readonly insteadOfValue: string
  private temporaryHomePath = ''

  constructor(
    gitCommandManager: IGitCommandManager,
    gitSourceSettings?: IGitSourceSettings
  ) {
    this.git = gitCommandManager
    this.settings = gitSourceSettings || (({} as unknown) as IGitSourceSettings)

    // Token auth header
    const serverUrl = urlHelper.getServerUrl()
    this.tokenConfigKey = `http.${serverUrl.origin}/.extraheader` // "origin" is SCHEME://HOSTNAME[:PORT]
    const basicCredential = Buffer.from(
      `x-access-token:${this.settings.linkedToken}`,
      'utf8'
    ).toString('base64')
    core.setSecret(basicCredential)
    this.tokenPlaceholderConfigValue = `AUTHORIZATION: basic ***`
    this.tokenConfigValue = `AUTHORIZATION: basic ${basicCredential}`

    // Instead of SSH URL
    this.insteadOfKey = `url.${serverUrl.origin}/.insteadOf` // "origin" is SCHEME://HOSTNAME[:PORT]
    this.insteadOfValue = `git@${serverUrl.hostname}:`
  }

  async configureAuth(): Promise<void> {
    // Remove possible previous values
    await this.removeAuth()

    const gitConfigPath = path.join(
      process.env['HOME'] || os.homedir(),
      '.gitconfig'
    )
    // Configure new values
    await this.configureToken(gitConfigPath, true)
  }

  async configureGlobalAuth(): Promise<void> {
    // Create a temp home directory
    const runnerTemp = process.env['RUNNER_TEMP'] || ''
    assert.ok(runnerTemp, 'RUNNER_TEMP is not defined')
    const uniqueId = uuid()
    this.temporaryHomePath = path.join(runnerTemp, uniqueId)
    await fs.promises.mkdir(this.temporaryHomePath, {recursive: true})

    // Copy the global git config
    const gitConfigPath = path.join(
      process.env['HOME'] || os.homedir(),
      '.gitconfig'
    )
    const newGitConfigPath = path.join(this.temporaryHomePath, '.gitconfig')
    let configExists = false
    try {
      await fs.promises.stat(gitConfigPath)
      configExists = true
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err
      }
    }
    if (configExists) {
      core.info(`Copying '${gitConfigPath}' to '${newGitConfigPath}'`)
      await io.cp(gitConfigPath, newGitConfigPath)
    } else {
      await fs.promises.writeFile(newGitConfigPath, '')
    }

    try {
      // Override HOME
      core.info(
        `Temporarily overriding HOME='${this.temporaryHomePath}' before making global git config changes`
      )
      this.git.setEnvironmentVariable('HOME', this.temporaryHomePath)

      // Configure the token
      await this.configureToken(newGitConfigPath, true)

      // Configure HTTPS instead of SSH
      await this.git.tryConfigUnset(this.insteadOfKey, true)
      await this.git.config(this.insteadOfKey, this.insteadOfValue, true)
    } catch (err) {
      // Unset in case somehow written to the real global config
      core.info(
        'Encountered an error when attempting to configure token. Attempting unconfigure.'
      )
      await this.git.tryConfigUnset(this.tokenConfigKey, true)
      throw err
    }
  }

  async removeAuth(): Promise<void> {
    await this.removeToken()
  }

  async removeGlobalAuth(): Promise<void> {
    core.debug(`Unsetting HOME override`)
    this.git.removeEnvironmentVariable('HOME')
    await io.rmRF(this.temporaryHomePath)
  }

  private async configureToken(
    configPath?: string,
    globalConfig?: boolean
  ): Promise<void> {
    // Validate args
    assert.ok(
      (configPath && globalConfig) || (!configPath && !globalConfig),
      'Unexpected configureToken parameter combinations'
    )

    // Default config path
    if (!configPath && !globalConfig) {
      configPath = path.join(this.settings.defaultWD, '.git', 'config')
    }

    // Configure a placeholder value. This approach avoids the credential being captured
    // by process creation audit events, which are commonly logged. For more information,
    // refer to https://docs.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/command-line-process-auditing
    await this.git.config(
      this.tokenConfigKey,
      this.tokenPlaceholderConfigValue,
      globalConfig
    )

    // Replace the placeholder
    await this.replaceTokenPlaceholder(configPath || '')
  }

  private async replaceTokenPlaceholder(configPath: string): Promise<void> {
    assert.ok(configPath, 'configPath is not defined')
    let content = (await fs.promises.readFile(configPath)).toString()
    const placeholderIndex = content.indexOf(this.tokenPlaceholderConfigValue)
    if (
      placeholderIndex < 0 ||
      placeholderIndex != content.lastIndexOf(this.tokenPlaceholderConfigValue)
    ) {
      throw new Error(`Unable to replace auth placeholder in ${configPath}`)
    }
    assert.ok(this.tokenConfigValue, 'tokenConfigValue is not defined')
    content = content.replace(
      this.tokenPlaceholderConfigValue,
      this.tokenConfigValue
    )
    await fs.promises.writeFile(configPath, content)
  }

  private async removeToken(): Promise<void> {
    // HTTP extra header
    await this.removeGitConfig(this.tokenConfigKey)
  }

  private async removeGitConfig(
    configKey: string,
    submoduleOnly: boolean = false
  ): Promise<void> {
    if (!submoduleOnly) {
      if (
        (await this.git.configExists(configKey, true)) &&
        !(await this.git.tryConfigUnset(configKey, true))
      ) {
        // Load the config contents
        core.warning(`Failed to remove '${configKey}' from the git config`)
      }
    }
  }
}
