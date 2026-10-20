 public with sharing class DiscountCalculator {                                            
        public static Decimal calculateDiscount(Decimal amount, Integer customerYears, Boolean
  isVip) {                                                                                    
            // 1. Walidacja danych wejściowych                                                
            if (amount == null || amount <= 0) {                                              
                return 0;                                                                     
            }                                                                                 
                                                                                              
            Decimal discount = 0;                                                             
                                                                                              
            // 2. Rabat kwotowy                                                               
            if (amount >= 1000) {                                                             
                discount += 10;                                                               
            } else if (amount >= 500) {                                                       
                discount += 5;                                                                
            }                                                                                 
                                                                                              
            // 3. Bonus lojalnościowy                                                         
            if (customerYears != null && customerYears >= 5) {                                
                discount += 5;                                                                
            }                                                                                 
                                                                                              
            // 4. Bonus VIP                                                                   
            if (isVip == true) {                                                              
                discount += 10;                                                               
            }                                                                                 
                                                                                              
            return discount;                                                                  
        }                                                                                     
    }                    