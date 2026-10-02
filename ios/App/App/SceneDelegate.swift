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

// Lineup Explorer pages load in this webview with no browser chrome, so give
// them the native edge swipe-back to return to /app. Only there: the app
// itself has no in-page history, and a stray swipe in /app would reload an
// earlier page (e.g. a used invite link).
class RaveBridgeViewController: CAPBridgeViewController {
    private var urlObservation: NSKeyValueObservation?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        urlObservation = webView?.observe(\.url, options: [.initial, .new]) { webView, _ in
            webView.allowsBackForwardNavigationGestures = webView.url?.path.hasPrefix("/lineup-explorer") ?? false
        }
    }
}
