#!/bin/bash
cd /e/ea/ea-lab/tests
bash run_single.sh core_m15 JUED_Core_EA "" M15
bash run_single.sh orig_m1 "Money Heist (1)" bb.set M1
bash run_single.sh clone_m1 MoneyHeist_Clone_v4 MoneyHeist_Clone_v4.set M1
bash run_single.sh orig_m5 "Money Heist (1)" bb.set M5
bash run_single.sh clone_m5 MoneyHeist_Clone_v4 MoneyHeist_Clone_v4.set M5
echo BATCH1_DONE
