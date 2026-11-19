import Foundation
import Capacitor
import WidgetKit

// Feeds the Rave Countdown widget (ios/App/CountdownWidget): writes
// countdown.json into the App Group and asks WidgetKit to redraw.
//   window.Capacitor.Plugins.CountdownWidget.save({ json })  // JSON string
//   window.Capacitor.Plugins.CountdownWidget.clear()         // on sign-out
// Called by syncCountdownWidget() in app.html. Registered on the bridge in
// RaveBridgeViewController. The file format lives in
// CountdownWidget/CountdownModel.swift (CountdownFile).
@objc(CountdownWidgetPlugin)
public class CountdownWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CountdownWidgetPlugin"
    public let jsName = "CountdownWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "save", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    static let appGroup = "group.com.myravefam.app"
    static let fileName = "countdown.json"
    static let widgetKind = "CountdownWidget"

    private var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)?
            .appendingPathComponent(Self.fileName)
    }

    // The JS side sends a JSON string (not an object) so the bytes land in the
    // file exactly as built, with no bridge type conversion in between.
    @objc func save(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data),
              let file = object as? [String: Any], file["crews"] is [Any]
        else { call.reject("Expected { json: '{\"crews\":[...]}' }"); return }
        guard let url = fileURL else { call.reject("App Group unavailable"); return }
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("Could not write countdown file", nil, error)
            return
        }
        WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        if let url = fileURL { try? FileManager.default.removeItem(at: url) }
        WidgetCenter.shared.reloadTimelines(ofKind: Self.widgetKind)
        call.resolve()
    }
}
