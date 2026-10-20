import type { FlowMutant, FlowMutator } from '../types.js'
import { FlowXmlDom } from '../xml/FlowXmlDom.js'

const BYPASSABLE_TAGS = [
  'subflows',
  'recordCreates',
  'recordUpdates',
  'recordDeletes',
  'assignments',
  'actionCalls',
  'recordLookups',
]

export class ConnectorBypassMutator implements FlowMutator {
  public readonly name = 'ConnectorBypassMutator'

  public mutate(xmlContent: string): Omit<FlowMutant, 'id' | 'status'>[] {
    const results: Omit<FlowMutant, 'id' | 'status'>[] = []
    const baseDom = FlowXmlDom.parse(xmlContent)

    for (const tag of BYPASSABLE_TAGS) {
      const nodes = baseDom.queryNodes(`//sf:${tag}`)

      nodes.forEach(node => {
        const elementName = baseDom.getText('sf:name', node)
        const outgoingTarget = baseDom.getText(
          'sf:connector/sf:targetReference',
          node
        )

        // We can bypass a node if it has a known name and a downstream connector targetReference
        if (!elementName || !outgoingTarget) return

        // Find all incoming targetReferences pointing to this elementName
        const incomingRefs = baseDom.queryNodes(
          `//sf:targetReference[text()='${elementName}']`
        )

        if (incomingRefs.length === 0) return

        const clonedDom = FlowXmlDom.parse(xmlContent)
        const clonedIncomingRefs = clonedDom.queryNodes(
          `//sf:targetReference[text()='${elementName}']`
        )

        for (const refNode of clonedIncomingRefs) {
          refNode.textContent = outgoingTarget
        }

        const line = (node as unknown as { lineNumber?: number }).lineNumber

        results.push({
          mutatorName: this.name,
          elementName,
          lineNumber: line,
          description: `Bypassed ${tag} element '${elementName}' by rewiring incoming connectors directly to '${outgoingTarget}'`,
          originalSnippet: `<targetReference>${elementName}</targetReference>`,
          mutatedSnippet: `<targetReference>${outgoingTarget}</targetReference>`,
          mutatedXml: clonedDom.serialize(),
        })
      })
    }

    return results
  }
}
