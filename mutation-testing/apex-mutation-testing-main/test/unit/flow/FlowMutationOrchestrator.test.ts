import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FlowMutationOrchestrator } from '../../../src/flow/FlowMutationOrchestrator.js'
import type {
  FlowDeployResult,
  FlowSalesforcePort,
  FlowTestRunResult,
} from '../../../src/flow/types.js'
import { SF_NAMESPACE } from '../../../src/flow/xml/FlowXmlDom.js'

const VALID_FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="${SF_NAMESPACE}">
    <apiVersion>67.0</apiVersion>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <object>Account</object>
        <recordTriggerType>Create</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Draft</status>
</Flow>`

const ACTIVE_FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="${SF_NAMESPACE}">
    <apiVersion>67.0</apiVersion>
    <description>Original Description</description>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <object>Account</object>
        <recordTriggerType>Create</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`

describe('FlowMutationOrchestrator', () => {
  let tempDir: string
  let tempFlowFile: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-orch-test-'))
    tempFlowFile = path.join(tempDir, 'Account_Before.flow-meta.xml')
    await fs.writeFile(tempFlowFile, VALID_FLOW_XML, 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('filters mutants by line numbers and ranges', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn(),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    // VALID_FLOW_XML has start/recordTriggerType around line 6
    const reportMatch = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
      lines: ['5-8'],
      dryRun: true,
    })
    expect(reportMatch.totalMutants).toBe(1)

    const reportSingleMatch = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
      lines: ['7'],
      dryRun: true,
    })
    expect(reportSingleMatch.totalMutants).toBe(1)

    const reportEmptyLines = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
      lines: [],
      dryRun: true,
    })
    expect(reportEmptyLines.totalMutants).toBe(1)

    const reportNoMatch = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
      lines: ['1-2'],
      dryRun: true,
    })
    expect(reportNoMatch.totalMutants).toBe(0)
  })

  it('throws error on invalid line ranges or numbers', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn(),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
        lines: ['10-5'],
        dryRun: true,
      })
    ).rejects.toThrow("Invalid line range: '10-5'")

    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
        lines: ['abc'],
        dryRun: true,
      })
    ).rejects.toThrow("Invalid line number: 'abc'")
  })

  it('runs in dry-run mode without calling deploy or test', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn(),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    const report = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
      dryRun: true,
    })

    expect(mockPort.deployFlowXml).not.toHaveBeenCalled()
    expect(mockPort.runFlowTests).not.toHaveBeenCalled()
    expect(report.totalMutants).toBeGreaterThan(0)
    expect(report.mutants.every(m => m.status === 'Pending')).toBe(true)
  })

  it('throws error when Flow validation fails (e.g., Screen Flow)', async () => {
    const screenFlowXml = `<Flow xmlns="${SF_NAMESPACE}"><processType>Flow</processType></Flow>`
    await fs.writeFile(tempFlowFile, screenFlowXml, 'utf-8')

    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn(),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'ScreenFlow',
      })
    ).rejects.toThrow('Flow validation failed for ScreenFlow')
  })

  it('throws error when baseline deploy fails', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockResolvedValue({
        success: false,
        errorMessage: 'Syntax Error in Flow',
      }),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
      })
    ).rejects.toThrow('Baseline Flow deployment failed: Syntax Error in Flow')
  })

  it('throws error when baseline tests fail', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockResolvedValue({ success: true }),
      runFlowTests: vi.fn().mockResolvedValue({
        allPassed: false,
        failingMethods: ['Test_ShouldSetRating'],
      }),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
      })
    ).rejects.toThrow(
      'Baseline tests failed before mutation started: Test_ShouldSetRating'
    )
  })

  it('marks mutants as Survived when tests pass on mutated flow', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockResolvedValue({ success: true }),
      runFlowTests: vi
        .fn()
        .mockResolvedValue({ allPassed: true, failingMethods: [] }),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    const report = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
    })

    expect(report.totalMutants).toBe(1)
    expect(report.killed).toBe(0)
    expect(report.survived).toBe(1)
    expect(report.mutationScore).toBe(0)
    expect(report.mutants[0].status).toBe('Survived')
  })

  it('runs full mutation lifecycle and calculates score correctly', async () => {
    let callCount = 0
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockImplementation(async () => {
        callCount++
        // Simulate: mutant deploy succeeds
        return { success: true }
      }),
      runFlowTests: vi.fn().mockImplementation(async () => {
        // First run is baseline (passes)
        // Second run is mutant (fails -> Killed)
        if (callCount === 1) {
          return { allPassed: true, failingMethods: [] }
        }
        return { allPassed: false, failingMethods: ['FlowTest_Failed'] }
      }),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    const report = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
    })

    expect(report.totalMutants).toBe(1)
    expect(report.killed).toBe(1)
    expect(report.survived).toBe(0)
    expect(report.mutationScore).toBe(100)
    expect(report.mutants[0].status).toBe('Killed')
    expect(report.mutants[0].killedBy).toEqual(['FlowTest_Failed'])

    // Verify rollback restored original file on disk
    const restoredDiskContent = await fs.readFile(tempFlowFile, 'utf-8')
    expect(restoredDiskContent).toBe(VALID_FLOW_XML)
  })

  it('ALWAYS restores original XML even when test execution throws an unexpected error', async () => {
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockResolvedValue({ success: true }),
      runFlowTests: vi
        .fn()
        .mockResolvedValueOnce({ allPassed: true, failingMethods: [] }) // baseline
        .mockRejectedValueOnce(new Error('Unexpected network disconnection')),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)

    await expect(
      orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
      })
    ).rejects.toThrow('Unexpected network disconnection')

    // Verify file on disk is restored to original content
    const restoredDiskContent = await fs.readFile(tempFlowFile, 'utf-8')
    expect(restoredDiskContent).toBe(VALID_FLOW_XML)

    // Verify deployFlowXml was called to restore the original XML in the finally block
    expect(mockPort.deployFlowXml).toHaveBeenLastCalledWith(
      tempFlowFile,
      VALID_FLOW_XML
    )
  })

  it('handles flow with zero mutants gracefully', async () => {
    const noMutantXml = `<Flow xmlns="${SF_NAMESPACE}"><apiVersion>67.0</apiVersion><processType>AutoLaunchedFlow</processType><status>Draft</status></Flow>`
    await fs.writeFile(tempFlowFile, noMutantXml, 'utf-8')

    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn(),
      runFlowTests: vi.fn(),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    const report = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'NoMutantsFlow',
    })

    expect(report.totalMutants).toBe(0)
    expect(report.mutationScore).toBe(0)
    expect(mockPort.deployFlowXml).not.toHaveBeenCalled()
  })

  it('marks mutants as CompileError when deployment fails', async () => {
    let deployCalls = 0
    const mockPort: FlowSalesforcePort = {
      deployFlowXml: vi.fn().mockImplementation(async () => {
        deployCalls++
        // 1st call is baseline deploy (success)
        // 2nd call is mutant deploy (failure)
        // 3rd call is finally restore deploy (success)
        if (deployCalls === 2) {
          return { success: false, errorMessage: 'Illegal metadata tag' }
        }
        return { success: true }
      }),
      runFlowTests: vi
        .fn()
        .mockResolvedValue({ allPassed: true, failingMethods: [] }),
    }

    const orchestrator = new FlowMutationOrchestrator(mockPort)
    const report = await orchestrator.run({
      flowFilePath: tempFlowFile,
      flowDeveloperName: 'Account_Before',
    })

    expect(report.compileErrors).toBe(1)
    expect(report.killed).toBe(0)
    expect(report.survived).toBe(0)
    expect(report.mutants[0].status).toBe('CompileError')
  })

  describe('Active Flow Version Management', () => {
    it('deactivates active flow, triggers new version, updates flowtests, and cleans up on rollback', async () => {
      // Setup active flow
      await fs.writeFile(tempFlowFile, ACTIVE_FLOW_XML, 'utf-8')

      // Create a sibling flowtests directory and a dummy flowtest file
      const flowTestsDir = path.join(tempDir, '../flowtests')
      await fs.mkdir(flowTestsDir, { recursive: true })
      const flowTestPath = path.join(
        flowTestsDir,
        'Account_Before_Test.flowtest-meta.xml'
      )
      const flowTestContent = `<?xml version="1.0" encoding="UTF-8"?>
<FlowTest xmlns="${SF_NAMESPACE}">
    <flowApiName>Account_Before</flowApiName>
    <flowTestFlowVersions>
        <flowVersionNumber>1</flowVersionNumber>
    </flowTestFlowVersions>
</FlowTest>`
      await fs.writeFile(flowTestPath, flowTestContent, 'utf-8')

      const deployedXmls: string[] = []
      const deployedFilesList: string[][] = []

      const mockPort: FlowSalesforcePort = {
        deployFlowXml: vi.fn().mockImplementation(async (_, xml: string) => {
          deployedXmls.push(xml)
          return { success: true }
        }),
        deployFiles: vi.fn().mockImplementation(async (files: string[]) => {
          deployedFilesList.push(files)
          return { success: true }
        }),
        getLatestFlowVersion: vi.fn().mockResolvedValue({
          versionNumber: 7,
          flowId: '301d000000TEMP',
        }),
        deleteFlowVersion: vi.fn().mockResolvedValue(true),
        runFlowTests: vi
          .fn()
          .mockResolvedValue({ allPassed: true, failingMethods: [] }),
        runApexTests: vi.fn(),
      }

      const orchestrator = new FlowMutationOrchestrator(mockPort)
      const report = await orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
      })

      expect(report.totalMutants).toBe(1)
      expect(mockPort.getLatestFlowVersion).toHaveBeenCalledWith('Account_Before')
      expect(mockPort.deleteFlowVersion).toHaveBeenCalledWith('301d000000TEMP')

      // Verify the flow was first deactivated to Draft
      expect(deployedXmls[0]).toContain('<status>Draft</status>')
      // Verify description was changed to trigger new version
      expect(deployedXmls[1]).toContain('Original Description Mutating')

      // Verify flowtest file was updated to version 7 during run, but rolled back to 1 at the end
      const finalFlowTestContent = await fs.readFile(flowTestPath, 'utf-8')
      expect(finalFlowTestContent).toContain('<flowVersionNumber>1</flowVersionNumber>')

      // Verify original active flow XML was restored on disk
      const finalFlowContent = await fs.readFile(tempFlowFile, 'utf-8')
      expect(finalFlowContent).toContain('<status>Active</status>')

      // Clean up flowtest dir
      await fs.rm(flowTestsDir, { recursive: true, force: true })
    })

    it('throws error when deactivation fails', async () => {
      await fs.writeFile(tempFlowFile, ACTIVE_FLOW_XML, 'utf-8')

      const mockPort: FlowSalesforcePort = {
        deployFlowXml: vi.fn().mockResolvedValue({
          success: false,
          errorMessage: 'Cannot deactivate locked flow',
        }),
        deployFiles: vi.fn(),
        getLatestFlowVersion: vi.fn(),
        runFlowTests: vi.fn(),
        runApexTests: vi.fn(),
      }

      const orchestrator = new FlowMutationOrchestrator(mockPort)
      await expect(
        orchestrator.run({
          flowFilePath: tempFlowFile,
          flowDeveloperName: 'Account_Before',
        })
      ).rejects.toThrow('Failed to deactivate active Flow "Account_Before": Cannot deactivate locked flow')
    })
  })

  describe('Apex Testing Mode', () => {
    it('executes runApexTests when apexTests are provided and marks mutant as killed when test fails', async () => {
      let runIndex = 0
      const mockPort: FlowSalesforcePort = {
        deployFlowXml: vi.fn().mockResolvedValue({ success: true }),
        deployFiles: vi.fn(),
        getLatestFlowVersion: vi.fn(),
        runFlowTests: vi.fn(),
        runApexTests: vi.fn().mockImplementation(async (testClasses: string[]) => {
          runIndex++
          if (runIndex === 1) {
            // Baseline test passes
            return { allPassed: true, failingMethods: [] }
          }
          // Mutant test fails -> mutant killed!
          return {
            allPassed: false,
            failingMethods: [`${testClasses[0]}.testAccountDiscount`],
          }
        }),
      }

      const orchestrator = new FlowMutationOrchestrator(mockPort)
      const report = await orchestrator.run({
        flowFilePath: tempFlowFile,
        flowDeveloperName: 'Account_Before',
        apexTests: ['DiscountCalculatorTest'],
      })

      expect(report.totalMutants).toBe(1)
      expect(report.killed).toBe(1)
      expect(report.survived).toBe(0)
      expect(report.mutationScore).toBe(100)
      expect(mockPort.runApexTests).toHaveBeenCalledWith(['DiscountCalculatorTest'])
      expect(mockPort.runFlowTests).not.toHaveBeenCalled()
    })
  })
})
