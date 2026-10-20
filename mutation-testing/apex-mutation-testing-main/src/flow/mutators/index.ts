import type { FlowMutator } from '../types.js'
import { ConnectorBypassMutator } from './ConnectorBypassMutator.js'
import { DecisionOperatorMutator } from './DecisionOperatorMutator.js'
import { FormulaExpressionMutator } from './FormulaExpressionMutator.js'
import { RecordTriggerTypeMutator } from './RecordTriggerTypeMutator.js'

export {
  ConnectorBypassMutator,
  DecisionOperatorMutator,
  FormulaExpressionMutator,
  RecordTriggerTypeMutator,
}

export function getDefaultFlowMutators(): FlowMutator[] {
  return [
    new RecordTriggerTypeMutator(),
    new FormulaExpressionMutator(),
    new ConnectorBypassMutator(),
    new DecisionOperatorMutator(),
  ]
}
