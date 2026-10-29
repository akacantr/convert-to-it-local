Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
electronExe = projectDir & "\node_modules\electron\dist\electron.exe"
shell.CurrentDirectory = projectDir
shell.Run """" & electronExe & """ """ & projectDir & """", 0, False
