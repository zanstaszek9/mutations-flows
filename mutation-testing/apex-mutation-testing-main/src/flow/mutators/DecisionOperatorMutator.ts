import type { FlowMutant, FlowMutator } from '../types.js'
import { FlowXmlDom } from '../xml/FlowXmlDom.js'

const OPERATOR_INVERSIONS: Record<string, string> = {
  EqualTo: 'NotEqualTo',
  NotEqualTo: 'EqualTo',
  GreaterThan: 'LessThanOrEqualTo',
  LessThanOrEqualTo: 'GreaterThan',
  LessThan: 'GreaterThanOrEqualTo',
  GreaterThanOrEqualTo: 'LessThan',
}

export class DecisionOperatorMutator implements FlowMutator {
  public readonly name = 'DecisionOperatorMutator'

  public mutate(xmlContent: string): Omit<FlowMutant, 'id' | 'status'>[] {
    const results: Omit<FlowMutant, 'id' | 'status'>[] = []
    const baseDom = FlowXmlDom.parse(xmlContent)
    const decisionNodes = baseDom.queryNodes('//sf:decisions')

    decisionNodes.forEach((decisionNode, dIdx) => {
      const decisionName =
        baseDom.getText('sf:name', decisionNode) ?? `Decision_${dIdx}`
      const operatorNodes = baseDom.queryNodes(
        './/sf:conditions/sf:operator',
        decisionNode
      )

      operatorNodes.forEach((opNode, opIdx) => {
        const currentOp = opNode.textContent?.trim()
        if (!currentOp) return
        const invertedOp = OPERATOR_INVERSIONS[currentOp]
        if (!invertedOp) return

        const clonedDom = FlowXmlDom.parse(xmlContent)
        const targetDecision = clonedDom.queryNodes('//sf:decisions')[dIdx]
        const targetOpNode = clonedDom.queryNodes(
          './/sf:conditions/sf:operator',
          targetDecision
        )[opIdx]
        targetOpNode.textContent = invertedOp

        const line = (opNode as unknown as { lineNumber?: number }).lineNumber

        results.push({
          mutatorName: this.name,
          elementName: decisionName,
          lineNumber: line,
          description: `Inverted condition operator '${currentOp}' to '${invertedOp}' in decision '${decisionName}'`,
          originalSnippet: `<operator>${currentOp}</operator>`,
          mutatedSnippet: `<operator>${invertedOp}</operator>`,
          mutatedXml: clonedDom.serialize(),
        })
      })
    })

    return results
  }
}
