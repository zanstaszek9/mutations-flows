import { Console } from 'node:console'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FlowMutationRun from '../../../src/commands/apex/mutation/flow/run.js'
import { FlowMutationOrchestrator } from '../../../src/flow/FlowMutationOrchestrator.js'
import { SF_NAMESPACE } from '../../../src/flow/xml/FlowXmlDom.js'

const globalWithConsole = globalThis as unknown as {
  console: { Console?: unknown }
}
if (!globalWithConsole.console.Console) {
  globalWithConsole.console.Console = Console
}

const VALID_FLOW_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="${SF_NAMESPACE}">
    <apiVersion>67.0</apiVersion>
    <processType>AutoLaunchedFlow</processType>
    <start>
        <object>Account</object>
        <recordTriggerType>Create</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`

describe('FlowMutationRun Command', () => {
  let tempDir: string
  let tempFlowFile: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-cmd-test-'))
    tempFlowFile = path.join(tempDir, 'Account_Before.flow-meta.xml')
    await fs.writeFile(tempFlowFile, VALID_FLOW_XML, 'utf-8')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('has required summary, description and flags', () => {
    expect(FlowMutationRun.summary).toBeDefined()
    expect(FlowMutationRun.description).toBeDefined()
    expect(FlowMutationRun.flags['flow-file']).toBeDefined()
    expect(FlowMutationRun.flags['dry-run']).toBeDefined()
    expect(FlowMutationRun.flags['target-org']).toBeDefined()
  })

  it('throws when target-org is missing and not dry-run', async () => {
    vi.spyOn(
      FlowMutationRun.prototype as unknown as {
        parse: () => Promise<unknown>
      },
      'parse'
    ).mockResolvedValueOnce({
      flags: {
        'flow-file': tempFlowFile,
        'dry-run': false,
        'target-org': undefined,
      },
      args: {},
    })

    await expect(
      FlowMutationRun.run(['--flow-file', tempFlowFile])
    ).rejects.toThrow(
      'Flag --target-org is required when not running with --dry-run.'
    )
  })

  it('runs successfully with target-org and reports score', async () => {
    vi.spyOn(
      FlowMutationRun.prototype as unknown as {
        parse: () => Promise<unknown>
      },
      'parse'
    ).mockResolvedValueOnce({
      flags: {
        'flow-file': tempFlowFile,
        'dry-run': false,
        'target-org': { getUsername: () => 'test@example.com' },
      },
      args: {},
    })

    vi.spyOn(FlowMutationOrchestrator.prototype, 'run').mockResolvedValueOnce({
      flowFilePath: tempFlowFile,
      totalMutants: 2,
      killed: 2,
      survived: 0,
      compileErrors: 0,
      mutationScore: 100,
      mutants: [
        {
          id: 'FLOW-MUT-1',
          mutatorName: 'RecordTriggerTypeMutator',
          elementName: '$Start',
          description: 'Changed recordTriggerType',
          originalSnippet: 'Create',
          mutatedSnippet: 'Update',
          mutatedXml: '<Flow/>',
          status: 'Killed',
          killedBy: ['Test1'],
        },
      ],
    })

    const result = await FlowMutationRun.run(['--flow-file', tempFlowFile])

    expect(result.score).toBe(100)
    expect(result.report.totalMutants).toBe(2)
  })

  it('throws error when mutation score is below threshold', async () => {
    vi.spyOn(
      FlowMutationRun.prototype as unknown as {
        parse: () => Promise<unknown>
      },
      'parse'
    ).mockResolvedValueOnce({
      flags: {
        'flow-file': tempFlowFile,
        'dry-run': false,
        threshold: 80,
        'target-org': { getUsername: () => 'test@example.com' },
      },
      args: {},
    })

    vi.spyOn(FlowMutationOrchestrator.prototype, 'run').mockResolvedValueOnce({
      flowFilePath: tempFlowFile,
      totalMutants: 2,
      killed: 1,
      survived: 1,
      compileErrors: 0,
      mutationScore: 50,
      mutants: [],
    })

    await expect(
      FlowMutationRun.run(['--flow-file', tempFlowFile, '--threshold', '80'])
    ).rejects.toThrow('Mutation score 50% is below threshold 80%.')
  })

  it('runs successfully in dry-run mode and reports mutants with lines filter', async () => {
    const result = await FlowMutationRun.run([
      '--flow-file',
      tempFlowFile,
      '--lines',
      '5-8',
      '--dry-run',
    ])

    expect(result.score).toBeNull()
    expect(result.report.totalMutants).toBe(1)
    expect(result.report.mutants[0].status).toBe('Pending')
  })

  it('runs successfully in dry-run mode and reports mutants', async () => {
    const result = await FlowMutationRun.run([
      '--flow-file',
      tempFlowFile,
      '--dry-run',
    ])

    expect(result.score).toBeNull()
    expect(result.report.totalMutants).toBeGreaterThan(0)
    expect(result.report.mutants[0].status).toBe('Pending')
  })
})
