#!/bin/bash
# usage: run_single.sh NAME EXPERT SETFILE PERIOD   (single Strategy Tester run, real ticks, HTML report)
T="/c/Users/User/Documents/Codex/2026-10-08/senior-quant-developer-mt5-reverse-behavior/research/ea_lab/testers/money-heist"
NAME=$1; EXPERT=$2; SET=$3; PER=$4
FROM=${FROM:-2026.07.16}; TO=${TO:-2026.10.16}; SYM=${SYM:-XAUUSD_QRS}
INI="$T/jued_$NAME.ini"
printf '[Tester]\r\nExpert=%s\r\nExpertParameters=%s\r\nSymbol=%s\r\nPeriod=%s\r\nModel=4\r\nExecutionMode=0\r\nOptimization=0\r\nFromDate=%s\r\nToDate=%s\r\nForwardMode=0\r\nDeposit=%s\r\nCurrency=USD\r\nLeverage=1:500\r\nReport=reports\jued_%s\r\nReplaceReport=1\r\nShutdownTerminal=1\r\nUseLocal=1\r\nUseRemote=0\r\nUseCloud=0\r\nVisual=0\r\n' "$EXPERT" "$SET" "$SYM" "$PER" "$FROM" "$TO" "${DEP:-10000}" "$NAME" > "$INI"
busy(){ powershell -NoProfile -Command "Get-Process terminal64 -EA 0 | ? { \$_.Path -like '*testers\money-heist*' }" | grep -q terminal64; }
while busy; do sleep 10; done
rm -f "$T/reports/jued_$NAME.htm"
"$T/terminal64.exe" /portable "/config:$(cygpath -w "$INI")"
sleep 10; while busy; do sleep 10; done
ls -la "$T/reports/jued_$NAME.htm" 2>&1
