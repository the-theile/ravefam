import Foundation
import SwiftUI

// Shared countdown data for the widget. The app writes countdown.json into
// the App Group (CountdownWidgetPlugin.swift, fed by syncCountdownWidget() in
// app.html); the widget reads it, and refreshes it from
// myravefam.com/countdown/<token>?json=1 when the app hasn't been opened.
// Keep the file format in step with both.
//   { "token": "<personal countdown token>"?, "savedAt": ms, "crews": [Crew], "raves": [Rave]? }
// `crews`: each crew's next raves (2+ members going). `raves`: one row per
// rave for the large widget and the "Soonest" default (since 2.39.1).
enum CountdownStore {
    static let appGroup = "group.com.myravefam.app"
    static let fileName = "countdown.json"
    static let site = "https://myravefam.com"

    static var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    static func load() -> CountdownFile? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(CountdownFile.self, from: data)
    }

    static func save(_ file: CountdownFile) {
        guard let url = fileURL, let data = try? JSONEncoder().encode(file) else { return }
        try? data.write(to: url, options: .atomic)
    }

    // Fresh payload from the countdown page's JSON mode; nil on any failure
    // (offline, revoked link, server trouble), so the cached file stays.
    static func fetch(token: String) async -> CountdownPayload? {
        guard let url = URL(string: "\(site)/countdown/\(token)?json=1") else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let result = try? await URLSession.shared.data(for: request) else { return nil }
        let (data, response) = result
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONDecoder().decode(CountdownPayload.self, from: data),
              payload.ok
        else { return nil }
        return payload
    }
}

struct CountdownFile: Codable {
    var token: String?
    var savedAt: Double?
    var crews: [CountdownCrew]
    var raves: [CountdownRave]?
}

struct CountdownPayload: Decodable {
    let ok: Bool
    let crews: [CountdownCrew]?
    let raves: [CountdownRave]?
}

// One rave in a raver's "Next up" list (raves they RSVP'd to): `others` =
// crewmates going (raver excluded), `crews` = crews with a crewmate going.
// `me` is always true from the server since 2.39.1; rows with me == false
// (an older payload) are skipped by the widget.
struct CountdownRave: Codable, Hashable {
    let name: String
    let date: String
    let days: Int?
    let location: String?
    let me: Bool?
    let others: Int?
    let crews: [CountdownRaveCrew]?

    var fest: CountdownFest {
        CountdownFest(name: name, date: date, days: days, location: location,
                      going: (others ?? 0) + 1)
    }

    private var crewNames: String {
        let list = crews ?? []
        let shown = list.prefix(2).map { $0.name }.joined(separator: ", ")
        return list.count > 2 ? "\(shown) +\(list.count - 2)" : shown
    }

    // Mirrors raveCrews() in api/countdown.js.
    var subline: String {
        let n = others ?? 0
        if n == 0 { return "Just you so far" }
        return crewNames.isEmpty ? "You + \(n)" : "You + \(n) · \(crewNames)"
    }

    // The crew shape the small / medium views already draw.
    var asCrew: CountdownCrew {
        let lead = crews?.first
        let tag = (others ?? 0) == 0 ? "Your next rave" : crewNames
        return CountdownCrew(id: lead?.id ?? "", name: tag, color: lead?.color, fests: [fest])
    }
}

struct CountdownRaveCrew: Codable, Hashable {
    let id: String
    let name: String
    let color: String?
}

struct CountdownCrew: Codable, Hashable {
    let id: String
    let name: String
    let color: String?
    let fests: [CountdownFest]?
}

struct CountdownFest: Codable, Hashable {
    let name: String
    let date: String          // YYYY-MM-DD, the rave's first day
    let days: Int?
    let location: String?
    let going: Int?

    func startDate(_ calendar: Calendar) -> Date? {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

// Where a crew stands against its next rave, by local calendar date.
// Mirrors countdownState() in api/countdown.js.
enum CountdownPhase: Hashable {
    case countdown(Int)            // days to go (1 = tomorrow)
    case today(of: Int)
    case live(day: Int, of: Int)
    case empty
}

struct CountdownState {
    let phase: CountdownPhase
    let fest: CountdownFest?

    var sortKey: Int {
        switch phase {
        case .countdown(let days): return days
        case .today, .live: return 0
        case .empty: return Int.max
        }
    }

    // Big text + the small caps line under it.
    var big: String {
        switch phase {
        case .countdown(let days): return "\(days)"
        case .today: return "TODAY"
        case .live(let day, _): return "DAY \(day)"
        case .empty: return "—"
        }
    }

    var unit: String {
        switch phase {
        case .countdown(let days): return days == 1 ? "DAY · PACK TONIGHT" : "DAYS"
        case .today: return "IT'S ON"
        case .live(_, let of): return "OF \(of) · LIVE NOW"
        case .empty: return "NOTHING LOCKED IN"
        }
    }

    var isNumber: Bool {
        if case .countdown = phase { return true }
        return false
    }
}

extension CountdownCrew {
    func state(at now: Date, calendar: Calendar = .current) -> CountdownState {
        let today = calendar.startOfDay(for: now)
        for fest in fests ?? [] {
            guard let start = fest.startDate(calendar) else { continue }
            let length = max(1, fest.days ?? 1)
            let diff = calendar.dateComponents([.day], from: today, to: start).day ?? 0
            if diff >= 1 { return CountdownState(phase: .countdown(diff), fest: fest) }
            if diff == 0 { return CountdownState(phase: .today(of: length), fest: fest) }
            if -diff < length { return CountdownState(phase: .live(day: 1 - diff, of: length), fest: fest) }
            // ended locally: try the next one
        }
        return CountdownState(phase: .empty, fest: nil)
    }

    var accent: Color { Color(hex: color) }

    var appURL: URL? {
        if id.isEmpty { return URL(string: "\(CountdownStore.site)/app") }
        var parts = URLComponents(string: "\(CountdownStore.site)/app")
        parts?.queryItems = [URLQueryItem(name: "crew", value: id)]
        return parts?.url
    }
}

// Soonest first, nothing-booked last, then by name.
func sortedCrews(_ crews: [CountdownCrew], at now: Date) -> [CountdownCrew] {
    crews.sorted { a, b in
        let ka = a.state(at: now).sortKey, kb = b.state(at: now).sortKey
        return ka != kb ? ka < kb : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
    }
}

extension Color {
    // Crew colours are "#rrggbb" (sometimes "#rgb"); anything else is neon pink.
    init(hex: String?) {
        let pink = Color(red: 1, green: 45 / 255, blue: 120 / 255)
        guard let hex = hex, hex.hasPrefix("#") else { self = pink; return }
        var digits = String(hex.dropFirst())
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
        guard digits.count == 6 || digits.count == 8, let value = UInt64(digits.prefix(6), radix: 16) else {
            self = pink
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
