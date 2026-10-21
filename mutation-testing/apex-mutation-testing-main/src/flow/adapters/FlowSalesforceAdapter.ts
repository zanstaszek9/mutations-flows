import { execFile } from 'node:child_process'
import * as fs from 'node:fs/promises'
import { promisify } from 'node:util'
import type {
  FlowDeployResult,
  FlowSalesforcePort,
  FlowTestRunResult,
} from '../types.js'

const execFileAsync = promisify(execFile)

export interface CliExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CliExecutor {
  (command: string, args: string[]): Promise<CliExecutionResult>
}

export class FlowSalesforceAdapter implements FlowSalesforcePort {
  private readonly targetOrg?: string
  private readonly executor: CliExecutor
  private readonly pollIntervalMs: number
  private readonly pollTimeoutMs: number
  private firstApexRunDurationMs?: number

  public constructor(
    targetOrg?: string,
    customExecutor?: CliExecutor,
    pollIntervalMs = 2000,
    pollTimeoutMs = 600000,
    firstApexRunDurationMs?: number
  ) {
    this.targetOrg = targetOrg
    this.executor = customExecutor ?? this.defaultCliExecutor
    this.pollIntervalMs = pollIntervalMs
    this.pollTimeoutMs = pollTimeoutMs
    this.firstApexRunDurationMs = firstApexRunDurationMs
  }

  public getFirstApexRunDuration(): number | undefined {
    return this.firstApexRunDurationMs
  }

