@IsTest
global class FlowDataAccountTest {  // Class must be global to be visible in Flow Data Silo
  @TestSetup
  public static void testBehavior() { // TestSetup method must be public to be visible in Flow
    Account accountWarmParent = new Account(Name = 'Test Account Warm', Rating = 'Warm');
    Account accountFromMasovian = new Account(Name = 'Test Masovian Account', BillingState = 'Masovian');
    insert as system new List<Account>{accountWarmParent, accountFromMasovian};

    Account accountChild = new Account(Name = 'Test Account Child', ParentId = accountWarmParent.Id);
    insert as system new List<Account>{accountChild};

    List<Account> bulkTests = new List<Account>();
    for (Integer i = 0; i < 250; i++) {
      bulkTests.add(new Account(Name = 'Test Account Bulk ' + i, ParentId = accountWarmParent.Id));
    }
    insert as system bulkTests;
  }


//  @IsTest
//  private static void shouldCompile() { // When at least one Test is present, this class will be checked on deployments with `--test-level RunLocalTests`
//    List<SObject> testObjects = [SELECT Id FROM Account];
//    Assert.isTrue(!testObjects.isEmpty(), 'Test Setup compiles and creates record properly!');
//  }



}




/*
PS D:\sf-projects\flows-reimagined-presentation> sf project deploy start --source-dir "D:\sf-projects\flows-reimagined-presentation\force-app\main\default\classes\flowDataTests\FlowDataAccountTest.cls" --test-level RunLocalTests --target-org Winter27

 ─────────────── Deploying Metadata ───────────────

 Deploying v67.0 metadata to stanislaw.zan@cunning-fox-3k7qmc.com using the v67.0 SOAP API.

 ✔ Preparing 100ms
 ✔ Waiting for the org to respond 1.10s
 ✔ Deploying Metadata 1.20s
   ▸ Components: 1/1 (100%)
 ◯ Running Tests - Skipped
 ◯ Updating Source Tracking - Skipped
 ✔ Done 0ms

 Status: Succeeded
 Deploy ID: 0Afd200000U3cDxCAJ
 Target Org: stanislaw.zan@cunning-fox-3k7qmc.com
 Elapsed Time: 2.40s


Deployed Source
┌───────────┬─────────────────────┬───────────┬───────────────────────────────────────────────────────────────────────────────┐
│ State     │ Name                │ Type      │ Path                                                                          │
├───────────┼─────────────────────┼───────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Unchanged │ FlowDataAccountTest │ ApexClass │ force-app\main\default\classes\flowDataTests\FlowDataAccountTest.cls          │
│ Unchanged │ FlowDataAccountTest │ ApexClass │ force-app\main\default\classes\flowDataTests\FlowDataAccountTest.cls-meta.xml │
└───────────┴─────────────────────┴───────────┴───────────────────────────────────────────────────────────────────────────────┘


Test Results Summary
Passing: 0
Failing: 0
Total: 0
*
* */