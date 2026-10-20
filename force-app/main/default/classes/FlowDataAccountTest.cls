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



}
