import UIKit
import WebKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = RaveBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

// Lineup Explorer pages (and any other myravefam.com page, via allowNavigation
// in capacitor.config.json) load in this webview with no browser chrome, so
// give them the native edge swipe-back to return to /app. Off in /app itself:
// it has no in-page history, and a stray swipe there would reload an earlier
// page (e.g. a used invite link).
class RaveBridgeViewController: CAPBridgeViewController {
    private var urlObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        urlObservation = webView?.observe(\.url, options: [.initial, .new]) { webView, _ in
            let path = webView.url?.path ?? "/app"
            webView.allowsBackForwardNavigationGestures = !(path == "/app" || path.hasPrefix("/app.html") || path.hasPrefix("/app/"))
        }
    }
}