  private async defaultCliExecutor(
    command: string,
    args: string[]
  ): Promise<CliExecutionResult> {
    try {
      const { stdout, stderr } = await execFileAsync(command, args, {
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32',
      })
      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
      }
    } catch (err: unknown) {
      const errorWithOutput = err as {
        stdout?: string | Buffer
        stderr?: string | Buffer
        code?: number
      }
      return {
        stdout: errorWithOutput.stdout ? errorWithOutput.stdout.toString() : '',
        stderr: errorWithOutput.stderr
          ? errorWithOutput.stderr.toString()
          : (err as Error).message,
        exitCode:
          typeof errorWithOutput.code === 'number' ? errorWithOutput.code : 1,
      }
    }
  }

  public async deployFlowXml(
    flowFilePath: string,
    xmlContent: string
  ): Promise<FlowDeployResult> {
    await fs.writeFile(flowFilePath, xmlContent, 'utf-8')

    const args = ['project', 'deploy', 'start', '-d', flowFilePath, '--json']
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    const { stdout, stderr, exitCode } = await this.executor('sf', args)

    try {
      const parsed = JSON.parse(stdout)
      if (parsed.status === 0 && parsed.result?.success) {
        return { success: true }
      }
      const failureMsg =
        parsed.result?.details?.componentFailures
          ?.map((f: { problem?: string }) => f.problem)
          .join('; ') ||
        parsed.message ||
        stderr
      return { success: false, errorMessage: failureMsg || 'Deployment failed' }
    } catch {
      return {
        success: exitCode === 0,
        errorMessage:
          exitCode === 0
            ? undefined
            : stderr || 'Deployment failed to parse JSON',
      }
    }
  }

  public async deployFiles(
    filePaths: string[]
  ): Promise<FlowDeployResult> {
    if (!filePaths || filePaths.length === 0) {
      return { success: true }
    }

    const args = ['project', 'deploy', 'start', '--json']
    for (const fp of filePaths) {
      args.push('-d', fp)
    }
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    const { stdout, stderr, exitCode } = await this.executor('sf', args)

    try {
      const parsed = JSON.parse(stdout)
      if (parsed.status === 0 && parsed.result?.success) {
        return { success: true }
      }
      const failureMsg =
        parsed.result?.details?.componentFailures
          ?.map((f: { problem?: string }) => f.problem)
          .join('; ') ||
        parsed.message ||
        stderr
      return { success: false, errorMessage: failureMsg || 'Deployment failed' }
    } catch {
      return {
        success: exitCode === 0,
        errorMessage:
          exitCode === 0
            ? undefined
            : stderr || 'Deployment failed to parse JSON',
      }
    }
  }

  public async getLatestFlowVersion(
    flowApiName: string
  ): Promise<{ versionNumber: number; flowId?: string }> {
    const query = `SELECT Label, VersionNumber, ApiName, LatestVersionId FROM FlowDefinitionView WHERE ApiName = '${flowApiName}'`
    const args = ['data', 'query', '-q', query, '--json']
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    const { stdout, stderr } = await this.executor('sf', args)

    try {
      const parsed = JSON.parse(stdout)
      const records = parsed.result?.records as
        | Array<{ VersionNumber?: number; LatestVersionId?: string }>
        | undefined
      if (records && records.length > 0 && records[0].VersionNumber !== undefined) {
        return {
          versionNumber: Number(records[0].VersionNumber),
          flowId: records[0].LatestVersionId,
        }
      }
      throw new Error(
        parsed.message ||
          stderr ||
          `No FlowDefinitionView found for Flow '${flowApiName}'`
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('No FlowDefinitionView found')) {
        throw err
      }
      throw new Error(
        stderr || (err as Error).message || `Failed to query FlowDefinitionView for '${flowApiName}'`
      )
    }
  }

  public async deleteFlowVersion(flowId: string): Promise<boolean> {
    const args = [
      'data',
      'delete',
      'record',
      '-t',
      '-s',
      'Flow',
      '-i',
      flowId,
      '--json',
    ]
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    const { stdout } = await this.executor('sf', args)
    try {
      const parsed = JSON.parse(stdout)
      return parsed.status === 0 && Boolean(parsed.result?.success)
    } catch {
      return false
    }
  }

  public async runApexTests(
    testClasses: string[]
  ): Promise<FlowTestRunResult> {
    if (!testClasses || testClasses.length === 0) {
      return {
        allPassed: false,
        failingMethods: ['No Apex test classes specified'],
      }
    }

    const args = ['logic', 'run', 'test', '--json']
    for (const cls of testClasses) {
      args.push('--class-names', cls)
    }
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    const { stdout, stderr } = await this.executor('sf', args)

    let testRunId: string | undefined
    try {
      const parsed = JSON.parse(stdout)
      testRunId = parsed.result?.testRunId
      if (!testRunId && parsed.message) {
        return {
          allPassed: false,
          failingMethods: [parsed.message],
        }
      }
    } catch {
      return {
        allPassed: false,
        failingMethods: [
          stderr || 'Failed to parse sf logic run test response',
        ],
      }
    }

    if (!testRunId) {
      return {
        allPassed: false,
        failingMethods: [
          stderr || 'No testRunId returned by sf logic run test',
        ],
      }
    }

    // Periodically poll results via `sf logic get test`
    const getArgs = ['logic', 'get', 'test', '-i', testRunId, '--json']
    if (this.targetOrg) {
      getArgs.push('-o', this.targetOrg)
    }

    const dispatchTime = Date.now()

    // If we recorded the baseline test duration from the first run, wait that duration first
    if (this.firstApexRunDurationMs !== undefined && this.pollIntervalMs > 0) {
      await new Promise(resolve =>
        setTimeout(resolve, this.firstApexRunDurationMs)
      )
    }

    let retryWaitMs = 5000
    const pollStart = Date.now()

    while (Date.now() - pollStart < this.pollTimeoutMs) {
      const getResult = await this.executor('sf', getArgs)
      try {
        const parsed = JSON.parse(getResult.stdout)
        const summary = parsed.result?.summary
        const tests = parsed.result?.tests as
          | Array<{ Outcome?: string; MethodName?: string; FullName?: string }>
          | undefined

        const outcome = summary?.outcome
        const isFinished =
          outcome === 'Passed' ||
          outcome === 'Failed' ||
          (tests &&
            tests.length > 0 &&
            !['Queued', 'Processing', 'Running'].includes(outcome ?? ''))

        if (isFinished) {
          // Record duration if this was the first run (baseline)
          if (this.firstApexRunDurationMs === undefined) {
            this.firstApexRunDurationMs = Math.max(
              Date.now() - dispatchTime,
              1000
            )
          }

          if (tests && Array.isArray(tests)) {
            const failures = tests
              .filter(t => t.Outcome !== 'Pass')
              .map(t => t.FullName || t.MethodName || 'UnknownTest')
            return {
              allPassed: failures.length === 0,
              failingMethods: failures,
            }
          }

          if (summary) {
            const isPassed =
              outcome === 'Passed' && Number(summary.failing ?? 0) === 0
            return {
              allPassed: isPassed,
              failingMethods: isPassed ? [] : ['ApexTestFailed'],
            }
          }
        }
      } catch {
        // Retry while tests are still processing
      }

      if (this.pollIntervalMs > 0) {
        // If this is the first run (measuring baseline), poll with pollIntervalMs
        // If this is a subsequent run and tests haven't completed after initial wait,
        // wait retryWaitMs (starting at 5s) and increase by 5s each retry
        const waitTime =
          this.firstApexRunDurationMs === undefined
            ? this.pollIntervalMs
            : retryWaitMs

        await new Promise(resolve => setTimeout(resolve, waitTime))

        if (this.firstApexRunDurationMs !== undefined) {
          retryWaitMs += 5000
        }
      } else {
        // In test mode (pollIntervalMs === 0), break to avoid infinite loop when mock is static
        break
      }
    }

    return {
      allPassed: false,
      failingMethods: [
        `Apex test run ${testRunId} timed out after ${this.pollTimeoutMs / 1000}s`,
      ],
    }
  }

  public async runFlowTests(
    flowName: string,
    testNames?: string[]
  ): Promise<FlowTestRunResult> {
    const args = ['flow', 'run', 'test', '--synchronous', '--json']
    if (this.targetOrg) {
      args.push('-o', this.targetOrg)
    }

    if (testNames && testNames.length > 0) {
      for (const t of testNames) {
        args.push('-t', t)
      }
    } else {
      args.push('-n', flowName)
    }

    const { stdout, stderr } = await this.executor('sf', args)

    try {
      const parsed = JSON.parse(stdout)
      const tests = parsed.result?.tests as
        | Array<{ Outcome?: string; MethodName?: string; FullName?: string }>
        | undefined
      if (tests && Array.isArray(tests)) {
        if (tests.length === 0) {
          return {
            allPassed: false,
            failingMethods: ['No FlowTests found'],
          }
        }
        const failures = tests
          .filter(t => t.Outcome !== 'Pass')
          .map(t => t.MethodName || t.FullName || 'UnknownTest')
        return {
          allPassed: failures.length === 0,
          failingMethods: failures,
        }
      }

      const summary = parsed.result?.summary
      if (summary) {
        if (Number(summary.testsRan ?? 0) === 0) {
          return {
            allPassed: false,
            failingMethods: ['No FlowTests found'],
          }
        }
        const isPassed =
          summary.outcome === 'Passed' && Number(summary.failing ?? 0) === 0
        return {
          allPassed: isPassed,
          failingMethods: isPassed ? [] : ['FlowTestFailed'],
        }
      }

      return {
        allPassed: false,
        failingMethods: [
          parsed.message || stderr || 'Flow test execution failed',
        ],
      }
    } catch {
      return {
        allPassed: false,
        failingMethods: [stderr || 'Failed to parse flow test results'],
      }
    }
  }
}
