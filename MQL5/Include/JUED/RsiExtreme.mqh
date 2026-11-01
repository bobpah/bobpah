//+------------------------------------------------------------------+
//|  JUED/RsiExtreme.mqh                                              |
//|  Shared signal rule for the RSI-extreme scalping technique       |
//|  (used by JUED_RSI_Extreme indicator and JUED_RSI_Scalper EA so  |
//|  arrows on the chart and EA entries are always identical).       |
//|                                                                  |
//|  Inputs are values of ONE closed bar (index 0 = that bar,        |
//|  index 1 = the bar before it).                                   |
//+------------------------------------------------------------------+
#ifndef JUED_RSI_EXTREME_MQH
#define JUED_RSI_EXTREME_MQH

enum ENUM_RSIX_CONFIRM
{
   RSIX_TOUCH     = 0, // RSI touches the extreme level
   RSIX_MACD_TURN = 1, // RSI at extreme + MACD histogram turns (momentum peak)
   RSIX_RSI_EXIT  = 2  // RSI leaves the extreme zone again (safest, latest)
};

// returns  1 = BUY signal, -1 = SELL signal, 0 = none
int RsiExtremeSignal(const double rsi0, const double rsi1,
                     const double hist0, const double hist1,
                     const double sellLevel, const double buyLevel,
                     const ENUM_RSIX_CONFIRM mode)
{
   switch(mode)
   {
      case RSIX_TOUCH:
         if(rsi0 >= sellLevel && rsi1 < sellLevel) return -1;
         if(rsi0 <= buyLevel  && rsi1 > buyLevel)  return  1;
         break;

      case RSIX_MACD_TURN:
         // first bar where momentum stops growing while RSI is still extreme
         if(rsi0 >= sellLevel && hist0 < hist1 && hist1 > 0) return -1;
         if(rsi0 <= buyLevel  && hist0 > hist1 && hist1 < 0) return  1;
         break;

      case RSIX_RSI_EXIT:
         if(rsi1 >= sellLevel && rsi0 < sellLevel) return -1;
         if(rsi1 <= buyLevel  && rsi0 > buyLevel)  return  1;
         break;
   }
   return 0;
}

#endif // JUED_RSI_EXTREME_MQH
//+------------------------------------------------------------------+
