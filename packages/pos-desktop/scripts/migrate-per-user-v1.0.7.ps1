#requires -Version 5.1
<#
.SYNOPSIS
    Migration CONTROLEE d'une caisse "The Wesley's POS" de l'installation
    per-machine (C:\Program Files\@caissepos-desktop, v1.0.6) vers l'installation
    per-user silencieuse (%LOCALAPPDATA%\Programs\@caissepos-desktop, v1.0.7+).

    A executer MANUELLEMENT, UNE SEULE FOIS par poste, par un administrateur.
    A partir de la v1.0.7 per-user, toutes les MAJ suivantes sont automatiques
    et silencieuses : ce script n'est plus jamais necessaire.

.DESCRIPTION
    Securite par conception :
      * DRY-RUN par defaut : n'ecrit / desinstalle / installe RIEN sans -Execute.
      * Sauvegarde de %APPDATA%\@caisse AVANT toute desinstallation.
      * Ne SUPPRIME JAMAIS %APPDATA%\@caisse (donnees terminal : sessions,
        machine-id, journaux peripheriques). La donnee survit a la migration.
      * S'ARRETE immediatement si une condition est ambigue (0 ou >1 install
        detectee, installeur introuvable, desinstalleur manquant, non-admin).
      * Journal complet horodate.
      * Verifie la version ET le chemin final, et qu'AUCUNE seconde copie ne
        subsiste.
      * Reversible : la copie per-machine n'est retiree qu'APRES sauvegarde ;
        rollback = reinstaller la v1.0.6 (les donnees n'ont pas ete touchees).

.PARAMETER Installer
    Chemin vers l'installeur per-user v1.0.7 (The-Wesleys-POS-Setup-x64.exe issu
    de la build oneClick / perMachine:false). Obligatoire pour -Execute.

.PARAMETER Execute
    Effectue reellement backup + desinstallation + installation. Sans ce flag,
    le script se contente d'auditer et d'afficher le plan (dry-run).

.PARAMETER BackupRoot
    Dossier racine des sauvegardes. Defaut : %USERPROFILE%\pos-migration-backup.

.EXAMPLE
    # 1) Audit seul (ne change rien) :
    powershell -ExecutionPolicy Bypass -File .\migrate-per-user-v1.0.7.ps1

.EXAMPLE
    # 2) Migration reelle (admin) :
    powershell -ExecutionPolicy Bypass -File .\migrate-per-user-v1.0.7.ps1 -Execute -Installer "D:\releases\The-Wesleys-POS-Setup-x64.exe"
