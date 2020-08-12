import {URL} from 'url'
export function getServerUrl(): URL {
  // todo: remove GITHUB_URL after support for GHES Alpha is no longer needed
  return new URL(
    process.env['GITHUB_SERVER_URL'] ||
      process.env['GITHUB_URL'] ||
      'https://github.com'
  )
}
