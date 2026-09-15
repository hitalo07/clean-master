import ApplicationServices
import Foundation

let finder = NSAppleEventDescriptor(bundleIdentifier: "com.apple.finder")

let status = AEDeterminePermissionToAutomateTarget(
    finder.aeDesc,
    AEEventClass(typeWildCard),
    AEEventID(typeWildCard),
    true
)

if status == noErr {
    exit(0)
}

if status == OSStatus(errAEEventNotPermitted) {
    FileHandle.standardError.write(Data("PERMISSION_DENIED\n".utf8))
    exit(1)
}

FileHandle.standardError.write(Data("status \(status)\n".utf8))
exit(2)
