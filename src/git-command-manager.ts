import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as io from '@actions/io'
import * as regexpHelper from './regexp-helper'
import * as retryHelper from './retry-helper'
import {GitVersion} from './git-version'

// Auth header not supported before 2.9
// Wire protocol v2 not supported before 2.18
export const MinimumGitVersion = new GitVersion('2.18')

export interface IGitCommandManager {
  config(
    configKey: string,
    configValue: string,
    globalConfig?: boolean
  ): Promise<void>
  configExists(configKey: string, globalConfig?: boolean): Promise<boolean>
  getDefaultBranch(repositoryUrl: string): Promise<string>
  log1(): Promise<string>
  removeEnvironmentVariable(name: string): void
  setEnvironmentVariable(name: string, value: string): void
  tryClean(): Promise<boolean>
  tryConfigUnset(configKey: string, globalConfig?: boolean): Promise<boolean>
}

export async function createCommandManager(): Promise<IGitCommandManager> {
  return await GitCommandManager.createCommandManager()
}

class GitCommandManager {
  private gitEnv = {
    GIT_TERMINAL_PROMPT: '0', // Disable git prompt
    GCM_INTERACTIVE: 'Never' // Disable prompting for git credential manager
  }
  private gitPath = ''

  // Private constructor; use createCommandManager()
  private constructor() {}

  async branchDelete(remote: boolean, branch: string): Promise<void> {
    const args = ['branch', '--delete', '--force']
    if (remote) {
      args.push('--remote')
    }
    args.push(branch)

    await this.execGit(args)
  }

  async branchExists(remote: boolean, pattern: string): Promise<boolean> {
    const args = ['branch', '--list']
    if (remote) {
      args.push('--remote')
    }
    args.push(pattern)

    const output = await this.execGit(args)
    return !!output.stdout.trim()
  }

  async branchList(remote: boolean): Promise<string[]> {
    const result: string[] = []

    // Note, this implementation uses "rev-parse --symbolic-full-name" because the output from
    // "branch --list" is more difficult when in a detached HEAD state.
    // Note, this implementation uses "rev-parse --symbolic-full-name" because there is a bug
    // in Git 2.18 that causes "rev-parse --symbolic" to output symbolic full names.

    const args = ['rev-parse', '--symbolic-full-name']
    if (remote) {
      args.push('--remotes=origin')
    } else {
      args.push('--branches')
    }

    const output = await this.execGit(args)

    for (let branch of output.stdout.trim().split('\n')) {
      branch = branch.trim()
      if (branch) {
        if (branch.startsWith('refs/heads/')) {
          branch = branch.substr('refs/heads/'.length)
        } else if (branch.startsWith('refs/remotes/')) {
          branch = branch.substr('refs/remotes/'.length)
        }

        result.push(branch)
      }
    }

    return result
  }

  async checkout(ref: string, startPoint: string): Promise<void> {
    const args = ['checkout', '--progress', '--force']
    if (startPoint) {
      args.push('-B', ref, startPoint)
    } else {
      args.push(ref)
    }

    await this.execGit(args)
  }

  async checkoutDetach(): Promise<void> {
    const args = ['checkout', '--detach']
    await this.execGit(args)
  }

  async config(
    configKey: string,
    configValue: string,
    globalConfig?: boolean
  ): Promise<void> {
    await this.execGit([
      'config',
      globalConfig ? '--global' : '--local',
      configKey,
      configValue
    ])
  }

  async configExists(
    configKey: string,
    globalConfig?: boolean
  ): Promise<boolean> {
    const pattern = regexpHelper.escape(configKey)
    const output = await this.execGit(
      [
        'config',
        globalConfig ? '--global' : '--local',
        '--name-only',
        '--get-regexp',
        pattern
      ],
      true
    )
    return output.exitCode === 0
  }

  async getDefaultBranch(repositoryUrl: string): Promise<string> {
    let output: GitOutput | undefined
    await retryHelper.execute(async () => {
      output = await this.execGit([
        'ls-remote',
        '--quiet',
        '--exit-code',
        '--symref',
        repositoryUrl,
        'HEAD'
      ])
    })

    if (output) {
      // Satisfy compiler, will always be set
      for (let line of output.stdout.trim().split('\n')) {
        line = line.trim()
        if (line.startsWith('ref:') || line.endsWith('HEAD')) {
          return line
            .substr('ref:'.length, line.length - 'ref:'.length - 'HEAD'.length)
            .trim()
        }
      }
    }

    throw new Error('Unexpected output when retrieving default branch')
  }

  async isDetached(): Promise<boolean> {
    // Note, "branch --show-current" would be simpler but isn't available until Git 2.22
    const output = await this.execGit(
      ['rev-parse', '--symbolic-full-name', '--verify', '--quiet', 'HEAD'],
      true
    )
    return !output.stdout.trim().startsWith('refs/heads/')
  }

  async lfsFetch(ref: string): Promise<void> {
    const args = ['lfs', 'fetch', 'origin', ref]

    const that = this
    await retryHelper.execute(async () => {
      await that.execGit(args)
    })
  }

  async lfsInstall(): Promise<void> {
    await this.execGit(['lfs', 'install', '--local'])
  }

  async log1(): Promise<string> {
    const output = await this.execGit(['log', '-1'])
    return output.stdout
  }

