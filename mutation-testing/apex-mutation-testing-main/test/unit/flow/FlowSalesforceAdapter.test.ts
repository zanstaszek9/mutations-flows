import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  type CliExecutor,
  FlowSalesforceAdapter,
} from '../../../src/flow/adapters/FlowSalesforceAdapter.js'

describe('FlowSalesforceAdapter', () => {
  let tempDir: string
  let tempFlowFile: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-adapter-test-'))
    tempFlowFile = path.join(tempDir, 'TestFlow.flow-meta.xml')
    await fs.writeFile(tempFlowFile, '<Flow></Flow>', 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('deploys flow xml successfully via CLI', async () => {
    const mockExecutor: CliExecutor = async (cmd, args) => {
      expect(cmd).toBe('sf')
      expect(args).toContain('project')
      expect(args).toContain('deploy')
      expect(args).toContain('start')
      expect(args).toContain('-o')
      expect(args).toContain('testOrg')
      return {
        stdout: JSON.stringify({
          status: 0,
          result: { success: true },
        }),
        stderr: '',
        exitCode: 0,
      }
    }

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(
      tempFlowFile,
      '<Flow><status>Active</status></Flow>'
    )

    expect(result.success).toBe(true)
    const onDisk = await fs.readFile(tempFlowFile, 'utf-8')
    expect(onDisk).toBe('<Flow><status>Active</status></Flow>')
  })

  it('returns failure on deploy failure', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 1,
        message: 'Deployment syntax error',
        result: {
          details: {
            componentFailures: [{ problem: 'Invalid syntax at line 5' }],
          },
        },
      }),
      stderr: 'Deployment syntax error',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<InvalidFlow/>')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toContain('Invalid syntax at line 5')
  })

  it('runs flow tests successfully', async () => {
    let capturedArgs: string[] = []
    const mockExecutor: CliExecutor = async (_cmd, args) => {
      capturedArgs = args
      return {
        stdout: JSON.stringify({
          status: 0,
          result: {
            summary: { outcome: 'Passed', failing: 0, passing: 2, testsRan: 2 },
            tests: [
              { MethodName: 'Test_1', Outcome: 'Pass' },
              { MethodName: 'Test_2', Outcome: 'Pass' },
            ],
          },
        }),
        stderr: '',
        exitCode: 0,
      }
    }

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')

    expect(capturedArgs).toContain('-n')
    expect(capturedArgs).toContain('Account_Before')
    expect(result.allPassed).toBe(true)
    expect(result.failingMethods).toEqual([])
  })

  it('detects failing flow tests', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Failed', failing: 1, passing: 1, testsRan: 2 },
          tests: [
            { MethodName: 'Test_1', Outcome: 'Pass' },
            { MethodName: 'Test_2', Outcome: 'Fail' },
          ],
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before', [
      'Account_Before.Test_1',
      'Account_Before.Test_2',
    ])

    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Test_2'])
  })

  it('fails with No FlowTests found when tests array is empty', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed', failing: 0, passing: 0, testsRan: 0 },
          tests: [],
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')

    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['No FlowTests found'])
  })

  it('fails with No FlowTests found when summary testsRan is 0', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed', failing: 0, passing: 0, testsRan: 0 },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')

    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['No FlowTests found'])
  })

  it('runs without targetOrg parameter', async () => {
    let capturedArgs: string[] = []
    const mockExecutor: CliExecutor = async (_cmd, args) => {
      capturedArgs = args
      return {
        stdout: JSON.stringify({ status: 0, result: { success: true } }),
        stderr: '',
        exitCode: 0,
      }
    }

    const adapter = new FlowSalesforceAdapter(undefined, mockExecutor)
    await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(capturedArgs).not.toContain('-o')
  })

  it('handles JSON parse error on deploy', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: 'not-json',
      stderr: 'Raw error',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Raw error')
  })

  it('handles flow test execution when summary outcome is failed', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Failed', failing: 1, testsRan: 1 },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['FlowTestFailed'])
  })

  it('handles flow test execution when command errors out without tests', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 1,
        message: 'Flow not found',
      }),
      stderr: '',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Flow not found'])
  })

  it('handles flow test execution when command errors out with only stderr', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({ status: 1 }),
      stderr: 'Direct stderr error',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Direct stderr error'])
  })

  it('handles flow test execution when command errors out with neither message nor stderr', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({ status: 1 }),
      stderr: '',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Flow test execution failed'])
  })

  it('handles flow test json parse error when stderr is empty', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: 'not-json',
      stderr: '',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Failed to parse flow test results'])
  })

  it('handles flow test execution JSON parsing error', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: 'invalid json',
      stderr: 'Flow execution failure',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['Flow execution failure'])
  })

  it('handles flow tests with FullName or fallback to UnknownTest', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          tests: [
            { FullName: 'FlowTest.WithFullName', Outcome: 'Fail' },
            { Outcome: 'Fail' },
          ],
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual([
      'FlowTest.WithFullName',
      'UnknownTest',
    ])
  })

  it('handles flow tests when summary outcome is passed without tests array', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed', failing: 0, testsRan: 1 },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(true)
    expect(result.failingMethods).toEqual([])
  })

  it('handles flow tests when summary outcome is passed but failing > 0', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed', failing: 1, testsRan: 1 },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['FlowTestFailed'])
  })

  it('handles deploy non-json stdout when exitCode is 0', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: 'Successfully deployed non-json',
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(result.success).toBe(true)
    expect(result.errorMessage).toBeUndefined()
  })

  it('handles deploy failure when componentFailures is absent', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 1,
        result: { success: false },
      }),
      stderr: 'Generic deployment failure',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Generic deployment failure')
  })

  it('runs without targetOrg parameter on runFlowTests', async () => {
    let capturedArgs: string[] = []
    const mockExecutor: CliExecutor = async (_cmd, args) => {
      capturedArgs = args
      return {
        stdout: JSON.stringify({
          status: 0,
          result: { summary: { outcome: 'Passed', failing: 0, testsRan: 1 } },
        }),
        stderr: '',
        exitCode: 0,
      }
    }

    const adapter = new FlowSalesforceAdapter(undefined, mockExecutor)
    await adapter.runFlowTests('Account_Before')
    expect(capturedArgs).not.toContain('-o')
  })

  it('handles deploy non-json stdout when exitCode is 1 and stderr is empty', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: 'fail non-json',
      stderr: '',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Deployment failed to parse JSON')
  })

  it('handles deploy failure when componentFailures, message, and stderr are all empty', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({ status: 1 }),
      stderr: '',
      exitCode: 1,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.deployFlowXml(tempFlowFile, '<Flow/>')
    expect(result.success).toBe(false)
    expect(result.errorMessage).toBe('Deployment failed')
  })

  it('handles flow tests when summary outcome is passed without explicit failing count', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed', testsRan: 1 },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(true)
    expect(result.failingMethods).toEqual([])
  })

  it('handles flow tests when summary has no testsRan property', async () => {
    const mockExecutor: CliExecutor = async () => ({
      stdout: JSON.stringify({
        status: 0,
        result: {
          summary: { outcome: 'Passed' },
        },
      }),
      stderr: '',
      exitCode: 0,
    })

    const adapter = new FlowSalesforceAdapter('testOrg', mockExecutor)
    const result = await adapter.runFlowTests('Account_Before')
    expect(result.allPassed).toBe(false)
    expect(result.failingMethods).toEqual(['No FlowTests found'])
  })

  it('defaultCliExecutor handles command execution success', async () => {
    const adapter = new FlowSalesforceAdapter()
    const executor = (
      adapter as unknown as {
        defaultCliExecutor: (
          cmd: string,
          args: string[]
        ) => Promise<{ stdout: string; exitCode: number }>
      }
    ).defaultCliExecutor
    const res = await executor(process.execPath, [
      '-e',
      'process.stdout.write("success")',
    ])
    expect(res.exitCode).toBe(0)
    expect(res.stdout).toBe('success')
  })

  it('defaultCliExecutor handles command spawn failure without stderr property', async () => {
    const adapter = new FlowSalesforceAdapter()
    const executor = (
      adapter as unknown as {
        defaultCliExecutor: (
          cmd: string,
          args: string[]
        ) => Promise<{ stderr: string; exitCode: number }>
      }
    ).defaultCliExecutor
    const res = await executor('/non_existent_binary_12345', [])
    expect(res.exitCode).toBe(1)
    expect(res.stderr).toContain('ENOENT')
  })

  it('defaultCliExecutor handles command execution failure with stdout, exit code and stderr', async () => {
    const adapter = new FlowSalesforceAdapter()
    const executor = (
      adapter as unknown as {
        defaultCliExecutor: (
          cmd: string,
          args: string[]
        ) => Promise<{ stdout: string; stderr: string; exitCode: number }>
      }
    ).defaultCliExecutor
    const res = await executor(process.execPath, [
      '-e',
      'process.stdout.write("some stdout"); process.stderr.write("some error"); process.exit(4)',
    ])
    expect(res.exitCode).toBe(4)
    expect(res.stdout).toBe('some stdout')
    expect(res.stderr).toBe('some error')
  })
})
