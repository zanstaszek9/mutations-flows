import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { FlowValidator } from './FlowValidator.js'
import { getDefaultFlowMutators } from './mutators/index.js'
import type {
  FlowMutant,
  FlowMutantStatus,
  FlowMutationReport,
  FlowMutator,
  FlowOrchestratorCallbacks,
  FlowSalesforcePort,
  FlowTestRunResult,
} from './types.js'

export interface OrchestratorOptions {
  flowFilePath: string
  flowDeveloperName: string
  flowTests?: string[]
  apexTests?: string[]
  lines?: string[]
  dryRun?: boolean
  callbacks?: FlowOrchestratorCallbacks
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
    options.callbacks?.onValidating?.()
    const validation = FlowValidator.validate(originalXml)
    if (!validation.isValid) {
      throw new Error(
        `Flow validation failed for ${options.flowDeveloperName}: ${validation.errorMessage}`
      )
    }
    options.callbacks?.onValidated?.()

    // 2. Generate all candidate mutants
    options.callbacks?.onMutantsGenerating?.()
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
    options.callbacks?.onMutantsGenerated?.(mutants.length)

    if (options.dryRun || mutants.length === 0) {
      return this.buildReport(options.flowFilePath, mutants, originalXml)
    }

    // 3. Handle Flow versioning (Salesforce 50 FlowVersions limit workaround)
    const isOriginallyActive = /<status>\s*Active\s*<\/status>/i.test(
      originalXml
    )
    const originalFlowTestContents = new Map<string, string>()
    let tempDraftFlowId: string | undefined

    try {
      if (isOriginallyActive) {
        // Step A: Deactivate active flow
        const deactivatedXml = originalXml.replace(
          /<status>\s*Active\s*<\/status>/i,
          '<status>Draft</status>'
        )
        const deactDeploy = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          deactivatedXml
        )
        if (!deactDeploy.success) {
          throw new Error(
            `Failed to deactivate active Flow "${options.flowDeveloperName}": ${deactDeploy.errorMessage}`
          )
        }

        // Step B: Trigger a new FlowVersion by modifying flow description
        let triggerNewVersionXml: string
        if (/<description>[\s\S]*?<\/description>/i.test(deactivatedXml)) {
          triggerNewVersionXml = deactivatedXml.replace(
            /<description>([\s\S]*?)<\/description>/i,
            (_, desc) => `<description>${desc} Mutating</description>`
          )
        } else {
          triggerNewVersionXml = deactivatedXml.replace(
            /<status>/i,
            '<description>Mutating</description>\n    <status>'
          )
        }
        const triggerDeploy = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          triggerNewVersionXml
        )
        if (!triggerDeploy.success) {
          throw new Error(
            `Failed to create draft Flow version for "${options.flowDeveloperName}": ${triggerDeploy.errorMessage}`
          )
        }

        // Step C: Query latest FlowVersion number from org
        const latest = await this.sfPort.getLatestFlowVersion(
          options.flowDeveloperName
        )
        const newVersionNumber = latest.versionNumber
        tempDraftFlowId = latest.flowId

        // Step D: Update FlowTests pointing to this Flow with new version number
        const flowTestFiles = await this.findFlowTestFiles(
          options.flowFilePath,
          options.flowDeveloperName
        )
        const updatedFlowTestFiles: string[] = []
        for (const ftPath of flowTestFiles) {
          const ftContent = await fs.readFile(ftPath, 'utf-8')
          originalFlowTestContents.set(ftPath, ftContent)
          const updatedContent = ftContent.replace(
            /<flowVersionNumber>\s*\d+\s*<\/flowVersionNumber>/g,
            `<flowVersionNumber>${newVersionNumber}</flowVersionNumber>`
          )
          await fs.writeFile(ftPath, updatedContent, 'utf-8')
          updatedFlowTestFiles.push(ftPath)
        }

