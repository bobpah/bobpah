# copy repo MQL5 sources into the tester data folder and compile with MetaEditor
$T = "C:\Users\User\Documents\Codex\2026-10-08\senior-quant-developer-mt5-reverse-behavior\research\ea_lab\testers\money-heist"
$L = "E:\ea\ea-lab\MQL5"
Copy-Item "$L\Include\JUED\*" "$T\MQL5\Include\JUED\" -Force
Copy-Item "$L\Experts\*.mq5" "$T\MQL5\Experts\" -Force
Copy-Item "$L\Presets\*.set" "$T\MQL5\Profiles\Tester\" -Force
foreach ($f in 'JUED_Core_Dashboard','JUED_Core_EA','MoneyHeist_Clone_v4') {
  Remove-Item "$T\MQL5\Experts\$f.log" -EA 0
  Start-Process "$T\MetaEditor64.exe" -ArgumentList '/portable', "/compile:`"$T\MQL5\Experts\$f.mq5`"", "/log:`"$T\MQL5\Experts\$f.log`"" -Wait
  "$f : " + ((Get-Content "$T\MQL5\Experts\$f.log" -Encoding Unicode | Select-String 'error|Result') -join ' | ')
}
