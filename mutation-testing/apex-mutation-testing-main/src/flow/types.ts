export type FlowMutantStatus =
  | 'Pending'
  | 'Killed'
  | 'Survived'
  | 'CompileError'

export interface FlowMutant {
  id: string
  mutatorName: string
  elementName: string
  description: string
  originalSnippet: string
  mutatedSnippet: string
  mutatedXml: string
  status: FlowMutantStatus
  lineNumber?: number
  killedBy?: string[]
}

export interface FlowMutator {
  readonly name: string
  mutate(xmlContent: string): Omit<FlowMutant, 'id' | 'status'>[]
}

export interface FlowDeployResult {
  success: boolean
  errorMessage?: string
}

export interface FlowTestRunResult {
  allPassed: boolean
  failingMethods: string[]
}

export interface FlowSalesforcePort {
  deployFlowXml(
    flowFilePath: string,
    xmlContent: string
  ): Promise<FlowDeployResult>
  runFlowTests(
    flowName: string,
    testNames?: string[]
  ): Promise<FlowTestRunResult>
}

export interface FlowMutationReport {
  flowFilePath: string
  totalMutants: number
  killed: number
  survived: number
  compileErrors: number
  mutationScore: number
  mutants: FlowMutant[]
}
