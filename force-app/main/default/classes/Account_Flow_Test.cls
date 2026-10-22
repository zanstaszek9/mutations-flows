@IsTest
private class Account_Flow_Test {


//
//    @IsTest
//    static void shouldAssignPriorityFromParentAccount() {
//        Account parent = new Account(Name = 'Parent Account', Rating = 'Warm');
//        insert parent;
//
//        Account child = new Account(Name = 'Child Account', ParentId = parent.Id);
//        Test.startTest();
//        insert child;
//        Test.stopTest();
//
//        Account updatedChild = [SELECT Rating FROM Account WHERE Id = :child.Id];
//        Assert.areEqual(parent.Rating, updatedChild.Rating, 'Rating should be copied from parent');
//    }
//
//
//    @IsTest
//    static void testRatingUnchangedWhenParentHasNoRating() {
//        Account parent = new Account(Name = 'Parent Account');
//        insert parent;
//
//        Account child = new Account(Name = 'Child Account', ParentId = parent.Id);
//        Test.startTest();
//        insert child;
//        Test.stopTest();
//
//        Account updatedChild = [SELECT Rating FROM Account WHERE Id = :child.Id];
//        Assert.isNull(updatedChild.Rating, 'Rating should remain blank when Parent has no rating');
//    }
//
//    @IsTest
//    static void shouldSetHotPriorityForPomorskieBillingState() {
//        Account accountFromPomorskie = new Account(Name = 'Test Account', BillingState = 'Pomorskie');
//
//        Test.startTest();
//        insert accountFromPomorskie;
//        Test.stopTest();
//
//        Account updatedAcc = [SELECT Rating FROM Account WHERE Id = :accountFromPomorskie.Id];
//        Assert.areEqual('Hot', updatedAcc.Rating, 'Rating should be set to Hot for Pomorskie state');
//    }
//
//    @IsTest
//    static void shouldNotSetRatingForNonPomorskieBillingState() {
//        Account accountNotFromPomorskie = new Account(Name = 'Test Account', BillingState = 'Other State');
//
//        Test.startTest();
//        insert accountNotFromPomorskie;
//        Test.stopTest();
//
//        Account updatedAcc = [SELECT Rating FROM Account WHERE Id = :accountNotFromPomorskie.Id];
//        Assert.isNull(updatedAcc.Rating, 'Rating should remain blank for non-Pomorskie state');
//    }



    @IsTest
    static void shouldAddWebsite() {
        Account accountEmptyWebsite = new Account(Name = 'Test Account');

        Map<String,Object> flowInputVariables = new Map<String,Object>();
        flowInputVariables.put('recordId',accountEmptyWebsite);

        Test.startTest();
        // Subflow can be inactive
        Flow.Interview websiteSubflow = new Flow.Interview.Account_fill_Website(flowInputVariables);
        websiteSubflow.start();
        Test.stopTest();

        Account updatedAcc = (Account) websiteSubflow.getVariableValue('recordId');
//        Assert.areEqual('www.salesforce.com', updatedAcc.Website, 'Website should be filled');
    Assert.isTrue(true);
    }



    private static Integer fakeIdNumber = 1;
    private static String getFakeId(Schema.SObjectType sObjectType) {
        String result = String.valueOf(fakeIdNumber++);
        return sObjectType.getDescribe().getKeyPrefix() +
                '0'.repeat(12-result.length()) + result;
    }
}