  async remoteAdd(remoteName: string, remoteUrl: string): Promise<void> {
    await this.execGit(['remote', 'add', remoteName, remoteUrl])
  }

  removeEnvironmentVariable(name: string): void {
    delete this.gitEnv[name]
  }

  /**
   * Resolves a ref to a SHA. For a branch or lightweight tag, the commit SHA is returned.
   * For an annotated tag, the tag SHA is returned.
   * @param {string} ref  For example: 'refs/heads/main' or '/refs/tags/v1'
   * @returns {Promise<string>}
   */
  async revParse(ref: string): Promise<string> {
    const output = await this.execGit(['rev-parse', ref])
    return output.stdout.trim()
  }

  setEnvironmentVariable(name: string, value: string): void {
    this.gitEnv[name] = value
  }

  async shaExists(sha: string): Promise<boolean> {
    const args = ['rev-parse', '--verify', '--quiet', `${sha}^{object}`]
    const output = await this.execGit(args, true)
    return output.exitCode === 0
  }

  async submoduleForeach(command: string, recursive: boolean): Promise<string> {
    const args = ['submodule', 'foreach']
    if (recursive) {
      args.push('--recursive')
    }
    args.push(command)

    const output = await this.execGit(args)
    return output.stdout
  }

  async submoduleSync(recursive: boolean): Promise<void> {
    const args = ['submodule', 'sync']
    if (recursive) {
      args.push('--recursive')
    }

    await this.execGit(args)
  }

  async submoduleUpdate(fetchDepth: number, recursive: boolean): Promise<void> {
    const args = ['-c', 'protocol.version=2']
    args.push('submodule', 'update', '--init', '--force')
    if (fetchDepth > 0) {
      args.push(`--depth=${fetchDepth}`)
    }

    if (recursive) {
      args.push('--recursive')
    }

    await this.execGit(args)
  }

  async tagExists(pattern: string): Promise<boolean> {
    const output = await this.execGit(['tag', '--list', pattern])
    return !!output.stdout.trim()
  }

  async tryClean(): Promise<boolean> {
    const output = await this.execGit(['clean', '-ffdx'], true)
    return output.exitCode === 0
  }

  async tryConfigUnset(
    configKey: string,
    globalConfig?: boolean
  ): Promise<boolean> {
    const output = await this.execGit(
      [
        'config',
        globalConfig ? '--global' : '--local',
        '--unset-all',
        configKey
      ],
      true
    )
    return output.exitCode === 0
  }

  async tryDisableAutomaticGarbageCollection(): Promise<boolean> {
    const output = await this.execGit(
      ['config', '--local', 'gc.auto', '0'],
      true
    )
    return output.exitCode === 0
  }

  async tryGetFetchUrl(): Promise<string> {
    const output = await this.execGit(
      ['config', '--local', '--get', 'remote.origin.url'],
      true
    )

    if (output.exitCode !== 0) {
      return ''
    }

    const stdout = output.stdout.trim()
    if (stdout.includes('\n')) {
      return ''
    }

    return stdout
  }

  async tryReset(): Promise<boolean> {
    const output = await this.execGit(['reset', '--hard', 'HEAD'], true)
    return output.exitCode === 0
  }

  static async createCommandManager(): Promise<GitCommandManager> {
    const result = new GitCommandManager()
    await result.initializeCommandManager()
    return result
  }

  private async execGit(
    args: string[],
    allowAllExitCodes = false
  ): Promise<GitOutput> {
    const result = new GitOutput()

    const env = {}
    for (const key of Object.keys(process.env)) {
      env[key] = process.env[key]
    }
    for (const key of Object.keys(this.gitEnv)) {
      env[key] = this.gitEnv[key]
    }

    const stdout: string[] = []

    const options = {
      env,
      ignoreReturnCode: allowAllExitCodes,
      listeners: {
        stdout: (data: Buffer) => {
          stdout.push(data.toString())
        }
      }
    }

    result.exitCode = await exec.exec(`"${this.gitPath}"`, args, options)
    result.stdout = stdout.join('')
    return result
  }

  private async initializeCommandManager(): Promise<void> {
    this.gitPath = await io.which('git', true)

    // Git version
    core.debug('Getting git version')
    let gitVersion = new GitVersion()
    const gitOutput = await this.execGit(['version'])
    const stdout = gitOutput.stdout.trim()
    if (!stdout.includes('\n')) {
      const match = stdout.match(/\d+\.\d+(\.\d+)?/)
      if (match) {
        gitVersion = new GitVersion(match[0])
      }
    }
    if (!gitVersion.isValid()) {
      throw new Error('Unable to determine git version')
    }

    // Minimum git version
    if (!gitVersion.checkMinimum(MinimumGitVersion)) {
      throw new Error(
        `Minimum required git version is ${MinimumGitVersion}. Your git ('${this.gitPath}') is ${gitVersion}`
      )
    }
    // Set the user agent
    const gitHttpUserAgent = `git/${gitVersion} (github-actions-checkout)`
    core.debug(`Set git useragent to: ${gitHttpUserAgent}`)
    this.gitEnv['GIT_HTTP_USER_AGENT'] = gitHttpUserAgent
  }
}

class GitOutput {
  stdout = ''
  exitCode = 0
}
