# summary

Run mutation testing on Salesforce Flow XML definitions using FlowTests

# description

Evaluate Flow test coverage and test suite quality by injecting mutations into a target Flow XML definition and executing FlowTests (via 'sf flow run test') to determine whether intentional bugs are detected (killed) or go undetected (survived).

Only Record-Triggered Flows and Autolaunched Flows without Pause elements can be tested.

# flags.flow-file.summary

Path to the target Flow XML file (*.flow-meta.xml) to mutate.

# flags.flow-name.summary

Developer name of the Flow. If omitted, it is inferred from the flow-file name.

# flags.flow-tests.summary

Specific flow test names to run (e.g., Flow1.Test1). Repeat the flag or pass a comma-separated list.

# flags.test-apex.summary

Specific Apex test classes to run against the Flow via 'sf logic run test' (e.g., DiscountCalculatorTest). Repeat the flag or pass a comma-separated list. Can also be specified as -ta.

# flags.dry-run.summary

Preview generated Flow mutants without deploying to an org or running tests.

# flags.lines.summary

Line numbers or ranges in the Flow XML to mutate (e.g. '10-25', '40'). Repeat the flag or pass multiple values.

# flags.threshold.summary

Minimum mutation score threshold (0-100). The command fails if the score is below this threshold.

# flags.report-dir.summary

Path to the directory where mutation test reports will be generated.

# info.reportGenerated

Report has been generated at this location: %s

# info.CommandIsRunning

Running mutation testing for Flow "%s" with test(s) "%s"

# info.ApexTestCommandIsRunning

Running mutation testing for Flow "%s" with Apex test class(es) "%s"

# info.DryRunCommandIsRunning

Running dry run mutation testing for Flow "%s"

# examples

- Preview generated mutations for a Flow without running tests:

  <%= config.bin %> <%= command.id %> --flow-file force-app/main/default/flows/Account_Before.flow-meta.xml --dry-run

- Run mutation testing for a Flow against its FlowTests on an org:

  <%= config.bin %> <%= command.id %> --flow-file force-app/main/default/flows/Account_Before.flow-meta.xml --target-org FlowTestPresentation

- Run mutation testing specifying specific FlowTests and line range:

  <%= config.bin %> <%= command.id %> --flow-file force-app/main/default/flows/Account_Before.flow-meta.xml --flow-tests Account_Before.Should_set_Rating_from_Parent --lines 45-65 --target-org FlowTestPresentation

- Run mutation testing using an Apex test class:

  <%= config.bin %> <%= command.id %> --flow-file force-app/main/default/flows/Account_After.flow-meta.xml -ta DiscountCalculatorTest --target-org Winter27
