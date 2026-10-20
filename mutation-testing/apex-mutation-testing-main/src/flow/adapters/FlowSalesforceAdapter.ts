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

  public constructor(targetOrg?: string, customExecutor?: CliExecutor) {
    this.targetOrg = targetOrg
    this.executor = customExecutor ?? this.defaultCliExecutor
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
