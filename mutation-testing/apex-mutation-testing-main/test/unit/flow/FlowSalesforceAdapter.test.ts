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
    const res = await executor('node', [
      '-e',
      "process.stdout.write('success')",
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
    expect(res.exitCode).toBeGreaterThanOrEqual(1)
    expect(res.stderr).toMatch(/ENOENT|not recognized/)
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
    const res = await executor('node', [
      '-e',
      process.platform === 'win32'
        ? '"process.stdout.write(\'some stdout\'); process.stderr.write(\'some error\'); process.exit(4)"'
        : "process.stdout.write('some stdout'); process.stderr.write('some error'); process.exit(4)",
    ])
    expect(res.exitCode).toBe(4)
    expect(res.stdout).toBe('some stdout')
    expect(res.stderr).toBe('some error')
  })

  describe('deployFiles', () => {
    it('returns success immediately when filePaths is empty', async () => {
      const adapter = new FlowSalesforceAdapter()
      const res = await adapter.deployFiles([])
      expect(res.success).toBe(true)
    })

    it('deploys multiple files successfully', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({ status: 0, result: { success: true } }),
        stderr: '',
        exitCode: 0,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      const res = await adapter.deployFiles(['file1.xml', 'file2.xml'])
      expect(res.success).toBe(true)
      expect(mockExecutor).toHaveBeenCalledWith('sf', [
        'project',
        'deploy',
        'start',
        '--json',
        '-d',
        'file1.xml',
        '-d',
        'file2.xml',
        '-o',
        'test-org',
      ])
    })

    it('returns error message on deployment failure', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          status: 1,
          result: {
            details: {
              componentFailures: [{ problem: 'Test failure in file1' }],
            },
          },
        }),
        stderr: '',
        exitCode: 1,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      const res = await adapter.deployFiles(['file1.xml'])
      expect(res.success).toBe(false)
      expect(res.errorMessage).toBe('Test failure in file1')
    })
  })

  describe('getLatestFlowVersion', () => {
    it('returns versionNumber and flowId when found', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          status: 0,
          result: {
            records: [
              {
                Label: 'Account After',
                VersionNumber: 7,
                ApiName: 'Account_After',
                LatestVersionId: '301d00000012345',
              },
            ],
          },
        }),
        stderr: '',
        exitCode: 0,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      const res = await adapter.getLatestFlowVersion('Account_After')
      expect(res.versionNumber).toBe(7)
      expect(res.flowId).toBe('301d00000012345')
      expect(mockExecutor).toHaveBeenCalledWith('sf', [
        'data',
        'query',
        '-q',
        "SELECT Label, VersionNumber, ApiName, LatestVersionId FROM FlowDefinitionView WHERE ApiName = 'Account_After'",
        '--json',
        '-o',
        'test-org',
      ])
    })

    it('throws when no records returned', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          status: 0,
          result: {
            records: [],
          },
        }),
        stderr: '',
        exitCode: 0,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      await expect(adapter.getLatestFlowVersion('UnknownFlow')).rejects.toThrow(
        "No FlowDefinitionView found for Flow 'UnknownFlow'"
      )
    })
  })

  describe('deleteFlowVersion', () => {
    it('deletes flow version via tooling api successfully', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          status: 0,
          result: { id: '301d00000012345', success: true },
        }),
        stderr: '',
        exitCode: 0,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      const res = await adapter.deleteFlowVersion('301d00000012345')
      expect(res).toBe(true)
      expect(mockExecutor).toHaveBeenCalledWith('sf', [
        'data',
        'delete',
        'record',
        '-t',
        '-s',
        'Flow',
        '-i',
        '301d00000012345',
        '--json',
        '-o',
        'test-org',
      ])
    })

    it('returns false when delete fails', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: 'Error',
        stderr: 'Cannot delete active version',
        exitCode: 1,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor)
      const res = await adapter.deleteFlowVersion('301d00000012345')
      expect(res).toBe(false)
    })
  })

  describe('runApexTests', () => {
    it('fails when no test classes specified', async () => {
      const adapter = new FlowSalesforceAdapter()
      const res = await adapter.runApexTests([])
      expect(res.allPassed).toBe(false)
      expect(res.failingMethods).toEqual(['No Apex test classes specified'])
    })

    it('returns error when sf logic run test fails or returns no testRunId', async () => {
      const mockExecutor = vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          status: 1,
          message: 'Apex class not found: UnknownClass',
        }),
        stderr: '',
        exitCode: 1,
      })
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 500)
      const res = await adapter.runApexTests(['UnknownClass'])
      expect(res.allPassed).toBe(false)
      expect(res.failingMethods).toEqual(['Apex class not found: UnknownClass'])
    })

    it('runs apex tests asynchronously and polls results successfully', async () => {
      const mockExecutor = vi
        .fn()
        // 1st call: sf logic run test
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000123' },
          }),
          stderr: '',
          exitCode: 0,
        })
        // 2nd call: sf logic get test
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Passed', failing: 0, testsRan: 2 },
              tests: [
                {
                  MethodName: 'testMethod1',
                  Outcome: 'Pass',
                  FullName: 'MyTest.testMethod1',
                },
                {
                  MethodName: 'testMethod2',
                  Outcome: 'Pass',
                  FullName: 'MyTest.testMethod2',
                },
              ],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 1000)
      const res = await adapter.runApexTests(['MyTest'])
      expect(res.allPassed).toBe(true)
      expect(res.failingMethods).toHaveLength(0)

      expect(mockExecutor).toHaveBeenNthCalledWith(1, 'sf', [
        'logic',
        'run',
        'test',
        '--json',
        '--class-names',
        'MyTest',
        '-o',
        'test-org',
      ])
      expect(mockExecutor).toHaveBeenNthCalledWith(2, 'sf', [
        'logic',
        'get',
        'test',
        '-i',
        '707d000000123',
        '--json',
        '-o',
        'test-org',
      ])
    })

    it('detects failing apex test methods from polled results', async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000123' },
          }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Failed', failing: 1, testsRan: 2 },
              tests: [
                {
                  MethodName: 'testMethod1',
                  Outcome: 'Pass',
                  FullName: 'MyTest.testMethod1',
                },
                {
                  MethodName: 'testMethod2',
                  Outcome: 'Fail',
                  FullName: 'MyTest.testMethod2',
                },
              ],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 1000)
      const res = await adapter.runApexTests(['MyTest'])
      expect(res.allPassed).toBe(false)
      expect(res.failingMethods).toEqual(['MyTest.testMethod2'])
    })

    it('handles multiple test classes in a single async run', async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000MULTI' },
          }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Passed', failing: 0, testsRan: 2 },
              tests: [
                {
                  MethodName: 'testA',
                  Outcome: 'Pass',
                  FullName: 'ClassA.testA',
                },
                {
                  MethodName: 'testB',
                  Outcome: 'Pass',
                  FullName: 'ClassB.testB',
                },
              ],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 1000)
      const res = await adapter.runApexTests(['ClassA', 'ClassB'])
      expect(res.allPassed).toBe(true)
      expect(mockExecutor).toHaveBeenNthCalledWith(1, 'sf', [
        'logic',
        'run',
        'test',
        '--json',
        '--class-names',
        'ClassA',
        '--class-names',
        'ClassB',
        '-o',
        'test-org',
      ])
    })

    it('handles timeout when test run never completes', async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000TIMEOUT' },
          }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValue({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Processing', testsRan: 0 },
              tests: [],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      // Use a timeout of -1 ms so it immediately times out
      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, -1)
      const res = await adapter.runApexTests(['ClassA'])
      expect(res.allPassed).toBe(false)
      expect(res.failingMethods[0]).toContain('timed out')
    })

    it('records baseline duration on first test run and stores it in adapter', async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000FIRST' },
          }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Passed', failing: 0, testsRan: 1 },
              tests: [{ MethodName: 'testMethod', Outcome: 'Pass' }],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 1000)
      expect(adapter.getFirstApexRunDuration()).toBeUndefined()
      await adapter.runApexTests(['ClassA'])
      expect(adapter.getFirstApexRunDuration()).toBeGreaterThanOrEqual(1000)
    })

    it('uses preexisting firstApexRunDurationMs on subsequent runs', async () => {
      const mockExecutor = vi
        .fn()
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: { testRunId: '707d000000SECOND' },
          }),
          stderr: '',
          exitCode: 0,
        })
        .mockResolvedValueOnce({
          stdout: JSON.stringify({
            status: 0,
            result: {
              summary: { outcome: 'Passed', failing: 0, testsRan: 1 },
              tests: [{ MethodName: 'testMethod', Outcome: 'Pass' }],
            },
          }),
          stderr: '',
          exitCode: 0,
        })

      const adapter = new FlowSalesforceAdapter('test-org', mockExecutor, 0, 1000, 3000)
      expect(adapter.getFirstApexRunDuration()).toBe(3000)
      const res = await adapter.runApexTests(['ClassA'])
      expect(res.allPassed).toBe(true)
      expect(adapter.getFirstApexRunDuration()).toBe(3000)
    })
  })
})
