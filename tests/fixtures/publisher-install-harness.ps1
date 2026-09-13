# Executes the real installer with inert Task Scheduler / credential doubles, then launches
# its captured Node action through Windows' native argument parser. No task is registered.
param(
    [string] $Installer,
    [string] $Scratch,
    [string] $LogonMode,
    [string] $CustomStateDir
)
$ErrorActionPreference = 'Stop'
$env:LOCALAPPDATA = Join-Path $Scratch 'Local App Data'
$env:PUBLISHER_ARGV_CAPTURE = Join-Path $Scratch 'argv.json'
$env:MD_PUBLISHER_TOKEN = 'fixture-token-never-in-command-line'
$capture = @{}

function Get-ScheduledTask { return $null }
function New-ScheduledTaskAction {
    param($Execute, $Argument, $WorkingDirectory)
    return @{ Execute = $Execute; Argument = $Argument; WorkingDirectory = $WorkingDirectory }
}
function New-ScheduledTaskTrigger { param([switch] $Once, $At, $RepetitionInterval) }
function New-ScheduledTaskPrincipal { param($UserId, $LogonType, $RunLevel); return @{ LogonType = $LogonType } }
function New-ScheduledTaskSettingsSet {
    param([switch] $AllowStartIfOnBatteries, [switch] $DontStopIfGoingOnBatteries,
        [switch] $StartWhenAvailable, $MultipleInstances, $ExecutionTimeLimit, $RestartCount, $RestartInterval)
}
function Get-Credential {
    param($UserName, $Message)
    $secure = New-Object System.Security.SecureString
    foreach ($character in 'fixture-password'.ToCharArray()) { $secure.AppendChar($character) }
    return New-Object System.Management.Automation.PSCredential($UserName, $secure)
}
function Register-ScheduledTask {
    param($TaskName, $Action, $Trigger, $Principal, $Settings, $Description, $User, $Password)
    $capture.Registration = @{
        TaskName = $TaskName; Action = $Action; LogonType = $Principal.LogonType
        ReceivedPassword = ($Password -eq 'fixture-password')
    }
}

Set-Location -LiteralPath $Scratch
$installOptions = @{ LogonMode = $LogonMode; User = 'TEST\publisher'; TaskName = 'Custom Publisher' }
if ($CustomStateDir) { $installOptions.StateDir = $CustomStateDir }
& $Installer @installOptions

$capture.Registration | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $Scratch 'registration.json') -Encoding utf8
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = $capture.Registration.Action.Execute
$start.Arguments = $capture.Registration.Action.Argument
$start.WorkingDirectory = $capture.Registration.Action.WorkingDirectory
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$process = [System.Diagnostics.Process]::Start($start)
$process.WaitForExit()
if ($process.ExitCode -ne 0) { throw "Captured action failed: $($process.ExitCode)" }
