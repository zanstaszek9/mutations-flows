import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  findLocationInXml,
  FlowHTMLReporter,
  resolveMutantLocationAndReplacement,
} from '../../../src/flow/reporter/FlowHTMLReporter.js'
import type { FlowMutationReport } from '../../../src/flow/types.js'

describe('FlowHTMLReporter', () => {
  let tempDir: string
  let sampleFlowFile: string
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>67.0</apiVersion>
    <formulas>
        <name>TestFormula</name>
        <expression>'Hot'</expression>
    </formulas>
    <start>
        <object>Account</object>
        <recordTriggerType>Create</recordTriggerType>
        <triggerType>RecordAfterSave</triggerType>
    </start>
    <status>Active</status>
</Flow>`

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-report-test-'))
    sampleFlowFile = path.join(tempDir, 'Account_After.flow-meta.xml')
    await fs.writeFile(sampleFlowFile, sampleXml, 'utf-8')
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('findLocationInXml finds location by line and snippet', () => {
    const loc = findLocationInXml(sampleXml, 'Create', 10)
    expect(loc.start.line).toBe(10)
    expect(loc.start.column).toBeGreaterThan(1)
    expect(loc.end.column).toBe(loc.start.column + 'Create'.length)
  })

  it('findLocationInXml falls back across lines if line not specified', () => {
    const loc = findLocationInXml(sampleXml, 'TestFormula')
    expect(loc.start.line).toBe(5)
  })

  it('findLocationInXml fallback when snippet not found', () => {
    const loc = findLocationInXml(sampleXml, 'NON_EXISTENT_SNIPPET')
    expect(loc.start.line).toBe(1)
  })

  it('handles XML entity escaping &apos; properly for formula string literals', () => {
    const xmlWithEntities = `<?xml version="1.0" encoding="UTF-8"?>
<Flow>
    <expression>&apos;Hot&apos;</expression>
</Flow>`
    const res = resolveMutantLocationAndReplacement(
      xmlWithEntities,
      "'Hot'",
      "''",
      3
    )
    expect(res.location.start.line).toBe(3)
    expect(res.location.start.column).toBe(17)
    expect(res.location.end.column).toBe(32)
    expect(res.replacement).toBe('&apos;&apos;')
  })

  it('generates HTML report and index.html file', async () => {
    const reporter = new FlowHTMLReporter()
    const reportDir = path.join(tempDir, 'mutations')

    const sampleReport: FlowMutationReport = {
      flowFilePath: sampleFlowFile,
      totalMutants: 2,
      killed: 1,
      survived: 1,
      compileErrors: 0,
      mutationScore: 50,
      originalXml: sampleXml,
      mutants: [
        {
          id: 'FLOW-MUT-1',
          mutatorName: 'RecordTriggerTypeMutator',
          elementName: '$Start',
          description: "Changed recordTriggerType from 'Create' to 'Update'",
          originalSnippet: 'Create',
          mutatedSnippet: 'Update',
          mutatedXml: sampleXml.replace('Create', 'Update'),
          status: 'Killed',
          lineNumber: 9,
          killedBy: ['TestFlow1'],
        },
        {
          id: 'FLOW-MUT-2',
          mutatorName: 'FormulaExpressionMutator',
          elementName: 'TestFormula',
          description: "Replaced string literal 'Hot' with ''",
          originalSnippet: "'Hot'",
          mutatedSnippet: "''",
          mutatedXml: sampleXml.replace("'Hot'", "''"),
          status: 'Survived',
          lineNumber: 6,
        },
      ],
    }

    const output = await reporter.generateReport(sampleReport, reportDir)
    expect(output).toBe(path.resolve(reportDir))

    const htmlContent = await fs.readFile(
      path.join(reportDir, 'index.html'),
      'utf-8'
    )
    expect(htmlContent).toContain('<mutation-test-report-app')
    expect(htmlContent).toContain('Account_After.flow-meta.xml')
    expect(htmlContent).toContain('FLOW-MUT-1')
    expect(htmlContent).toContain('FLOW-MUT-2')
    expect(htmlContent).toContain('RecordTriggerTypeMutator')
  })
})
