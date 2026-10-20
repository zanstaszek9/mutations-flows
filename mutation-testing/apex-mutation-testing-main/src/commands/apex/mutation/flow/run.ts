import * as path from 'node:path'
import { Messages, SfError } from '@salesforce/core'
import { Flags, SfCommand } from '@salesforce/sf-plugins-core'
import { FlowSalesforceAdapter } from '../../../../flow/adapters/FlowSalesforceAdapter.js'
import { FlowMutationOrchestrator } from '../../../../flow/FlowMutationOrchestrator.js'
import type { FlowMutationReport } from '../../../../flow/types.js'

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url)
const messages = Messages.loadMessages(
  'apex-mutation-testing',
  'apex.mutation.flow.run'
)

export type FlowMutationRunResult = {
  score: number | null
  report: FlowMutationReport
}

export default class FlowMutationRun extends SfCommand<FlowMutationRunResult> {
  public static override readonly summary = messages.getMessage('summary')
  public static override readonly description =
    messages.getMessage('description')
  public static override readonly examples = messages.getMessages('examples')

  public static override readonly flags = {
    'flow-file': Flags.file({
      char: 'f',
      summary: messages.getMessage('flags.flow-file.summary'),
      required: true,
      exists: true,
    }),
    'flow-name': Flags.string({
      char: 'n',
      summary: messages.getMessage('flags.flow-name.summary'),
    }),
    'flow-tests': Flags.string({
      summary: messages.getMessage('flags.flow-tests.summary'),
      multiple: true,
      delimiter: ',',
    }),
    'dry-run': Flags.boolean({
      char: 'd',
      summary: messages.getMessage('flags.dry-run.summary'),
      default: false,
    }),
    lines: Flags.string({
      char: 'l',
      summary: messages.getMessage('flags.lines.summary'),
      multiple: true,
    }),
    threshold: Flags.integer({
      summary: messages.getMessage('flags.threshold.summary'),
      min: 0,
      max: 100,
    }),
    'target-org': Flags.optionalOrg(),
    'api-version': Flags.orgApiVersion(),
  }

  public async run(): Promise<FlowMutationRunResult> {
    const { flags } = await this.parse(FlowMutationRun)

    if (!flags['dry-run'] && !flags['target-org']) {
      throw new SfError(
        'Flag --target-org is required when not running with --dry-run.'
      )
    }

    const flowFilePath = path.resolve(flags['flow-file'])
    const flowDeveloperName =
      flags['flow-name'] ??
      path.basename(flowFilePath).replace(/\.flow(-meta\.xml)?$/, '')

    const orgUsername = flags['target-org']?.getUsername()
    const adapter = new FlowSalesforceAdapter(orgUsername)
    const orchestrator = new FlowMutationOrchestrator(adapter)

    this.log(
      `Starting Flow mutation testing for ${flowDeveloperName} (${flowFilePath})...`
    )

    const report = await orchestrator.run({
      flowFilePath,
      flowDeveloperName,
      flowTests: flags['flow-tests'],
      lines: flags.lines,
      dryRun: flags['dry-run'],
    })

    this.log('')
    this.log('Mutation Testing Results:')
    this.table({
      data: report.mutants.map(m => ({
        id: m.id,
        line: m.lineNumber ? String(m.lineNumber) : '-',
        element: m.elementName,
        mutator: m.mutatorName,
        status: m.status,
        description: m.description,
      })),
      columns: ['id', 'line', 'element', 'mutator', 'status', 'description'],
    })

    this.log('')
    this.log(`Total Mutants: ${report.totalMutants}`)
    this.log(`Killed:        ${report.killed}`)
    this.log(`Survived:      ${report.survived}`)
    this.log(`CompileErrors: ${report.compileErrors}`)
    this.log(
      `Mutation Score: ${
        flags['dry-run'] ? 'N/A (Dry Run)' : `${report.mutationScore}%`
      }`
    )

    if (
      !flags['dry-run'] &&
      flags.threshold !== undefined &&
      report.mutationScore < flags.threshold
    ) {
      throw new SfError(
        `Mutation score ${report.mutationScore}% is below threshold ${flags.threshold}%.`
      )
    }

    return {
      score: flags['dry-run'] ? null : report.mutationScore,
      report,
    }
  }
}
