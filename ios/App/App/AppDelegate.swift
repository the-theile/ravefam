import UIKit
import Capacitor
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        registerNotificationCategories()
        return true
    }

    // Long-press actions on pushes. A push opts in with aps.category (see
    // supabase/functions/send-rave-check-push). Capacitor's NotificationRouter
    // stays the notification-center delegate and hands the tapped action to
    // the web layer as pushNotificationActionPerformed { actionId }, where
    // openFromNativePush() in app.html saves the answer. Each action opens the
    // app (.foreground) so the reply runs with the signed-in web session;
    // .authenticationRequired keeps a locked phone from answering for you.
    private func registerNotificationCategories() {
        let options: UNNotificationActionOptions = [.foreground, .authenticationRequired]
        let raveCheck = UNNotificationCategory(
            identifier: "RAVE_CHECK",
            actions: [
                UNNotificationAction(identifier: "rc_in", title: "I'm in", options: options),
                UNNotificationAction(identifier: "rc_maybe", title: "Maybe", options: options),
                UNNotificationAction(identifier: "rc_no", title: "Can't make it", options: options),
            ],
            intentIdentifiers: [],
            options: []
        )
        // Merge, so a category registered elsewhere (a plugin) isn't dropped.
        let center = UNUserNotificationCenter.current()
        center.getNotificationCategories { existing in
            var all = existing.filter { $0.identifier != raveCheck.identifier }
            all.insert(raveCheck)
            center.setNotificationCategories(all)
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    // @capacitor/push-notifications: hand the APNs device token (or the failure)
    // to the plugin, which passes it to the web layer's 'registration' listener.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
