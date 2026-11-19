import UIKit
import UniformTypeIdentifiers

// RaveFAM in the iOS share sheet. Instagram, TikTok, Facebook, Safari and the
// rest hand us a link and/or some text; we save it to the App Group container
// (share-inbox.json) and show a quick "Saved" card. The app reads it on its
// next open (ShareInboxPlugin → checkShareInbox() in app.html), which asks
// which Huddle to drop it in. Keep the file format in step with
// ShareInboxPlugin.swift.
class ShareViewController: UIViewController {
    static let appGroup = "group.com.myravefam.app"
    static let inboxFile = "share-inbox.json"

    private var sharedURL: String?
    private var sharedText: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        collectSharedItems { [weak self] in
            guard let self = self else { return }
            let saved = self.saveToInbox()
            self.showCard(saved: saved)
        }
    }

    // Pulls the first web link and the first bit of text out of whatever the
    // host app shared. Calls done on the main queue once every provider answers.
    private func collectSharedItems(done: @escaping () -> Void) {
        let group = DispatchGroup()
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        for item in items {
            if sharedText == nil, let caption = item.attributedContentText?.string,
               !caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sharedText = caption
            }
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { value, _ in
                        DispatchQueue.main.async {
                            if self.sharedURL == nil, let url = value as? URL,
                               let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                                self.sharedURL = url.absoluteString
                            }
                            group.leave()
                        }
                    }
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    group.enter()
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { value, _ in
                        DispatchQueue.main.async {
                            if self.sharedText == nil, let text = value as? String,
                               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                                self.sharedText = text
                            }
                            group.leave()
                        }
                    }
                }
            }
        }
        group.notify(queue: .main, execute: done)
    }

    // One item at a time: a newer share replaces one the app hasn't picked up.
    private func saveToInbox() -> Bool {
        guard sharedURL != nil || sharedText != nil,
              let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup)
        else { return false }
        var payload: [String: Any] = ["at": Int(Date().timeIntervalSince1970 * 1000)]
        if let url = sharedURL { payload["url"] = url }
        if let text = sharedText { payload["text"] = String(text.prefix(1000)) }
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return false }
        do {
            try data.write(to: dir.appendingPathComponent(Self.inboxFile), options: .atomic)
            return true
        } catch {
            return false
        }
    }

    private func showCard(saved: Bool) {
        let card = UIView()
        card.backgroundColor = UIColor(red: 0.04, green: 0.04, blue: 0.08, alpha: 1)
        card.layer.cornerRadius = 20
        card.layer.borderWidth = 1
        card.layer.borderColor = UIColor(red: 1, green: 0.18, blue: 0.75, alpha: 0.6).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false

        let icon = UILabel()
        icon.text = saved ? "🕊️" : "⚠️"
        icon.font = .systemFont(ofSize: 44)

        let title = UILabel()
        title.text = saved ? "Saved to RaveFAM" : "Couldn't save that"
        title.font = .systemFont(ofSize: 19, weight: .bold)
        title.textColor = .white

        let body = UILabel()
        body.text = saved
            ? "Open RaveFAM to drop it in a Huddle."
            : "RaveFAM can take links and text. Try sharing the link instead."
        body.font = .systemFont(ofSize: 15)
        body.textColor = UIColor(white: 1, alpha: 0.7)
        body.numberOfLines = 0
        body.textAlignment = .center

        let button = UIButton(type: .system)
        button.setTitle("Done", for: .normal)
        button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        button.tintColor = UIColor(red: 0, green: 0.96, blue: 1, alpha: 1)
        button.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [icon, title, body, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(stack)
        view.addSubview(card)
        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 300),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20)
        ])

        if saved {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.finish() }
        }
    }

    private var finished = false
    @objc private func finish() {
        guard !finished else { return }
        finished = true
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
}