#>
[CmdletBinding()]
param(
    [string] $Installer,
    [switch] $Execute,
    [string] $BackupRoot = (Join-Path $env:USERPROFILE 'pos-migration-backup')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# -- Constantes de decouverte ---------------------------------------------
$AppName        = "The Wesley's POS"
$InstallLeaf    = '@caissepos-desktop'
$ExeLeaf        = "The Wesley's POS.exe"
$ExpectedNewVer = '1.0.7'
$AppDataDir     = Join-Path $env:APPDATA '@caisse'          # NE JAMAIS SUPPRIMER
$PerUserRoot    = Join-Path $env:LOCALAPPDATA 'Programs'
$PerUserDir     = Join-Path $PerUserRoot $InstallLeaf
$PerMachineDir  = Join-Path ${env:ProgramFiles} $InstallLeaf
$PerMachineExe  = Join-Path $PerMachineDir $ExeLeaf
$PerUserExe     = Join-Path $PerUserDir    $ExeLeaf

# -- Journal --------------------------------------------------------------
$stamp   = (Get-Date).ToString('yyyyMMdd-HHmmss')
$logDir  = Join-Path $BackupRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "migrate-$stamp.log"

function Log {
    param([string]$Level, [string]$Msg)
    $line = '[{0}] [{1}] {2}' -f (Get-Date).ToString('s'), $Level, $Msg
    $line | Tee-Object -FilePath $logFile -Append
}
function Info { param($m) Log 'INFO' $m }
function Warn { param($m) Log 'WARN' $m }
function Ok   { param($m) Log 'OK'   $m }
function Stop-Migration {
    param($m)
    Log 'STOP' $m
    Log 'STOP' "Migration interrompue - aucune action destructive poursuivie. Journal : $logFile"
    exit 2
}

$mode = if ($Execute) { 'EXECUTE' } else { 'DRY-RUN' }
Info "=== Migration per-user v$ExpectedNewVer - mode $mode ==="
Info "Poste=$env:COMPUTERNAME User=$env:USERNAME Log=$logFile"
Info "GARANTIE : %APPDATA%\@caisse ($AppDataDir) ne sera JAMAIS supprime."

# -- 0) Elevation (requise seulement pour desinstaller une install per-machine)
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
Info "Contexte administrateur : $isAdmin"

# -- 1) Inventaire (registre, dossiers, process, raccourcis) ---------------
Info '--- Inventaire ---'

function Prop {
    # Acces defensif : renvoie $null si la propriete registre est absente
    # (sous StrictMode, un acces direct a une propriete manquante leverait).
    param($Obj, [string]$Name)
    $p = $Obj.PSObject.Properties[$Name]
    if ($p) { $p.Value } else { $null }
}

function Get-Uninstall {
    param([string]$Hive)  # 'HKLM' | 'HKCU'
    $roots = @(
        "$($Hive):\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "$($Hive):\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($r in $roots) {
        Get-ItemProperty $r -ErrorAction SilentlyContinue |
            Where-Object { (Prop $_ 'DisplayName') -match [regex]::Escape($AppName) } |
            ForEach-Object {
                [pscustomobject]@{
                    Hive            = $Hive
                    DisplayName     = (Prop $_ 'DisplayName')
                    DisplayVersion  = (Prop $_ 'DisplayVersion')
                    InstallLocation = (Prop $_ 'InstallLocation')
                    UninstallString = (Prop $_ 'UninstallString')
                    KeyPath         = $_.PSPath
                }
            }
    }
}

$hklm = @(Get-Uninstall 'HKLM')
$hkcu = @(Get-Uninstall 'HKCU')
Info ('HKLM (per-machine) : {0} entree(s)' -f $hklm.Count)
$hklm | ForEach-Object { Info ("  - {0} v{1} loc='{2}'" -f $_.DisplayName, $_.DisplayVersion, $_.InstallLocation) }
Info ('HKCU (per-user)    : {0} entree(s)' -f $hkcu.Count)
$hkcu | ForEach-Object { Info ("  - {0} v{1} loc='{2}'" -f $_.DisplayName, $_.DisplayVersion, $_.InstallLocation) }

Info ('Dossier per-machine : {0} (exe present={1})' -f $PerMachineDir, (Test-Path $PerMachineExe))
Info ('Dossier per-user    : {0} (exe present={1})' -f $PerUserDir,    (Test-Path $PerUserExe))

$procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$InstallLeaf*" })
Info ('Process POS en cours : {0}' -f $procs.Count)

# Raccourcis
$shortcutDirs = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
    (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs')
)
$wsh = New-Object -ComObject WScript.Shell
$shortcuts = foreach ($d in $shortcutDirs) {
    if (Test-Path $d) {
        Get-ChildItem $d -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
            $t = $wsh.CreateShortcut($_.FullName).TargetPath
            if ($t -like "*$InstallLeaf*" -or $t -like "*$ExeLeaf*") {
                [pscustomobject]@{ Link = $_.FullName; Target = $t }
            }
        }
    }
}
$shortcuts = @($shortcuts)
Info ('Raccourcis pointant vers app : {0}' -f $shortcuts.Count)
$shortcuts | ForEach-Object { Info ('  - {0} -> {1}' -f $_.Link, $_.Target) }

# -- 2) Garde-fous d'ambiguite --------------------------------------------
Info '--- Verifications de surete ---'
if (-not (Test-Path $AppDataDir)) {
    Warn "Dossier de donnees $AppDataDir introuvable : caisse jamais lancee ? A confirmer AVANT de continuer."
    Stop-Migration 'Donnees terminal absentes - situation ambigue, arret.'
}
if ($hklm.Count -eq 0 -and (Test-Path $PerUserExe)) {
    Ok 'Deja en per-user, aucune install per-machine. Rien a migrer.'
    exit 0
}
if ($hklm.Count -ne 1) {
    Stop-Migration "Attendu : exactement 1 install per-machine a retirer. Trouve : $($hklm.Count). Arret."
}
$target = $hklm[0]
if ([string]::IsNullOrWhiteSpace($target.UninstallString)) {
    Stop-Migration "UninstallString manquant pour '$($target.DisplayName)'. Desinstallation non deterministe. Arret."
}

if ($Execute) {
    if (-not $isAdmin) {
        Stop-Migration 'Desinstaller une install per-machine exige des droits administrateur. Relancer en admin.'
    }
    if ([string]::IsNullOrWhiteSpace($Installer) -or -not (Test-Path $Installer)) {
        Stop-Migration "Installeur v$ExpectedNewVer introuvable (param -Installer). Arret avant toute desinstallation."
    }
}

# -- 3) Plan --------------------------------------------------------------
Info '--- Plan de migration ---'
Info "1. Sauvegarder $AppDataDir -> $BackupRoot\appdata-$stamp (COPIE, jamais deplacement)"
Info "2. Fermer les process POS ($($procs.Count))"
Info "3. Desinstaller (silencieux) : $($target.DisplayName) v$($target.DisplayVersion) [$($target.Hive)]"
Info "4. Installer (silencieux) v$ExpectedNewVer per-user depuis : $Installer"
Info "5. Verifier : chemin=$PerUserDir version=$ExpectedNewVer HKLM vide 1 copie raccourcis a jour"

if (-not $Execute) {
    Warn 'DRY-RUN : aucune action effectuee. Relancer avec -Execute -Installer <exe> pour appliquer.'
    Ok "Audit termine. Journal : $logFile"
    exit 0
}

# -- 4) Sauvegarde (COPIE) ------------------------------------------------
Info '--- Sauvegarde des donnees ---'
$backupDir = Join-Path $BackupRoot "appdata-$stamp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item -Path $AppDataDir -Destination $backupDir -Recurse -Force
$srcCount = @(Get-ChildItem $AppDataDir -Recurse -File -ErrorAction SilentlyContinue).Count
$dstCount = @(Get-ChildItem $backupDir  -Recurse -File -ErrorAction SilentlyContinue).Count
Info "Fichiers source=$srcCount sauvegardes=$dstCount"
if ($dstCount -lt $srcCount) {
    Stop-Migration "Sauvegarde incomplete ($dstCount/$srcCount). On NE desinstalle PAS. Donnees intactes."
}
Ok "Sauvegarde verifiee : $backupDir"

# -- 5) Fermeture des process ---------------------------------------------
if ($procs.Count -gt 0) {
    Info 'Fermeture des instances POS...'
    $procs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    if (@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*$InstallLeaf*" }).Count -gt 0) {
        Stop-Migration 'Des process POS refusent de se fermer. Arret avant desinstallation.'
    }
    Ok 'Process POS fermes.'
}

# -- 6) Desinstallation per-machine (silencieuse) -------------------------
Info '--- Desinstallation per-machine ---'
# UninstallString electron-builder = "<dir>\Uninstall The Wesley's POS.exe". /S = silencieux.
$uninst = $target.UninstallString.Trim('"')
if (-not (Test-Path $uninst)) { Stop-Migration "Desinstalleur introuvable sur disque : $uninst" }
Info "Execution : $uninst /S"
$p = Start-Process -FilePath $uninst -ArgumentList '/S' -Wait -PassThru
Info "Code de sortie desinstalleur : $($p.ExitCode)"
Start-Sleep -Seconds 3

if (@(Get-Uninstall 'HKLM').Count -ne 0) {
    Stop-Migration "L'entree HKLM persiste apres desinstallation. Verifier manuellement (sauvegarde : $backupDir)."
}
if (Test-Path $PerMachineExe) {
    Warn "Le binaire per-machine subsiste ($PerMachineExe). Nettoyage residuel a faire manuellement."
}
Ok 'Install per-machine retiree (entree registre absente).'

# GARANTIE donnees : jamais touche %APPDATA%\@caisse
if (-not (Test-Path $AppDataDir)) {
    Stop-Migration "ALERTE : $AppDataDir a disparu apres desinstallation. Restaurer depuis $backupDir AVANT de continuer."
}
Ok "Donnees terminal intactes : $AppDataDir"

# -- 7) Installation per-user (silencieuse) -------------------------------
Info "--- Installation per-user v$ExpectedNewVer ---"
# Installeur oneClick -> /S silencieux, per-user (aucune elevation requise).
$pi = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
Info "Code de sortie installeur : $($pi.ExitCode)"
Start-Sleep -Seconds 5

# -- 8) Verification finale -----------------------------------------------
Info '--- Verification finale ---'
if (-not (Test-Path $PerUserExe)) {
    Stop-Migration "Binaire per-user absent apres install : $PerUserExe. Rollback conseille (reinstaller v1.0.6)."
}
$ver = (Get-Item $PerUserExe).VersionInfo.ProductVersion
Info "Version installee (per-user) : $ver attendu : $ExpectedNewVer*"
if ($ver -notlike "$ExpectedNewVer*") {
    Stop-Migration "Version installee ($ver) != attendue ($ExpectedNewVer). Arret pour investigation."
}
$hklmAfter = @(Get-Uninstall 'HKLM').Count
$hkcuAfter = @(Get-Uninstall 'HKCU').Count
Info "Entrees registre post-migration : HKLM=$hklmAfter HKCU=$hkcuAfter"
if ($hklmAfter -ne 0) { Stop-Migration "Une install per-machine subsiste (HKLM=$hklmAfter). Seconde copie interdite." }
if ($hkcuAfter -lt 1) { Warn 'Aucune entree HKCU detectee - verifier l enregistrement per-user.' }

$copies = @()
if (Test-Path $PerMachineExe) { $copies += $PerMachineExe }
if (Test-Path $PerUserExe)    { $copies += $PerUserExe }
Info ('Copies du binaire presentes : {0}' -f $copies.Count)
$copies | ForEach-Object { Info "  - $_" }
if ($copies.Count -ne 1) {
    Stop-Migration "Attendu 1 seule copie (per-user). Trouve $($copies.Count). Retirer la copie residuelle."
}

$badLinks = foreach ($d in $shortcutDirs) {
    if (Test-Path $d) {
        Get-ChildItem $d -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
            $t = $wsh.CreateShortcut($_.FullName).TargetPath
            if ($t -like "*$ExeLeaf*" -and $t -notlike "$PerUserDir*") {
                [pscustomobject]@{ Link = $_.FullName; Target = $t }
            }
        }
    }
}
$badLinks = @($badLinks)
if ($badLinks.Count -gt 0) {
    Warn "Raccourcis pointant encore vers l ancien chemin ($($badLinks.Count)) :"
    $badLinks | ForEach-Object { Warn ('  - {0} -> {1}' -f $_.Link, $_.Target) }
    Warn 'L installeur per-user recree normalement les raccourcis ; supprimer les anciens si besoin.'
} else {
    Ok "Tous les raccourcis pointent vers $PerUserDir."
}

Ok  "MIGRATION REUSSIE - v$ver per-user dans $PerUserDir."
Info "Sauvegarde conservee : $backupDir"
Info "Rollback eventuel : reinstaller la v1.0.6 (donnees non modifiees). Journal : $logFile"
exit 0
