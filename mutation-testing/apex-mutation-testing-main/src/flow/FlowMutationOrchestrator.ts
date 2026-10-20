import * as fs from 'node:fs/promises'
import { FlowValidator } from './FlowValidator.js'
import { getDefaultFlowMutators } from './mutators/index.js'
import type {
  FlowMutant,
  FlowMutantStatus,
  FlowMutationReport,
  FlowMutator,
  FlowSalesforcePort,
  FlowTestRunResult,
} from './types.js'

export interface OrchestratorOptions {
  flowFilePath: string
  flowDeveloperName: string
  flowTests?: string[]
  lines?: string[]
  dryRun?: boolean
}

export class FlowMutationOrchestrator {
  private readonly mutators: FlowMutator[]

  public constructor(
    private readonly sfPort: FlowSalesforcePort,
    customMutators?: FlowMutator[]
  ) {
    this.mutators = customMutators ?? getDefaultFlowMutators()
  }

  public async run(options: OrchestratorOptions): Promise<FlowMutationReport> {
    const originalXml = await fs.readFile(options.flowFilePath, 'utf-8')

    // 1. Validate Flow metadata constraints (Record-Triggered or Autolaunched, no Pauses, no Screens)
    const validation = FlowValidator.validate(originalXml)
    if (!validation.isValid) {
      throw new Error(
        `Flow validation failed for ${options.flowDeveloperName}: ${validation.errorMessage}`
      )
    }

    // 2. Generate all candidate mutants
    let rawMutants = this.mutators.flatMap(m => m.mutate(originalXml))
    const allowedLines = this.parseLineRanges(options.lines)
    if (allowedLines) {
      rawMutants = rawMutants.filter(
        m => m.lineNumber === undefined || allowedLines.has(m.lineNumber)
      )
    }
    const mutants: FlowMutant[] = rawMutants.map((m, idx) => ({
      ...m,
      id: `FLOW-MUT-${idx + 1}`,
      status: 'Pending' as FlowMutantStatus,
    }))

    if (options.dryRun || mutants.length === 0) {
      return this.buildReport(options.flowFilePath, mutants)
    }

    // 3. Baseline check: verify original Flow deploys and baseline tests pass
    const baselineDeploy = await this.sfPort.deployFlowXml(
      options.flowFilePath,
      originalXml
    )
    if (!baselineDeploy.success) {
      throw new Error(
        `Baseline Flow deployment failed: ${baselineDeploy.errorMessage}`
      )
    }

    const baselineTests = await this.executeTests(options)
    if (!baselineTests.allPassed) {
      throw new Error(
        `Baseline tests failed before mutation started: ${baselineTests.failingMethods.join(', ')}`
      )
    }

    // 4. Execute mutation loop with guaranteed restoration in finally
    try {
      for (const mutant of mutants) {
        const deployResult = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          mutant.mutatedXml
        )

        if (!deployResult.success) {
          mutant.status = 'CompileError'
          continue
        }

        const testResult = await this.executeTests(options)
        if (!testResult.allPassed) {
          mutant.status = 'Killed'
          mutant.killedBy = testResult.failingMethods
        } else {
          mutant.status = 'Survived'
        }
      }
    } finally {
      // ALWAYS restore original Flow XML on disk and on the Org
      await fs.writeFile(options.flowFilePath, originalXml, 'utf-8')
      await this.sfPort.deployFlowXml(options.flowFilePath, originalXml)
    }

    return this.buildReport(options.flowFilePath, mutants)
  }

  private async executeTests(
    options: OrchestratorOptions
  ): Promise<FlowTestRunResult> {
    return this.sfPort.runFlowTests(
      options.flowDeveloperName,
      options.flowTests
    )
  }

  private parseLineRanges(lines?: string[]): Set<number> | undefined {
    if (!lines || lines.length === 0) {
      return undefined
    }
    const result = new Set<number>()
    for (const range of lines) {
      if (range.includes('-')) {
        const [start, end] = range.split('-').map(Number)
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) {
          throw new Error(`Invalid line range: '${range}'`)
        }
        for (let i = start; i <= end; i++) {
          result.add(i)
        }
      } else {
        const value = Number(range)
        if (!Number.isFinite(value)) {
          throw new Error(`Invalid line number: '${range}'`)
        }
        result.add(value)
      }
    }
    return result
  }

  private buildReport(
    flowFilePath: string,
    mutants: FlowMutant[]
  ): FlowMutationReport {
    const killed = mutants.filter(m => m.status === 'Killed').length
    const survived = mutants.filter(m => m.status === 'Survived').length
    const compileErrors = mutants.filter(
      m => m.status === 'CompileError'
    ).length
    const validTotal = killed + survived
    const mutationScore =
      validTotal > 0 ? Math.round((killed / validTotal) * 10000) / 100 : 0

    return {
      flowFilePath,
      totalMutants: mutants.length,
      killed,
      survived,
      compileErrors,
      mutationScore,
      mutants,
    }
  }
}
