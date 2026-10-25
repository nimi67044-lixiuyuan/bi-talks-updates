param([long]$WindowHandle)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BiMainAnimation {
 [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd,int attr,ref int value,int size);
 [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd,int attr,out int value,int size);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
}
'@
$handle=[IntPtr]$WindowHandle
if(-not [BiMainAnimation]::IsWindow($handle)){throw 'Bi-Talks window handle is invalid'}
$value=1
$result=[BiMainAnimation]::DwmSetWindowAttribute($handle,3,[ref]$value,4)
if($result -ne 0){throw "DWM animation setting failed: $result"}
$state=0
$read=[BiMainAnimation]::DwmGetWindowAttribute($handle,3,[ref]$state,4)
if($read -eq 0 -and $state -ne 1){throw 'DWM animation verification failed'}
Write-Output "Main window transitions disabled (DWM result $result; readback $read)."
