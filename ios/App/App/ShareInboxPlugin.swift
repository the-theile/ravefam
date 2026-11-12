import Foundation
import Capacitor

// Hands the web layer whatever the Share Extension saved (share-inbox.json in
// the App Group container): window.Capacitor.Plugins.ShareInbox.read() and
// .clear(), used by checkShareInbox() in app.html. Registered on the bridge in
// RaveBridgeViewController. Keep the file format in step with
// ShareExtension/ShareViewController.swift.
@objc(ShareInboxPlugin)
public class ShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareInboxPlugin"
    public let jsName = "ShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    static let appGroup = "group.com.myravefam.app"
    static let inboxFile = "share-inbox.json"

    private var inboxURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
            .appendingPathComponent(Self.inboxFile)
    }

    // Resolves {} when nothing is waiting, else { url?, text?, at }.
    @objc func read(_ call: CAPPluginCall) {
        guard let url = inboxURL, let data = try? Data(contentsOf: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { call.resolve([:]); return }
        var item: [String: Any] = [:]
        if let link = json["url"] as? String { item["url"] = link }
        if let text = json["text"] as? String { item["text"] = text }
        if let at = json["at"] as? NSNumber { item["at"] = at.doubleValue }
        call.resolve(item)
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let url = inboxURL { try? FileManager.default.removeItem(at: url) }
        call.resolve()
    }
}