        if (updatedFlowTestFiles.length > 0) {
          const ftDeploy = await this.sfPort.deployFiles(updatedFlowTestFiles)
          if (!ftDeploy.success) {
            throw new Error(
              `Failed to deploy updated FlowTests: ${ftDeploy.errorMessage}`
            )
          }
        }
      } else {
        // Flow is already Draft: verify original Flow deploys
        options.callbacks?.onBaselineDeploying?.()
        const baselineDeploy = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          originalXml
        )
        if (!baselineDeploy.success) {
          throw new Error(
            `Baseline Flow deployment failed: ${baselineDeploy.errorMessage}`
          )
        }
        options.callbacks?.onBaselineDeployed?.()
      }

      // 4. Baseline check: verify baseline tests pass
      options.callbacks?.onBaselineTesting?.()
      const baselineTests = await this.executeTests(options)
      if (!baselineTests.allPassed) {
        throw new Error(
          `Baseline tests failed before mutation started: ${baselineTests.failingMethods.join(', ')}`
        )
      }
      options.callbacks?.onBaselineTested?.('Original tests passed')

      // 5. Execute mutation loop
      options.callbacks?.onProgressStart?.(mutants.length)
      for (let i = 0; i < mutants.length; i++) {
        const mutant = mutants[i]
        let mutantXml = mutant.mutatedXml
        if (isOriginallyActive) {
          mutantXml = mutantXml.replace(
            /<status>\s*Active\s*<\/status>/i,
            '<status>Draft</status>'
          )
        }

        const deployResult = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          mutantXml
        )

        if (!deployResult.success) {
          mutant.status = 'CompileError'
        } else {
          const testResult = await this.executeTests(options)
          if (!testResult.allPassed) {
            mutant.status = 'Killed'
            mutant.killedBy = testResult.failingMethods
          } else {
            mutant.status = 'Survived'
          }
        }
        options.callbacks?.onProgressUpdate?.(
          i + 1,
          `${mutant.id} evaluated (${mutant.status})`
        )
      }
      options.callbacks?.onProgressFinish?.('All mutations evaluated')
    } finally {
      // 6. ALWAYS restore original Flow XML and original FlowTests on disk and on the Org
      options.callbacks?.onRollbackStarting?.()
      let rollbackFailed = false
      try {
        await fs.writeFile(options.flowFilePath, originalXml, 'utf-8')
        const flowRollback = await this.sfPort.deployFlowXml(
          options.flowFilePath,
          originalXml
        )
        if (!flowRollback.success) {
          rollbackFailed = true
        }

        if (originalFlowTestContents.size > 0) {
          const ftPaths: string[] = []
          for (const [
            ftPath,
            ftContent,
          ] of originalFlowTestContents.entries()) {
            await fs.writeFile(ftPath, ftContent, 'utf-8')
            ftPaths.push(ftPath)
          }
          const ftRollback = await this.sfPort.deployFiles(ftPaths)
          if (!ftRollback.success) {
            rollbackFailed = true
          }
        }

        if (tempDraftFlowId && this.sfPort.deleteFlowVersion) {
          try {
            await this.sfPort.deleteFlowVersion(tempDraftFlowId)
          } catch {
            // Best-effort cleanup
          }
        }
      } catch {
        rollbackFailed = true
      } finally {
        options.callbacks?.onRollbackFinished?.(rollbackFailed)
      }
    }

    return this.buildReport(options.flowFilePath, mutants, originalXml)
  }

  private async findFlowTestFiles(
    flowFilePath: string,
    flowApiName: string
  ): Promise<string[]> {
    const matchingFiles: string[] = []
    const candidateDirs: string[] = []

    const flowDir = path.dirname(flowFilePath)
    const siblingFlowTestsDir = path.resolve(flowDir, '../flowtests')
    try {
      const stat = await fs.stat(siblingFlowTestsDir)
      if (stat.isDirectory()) {
        candidateDirs.push(siblingFlowTestsDir)
      }
    } catch {
      // Sibling flowtests folder doesn't exist
    }

    const projectRoot = path.resolve(flowDir, '../../..')
    const defaultFlowTestsDir = path.resolve(
      projectRoot,
      'force-app/main/default/flowtests'
    )
    if (!candidateDirs.includes(defaultFlowTestsDir)) {
      try {
        const stat = await fs.stat(defaultFlowTestsDir)
        if (stat.isDirectory()) {
          candidateDirs.push(defaultFlowTestsDir)
        }
      } catch {
        // Root flowtests folder doesn't exist
      }
    }

    for (const dir of candidateDirs) {
      try {
        const files = await fs.readdir(dir)
        for (const file of files) {
          if (file.endsWith('.flowtest-meta.xml')) {
            const fullPath = path.join(dir, file)
            const content = await fs.readFile(fullPath, 'utf-8')
            if (content.includes(`<flowApiName>${flowApiName}</flowApiName>`)) {
              matchingFiles.push(fullPath)
            }
          }
        }
      } catch {
        // Skip directory read errors
      }
    }

    return matchingFiles
  }

  private async executeTests(
    options: OrchestratorOptions
  ): Promise<FlowTestRunResult> {
    if (options.apexTests && options.apexTests.length > 0) {
      return this.sfPort.runApexTests(options.apexTests)
    }
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
    mutants: FlowMutant[],
    originalXml?: string
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
      originalXml,
    }
  }
}
